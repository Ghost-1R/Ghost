/**
 * Sales map aggregation — pure functions, no I/O.
 *
 * Rules (see aggregate.test.ts):
 *  - Only PAID orders appear as customer location points, revenue, and first-time/returning counts.
 *  - REFUNDED and PARTIAL_REFUND orders are counted separately in `refunds` and never become
 *    location points (a partial refund's remaining paid amount is intentionally not mapped).
 *  - first-time = the earliest PAID order per customer_key within the company. That is computed
 *    on the company's FULL order history; date / area filters are applied afterwards, so a
 *    filter can never turn a returning customer into a "first-time" one.
 *  - Pickup orders and orders with no valid ZIP never get a map point; they are reported as
 *    separate totals.
 *  - Prospects are a separate list and are never merged into customer aggregates.
 *  - Output carries ZIP / state level aggregates only — no order ids, customer keys, or addresses.
 */

export type OrderPaymentState = "PAID" | "REFUNDED" | "PARTIAL_REFUND";
export type OrderFulfillment = "SHIPPED" | "PICKUP" | "UNKNOWN";

export type SalesOrder = {
  id: string;
  /** Keep customer identity scoped to a company even if callers mix companies. */
  companyId?: string;
  customerKey: string;
  paidAt: string;
  amountCents: number;
  paymentState: OrderPaymentState;
  fulfillment: OrderFulfillment;
  shippingZip: string | null;
  shippingState: string | null;
  /** Known refunded amount. REFUNDED defaults to the order amount; PARTIAL_REFUND defaults to 0 (unknown). */
  refundedCents?: number | null;
  /** False when the synced history may be missing earlier orders. */
  historyComplete?: boolean;
};

export type SalesProspect = {
  zip: string | null;
  stateCode: string | null;
};

export type AggregateOptions = {
  /** Inclusive lower bound on paid_at (ISO timestamp or YYYY-MM-DD). */
  from?: string | null;
  /** Inclusive upper bound; a bare YYYY-MM-DD includes the whole UTC day. */
  to?: string | null;
  /** Limit to these ZIPs (e.g. radius search). Pickup / missing-ZIP buckets then report zero. */
  zips?: ReadonlySet<string> | null;
  /** Limit to these state codes. Pickup / missing-ZIP buckets then report zero. */
  states?: ReadonlySet<string> | null;
  /** Fallback state lookup by ZIP when an order has no shipping_state. */
  stateOfZip?: (zip: string) => string | null | undefined;
};

export type ZipAggregate = {
  zip: string;
  state: string | null;
  orderCount: number;
  revenueCents: number;
  firstTimeCustomers: number;
  returningCustomers: number;
};

export type StateAggregate = {
  state: string;
  orderCount: number;
  revenueCents: number;
  firstTimeCustomers: number;
  returningCustomers: number;
  zipCount: number;
};

export type BucketTotals = {
  orderCount: number;
  revenueCents: number;
  firstTimeCustomers: number;
  returningCustomers: number;
};

export type RefundTotals = {
  orderCount: number;
  fullRefundCount: number;
  partialRefundCount: number;
  refundedCents: number;
  /** Original amount of the refunded orders. */
  grossCents: number;
};

export type SalesMapAggregates = {
  zips: ZipAggregate[];
  states: StateAggregate[];
  pickup: BucketTotals;
  missingZip: BucketTotals;
  refunds: RefundTotals;
  /** Every PAID order in scope: mapped + pickup + missing ZIP. */
  totals: BucketTotals;
  /** False when any order says the synced history is incomplete (first-time counts may be overstated). */
  firstTimeReliable: boolean;
};

export type ProspectAggregate = {
  zip: string;
  state: string | null;
  prospectCount: number;
};

const ZIP_PATTERN = /^[0-9]{5}$/;

export function isValidZip(value: string | null | undefined): value is string {
  return typeof value === "string" && ZIP_PATTERN.test(value);
}

function customerId(order: SalesOrder): string | null {
  const key = order.customerKey.trim();
  return key ? `${order.companyId ?? ""}\u0000${key}` : null;
}

function compareOrders(left: SalesOrder, right: SalesOrder): number {
  const a = Date.parse(left.paidAt);
  const b = Date.parse(right.paidAt);
  if (a !== b) return a - b;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Order ids that are a customer's earliest PAID order. Compute over the full history.
 * Orders with a blank customer_key cannot be linked, so they are never first-time or returning.
 */
export function firstPaidOrderIds(orders: readonly SalesOrder[]): Set<string> {
  const earliest = new Map<string, SalesOrder>();
  for (const order of orders) {
    if (order.paymentState !== "PAID") continue;
    const customer = customerId(order);
    if (!customer) continue;
    const current = earliest.get(customer);
    if (!current || compareOrders(order, current) < 0) earliest.set(customer, order);
  }
  return new Set([...earliest.values()].map((order) => order.id));
}

function parseBound(value: string | null | undefined, endOfDay: boolean): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const parsed = Date.parse(dateOnly ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (Number.isNaN(parsed)) return null;
  return dateOnly && endOfDay ? parsed + 24 * 60 * 60 * 1000 - 1 : parsed;
}

function orderState(order: SalesOrder, options: AggregateOptions): string | null {
  const direct = order.shippingState?.trim().toUpperCase();
  if (direct && /^[A-Z]{2}$/.test(direct)) return direct;
  if (isValidZip(order.shippingZip)) {
    const fromLookup = options.stateOfZip?.(order.shippingZip)?.trim().toUpperCase();
    if (fromLookup && /^[A-Z]{2}$/.test(fromLookup)) return fromLookup;
  }
  return null;
}

type Prepared = {
  firstIds: Set<string>;
  inRange: SalesOrder[];
  mapped: SalesOrder[];
  pickup: SalesOrder[];
  missingZip: SalesOrder[];
  refunds: SalesOrder[];
  areaFiltered: boolean;
};

function prepare(orders: readonly SalesOrder[], options: AggregateOptions): Prepared {
  const firstIds = firstPaidOrderIds(orders);
  const from = parseBound(options.from, false);
  const to = parseBound(options.to, true);
  const zipFilter = options.zips ?? null;
  const stateFilter = options.states ?? null;
  const areaFiltered = Boolean(zipFilter || stateFilter);

  const inRange = orders.filter((order) => {
    const at = Date.parse(order.paidAt);
    if (Number.isNaN(at)) return false;
    if (from !== null && at < from) return false;
    if (to !== null && at > to) return false;
    return true;
  });

  const mapped: SalesOrder[] = [];
  const pickup: SalesOrder[] = [];
  const missingZip: SalesOrder[] = [];
  const refunds: SalesOrder[] = [];

  for (const order of inRange) {
    if (order.paymentState !== "PAID") {
      refunds.push(order);
      continue;
    }
    if (order.fulfillment === "PICKUP") {
      pickup.push(order);
      continue;
    }
    if (!isValidZip(order.shippingZip)) {
      missingZip.push(order);
      continue;
    }
    mapped.push(order);
  }

  const areaOk = (order: SalesOrder): boolean => {
    if (zipFilter) {
      if (!isValidZip(order.shippingZip) || !zipFilter.has(order.shippingZip)) return false;
    }
    if (stateFilter) {
      const state = orderState(order, options);
      if (!state || !stateFilter.has(state)) return false;
    }
    return true;
  };

  return {
    firstIds,
    inRange,
    mapped: areaFiltered ? mapped.filter(areaOk) : mapped,
    // Orders with no ZIP cannot belong to a chosen area.
    pickup: areaFiltered ? [] : pickup,
    missingZip: areaFiltered ? [] : missingZip,
    refunds: areaFiltered ? refunds.filter(areaOk) : refunds,
    areaFiltered,
  };
}

function bucketOf(orders: readonly SalesOrder[], firstIds: ReadonlySet<string>): BucketTotals {
  const firstTime = new Set<string>();
  const returning = new Set<string>();
  let revenueCents = 0;
  for (const order of orders) {
    revenueCents += order.amountCents;
    const customer = customerId(order);
    if (!customer) continue;
    if (firstIds.has(order.id)) firstTime.add(customer);
    else returning.add(customer);
  }
  return {
    orderCount: orders.length,
    revenueCents,
    firstTimeCustomers: firstTime.size,
    returningCustomers: returning.size,
  };
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function zipAggregates(prepared: Prepared, options: AggregateOptions): ZipAggregate[] {
  const groups = groupBy(prepared.mapped, (order) => order.shippingZip);
  const out: ZipAggregate[] = [];
  for (const [zip, list] of groups) {
    const bucket = bucketOf(list, prepared.firstIds);
    const state =
      list.map((order) => orderState(order, options)).find((value) => value !== null) ?? null;
    out.push({ zip, state, ...bucket });
  }
  return out.sort(
    (left, right) => right.revenueCents - left.revenueCents || left.zip.localeCompare(right.zip),
  );
}

function stateAggregates(prepared: Prepared, options: AggregateOptions): StateAggregate[] {
  const groups = groupBy(prepared.mapped, (order) => orderState(order, options));
  const out: StateAggregate[] = [];
  for (const [state, list] of groups) {
    const bucket = bucketOf(list, prepared.firstIds);
    out.push({
      state,
      ...bucket,
      zipCount: new Set(list.map((order) => order.shippingZip)).size,
    });
  }
  return out.sort(
    (left, right) => right.revenueCents - left.revenueCents || left.state.localeCompare(right.state),
  );
}

function refundTotals(refunds: readonly SalesOrder[]): RefundTotals {
  const totals: RefundTotals = {
    orderCount: refunds.length,
    fullRefundCount: 0,
    partialRefundCount: 0,
    refundedCents: 0,
    grossCents: 0,
  };
  for (const order of refunds) {
    totals.grossCents += order.amountCents;
    if (order.paymentState === "REFUNDED") {
      totals.fullRefundCount += 1;
      totals.refundedCents += Math.min(order.refundedCents ?? order.amountCents, order.amountCents);
    } else {
      totals.partialRefundCount += 1;
      totals.refundedCents += Math.min(Math.max(order.refundedCents ?? 0, 0), order.amountCents);
    }
  }
  return totals;
}

/** ZIP aggregates for mapped PAID orders (shipped, valid ZIP). */
export function aggregateOrdersByZip(
  orders: readonly SalesOrder[],
  options: AggregateOptions = {},
): ZipAggregate[] {
  return zipAggregates(prepare(orders, options), options);
}

/** State aggregates for the same mapped PAID orders, with customers de-duplicated per state. */
export function aggregateOrdersByState(
  orders: readonly SalesOrder[],
  options: AggregateOptions = {},
): StateAggregate[] {
  return stateAggregates(prepare(orders, options), options);
}

/** Totals that never receive a map point: pickup, missing / invalid ZIP, and refunds. */
export function separatePickupAndMissingZip(
  orders: readonly SalesOrder[],
  options: AggregateOptions = {},
): { pickup: BucketTotals; missingZip: BucketTotals; refunds: RefundTotals } {
  const prepared = prepare(orders, options);
  return {
    pickup: bucketOf(prepared.pickup, prepared.firstIds),
    missingZip: bucketOf(prepared.missingZip, prepared.firstIds),
    refunds: refundTotals(prepared.refunds),
  };
}

/** One-shot summary used by loadMapSummary. */
export function summarizeSalesOrders(
  orders: readonly SalesOrder[],
  options: AggregateOptions = {},
): SalesMapAggregates {
  const prepared = prepare(orders, options);
  const paidInScope = [...prepared.mapped, ...prepared.pickup, ...prepared.missingZip];
  return {
    zips: zipAggregates(prepared, options),
    states: stateAggregates(prepared, options),
    pickup: bucketOf(prepared.pickup, prepared.firstIds),
    missingZip: bucketOf(prepared.missingZip, prepared.firstIds),
    refunds: refundTotals(prepared.refunds),
    totals: bucketOf(paidInScope, prepared.firstIds),
    firstTimeReliable: !orders.some((order) => order.historyComplete === false),
  };
}

/** Prospects stay in their own list; they are never added to customer aggregates. */
export function aggregateProspectsByZip(
  prospects: readonly SalesProspect[],
  stateOfZip?: (zip: string) => string | null | undefined,
): ProspectAggregate[] {
  const groups = new Map<string, ProspectAggregate>();
  for (const prospect of prospects) {
    if (!isValidZip(prospect.zip)) continue;
    const existing = groups.get(prospect.zip);
    if (existing) {
      existing.prospectCount += 1;
      continue;
    }
    const direct = prospect.stateCode?.trim().toUpperCase() || null;
    groups.set(prospect.zip, {
      zip: prospect.zip,
      state: direct ?? stateOfZip?.(prospect.zip)?.toUpperCase() ?? null,
      prospectCount: 1,
    });
  }
  return [...groups.values()].sort(
    (left, right) => right.prospectCount - left.prospectCount || left.zip.localeCompare(right.zip),
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers (radius filter, nearest ZIP for geolocation)
// ---------------------------------------------------------------------------

export type GeoPoint = { lat: number; lng: number };
export type ZipPoint = GeoPoint & { zip: string };

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function zipsWithinRadius(
  centroids: readonly ZipPoint[],
  center: GeoPoint,
  miles: number,
): Set<string> {
  const out = new Set<string>();
  for (const point of centroids) {
    if (haversineMiles(center, point) <= miles) out.add(point.zip);
  }
  return out;
}

export function nearestZip(centroids: readonly ZipPoint[], point: GeoPoint): ZipPoint | null {
  let best: ZipPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of centroids) {
    const distance = haversineMiles(point, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Rough bounding box in degrees for a radius, to prefilter centroid queries. */
export function boundingBox(center: GeoPoint, miles: number): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const latDelta = miles / 69;
  const lngDelta = miles / (69 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180)));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}
