import type { GhostClient } from "@/lib/auth/session";
import { isMissingRelation, loose } from "@/lib/db/loose";
import { fromError, type QueryResult } from "@/lib/result";
import {
  aggregateProspectsByZip,
  boundingBox,
  isValidZip,
  summarizeSalesOrders,
  zipsWithinRadius,
  type GeoPoint,
  type OrderFulfillment,
  type OrderPaymentState,
  type ProspectAggregate,
  type SalesMapAggregates,
  type SalesOrder,
  type ZipAggregate,
  type ZipPoint,
} from "@/lib/sales-map/aggregate";

/**
 * Callers MUST check canViewMap(access, companyId) (src/lib/access/permissions.ts) before
 * calling loadMapSummary. RLS on company_orders also requires owner or an active map grant,
 * but this module does not re-derive access.
 */

export type MapFilters = {
  state?: string | null;
  /** Exact ZIP search. */
  zip?: string | null;
  /** Radius around `zip` (its centroid) or around `lat`/`lng` (browser geolocation). */
  radiusMiles?: number | null;
  lat?: number | null;
  lng?: number | null;
  from?: string | null;
  to?: string | null;
};

export type MapSyncMeta = {
  sourceLabel: string;
  lastSyncedAt: string | null;
  historyComplete: boolean;
  notes: string;
};

export type ZipCentroid = ZipPoint & { state: string; city: string };

export type MapZipPoint = ZipAggregate & { city: string; lat: number; lng: number };

export type MapProspectPoint = ProspectAggregate & { city: string; lat: number | null; lng: number | null };

export type MapSummary = {
  companyId: string;
  companyName: string | null;
  sync: MapSyncMeta | null;
  /** Human label for where the numbers come from, e.g. "Labeled test orders". */
  dataSourceLabel: string;
  hasTestData: boolean;
  filters: {
    state: string | null;
    zip: string | null;
    radiusMiles: number | null;
    center: (GeoPoint & { zip: string | null }) | null;
    from: string | null;
    to: string | null;
  };
  aggregates: SalesMapAggregates;
  /** Aggregated ZIPs that have a reference centroid (placeable on the map). */
  zipPoints: MapZipPoint[];
  /** Aggregated ZIPs with no centroid — counted, but cannot be drawn. */
  unlocatedZipCount: number;
  prospects: MapProspectPoint[];
  orderRowsRead: number;
  orderRowsTruncated: boolean;
  notice: string | null;
};

const ORDER_PAGE = 1000;
const ORDER_MAX_PAGES = 20;
const CENTROID_CHUNK = 150;

type OrderRow = {
  customer_key: string;
  paid_at: string;
  amount_cents: number;
  payment_state: OrderPaymentState;
  fulfillment: OrderFulfillment;
  shipping_zip: string | null;
  shipping_state: string | null;
  history_complete: boolean;
  is_test: boolean;
  id: string;
};

type CentroidRow = { zip: string; state_code: string; city: string; lat: number; lng: number };

function toCentroid(row: CentroidRow): ZipCentroid {
  return { zip: row.zip, state: row.state_code, city: row.city, lat: row.lat, lng: row.lng };
}

async function loadCentroidsForZips(
  supabase: GhostClient,
  zips: readonly string[],
): Promise<Map<string, ZipCentroid>> {
  const out = new Map<string, ZipCentroid>();
  const client = loose(supabase);
  const unique = [...new Set(zips.filter(isValidZip))];
  for (let index = 0; index < unique.length; index += CENTROID_CHUNK) {
    const chunk = unique.slice(index, index + CENTROID_CHUNK);
    const { data, error } = await client
      .from("zip_centroids")
      .select("zip, state_code, city, lat, lng")
      .in("zip", chunk);
    if (error) break;
    for (const row of (data ?? []) as CentroidRow[]) out.set(row.zip, toCentroid(row));
  }
  return out;
}

async function loadOrders(
  supabase: GhostClient,
  companyId: string,
): Promise<QueryResult<{ rows: OrderRow[]; truncated: boolean }>> {
  const client = loose(supabase);
  const rows: OrderRow[] = [];
  for (let page = 0; page < ORDER_MAX_PAGES; page += 1) {
    const { data, error } = await client
      .from("company_orders")
      .select(
        "id, customer_key, paid_at, amount_cents, payment_state, fulfillment, shipping_zip, shipping_state, history_complete, is_test",
      )
      .eq("company_id", companyId)
      .order("paid_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * ORDER_PAGE, page * ORDER_PAGE + ORDER_PAGE - 1);
    if (error) {
      if (isMissingRelation(error.message)) return { status: "ok", data: { rows: [], truncated: false } };
      return fromError(error);
    }
    const batch = (data ?? []) as OrderRow[];
    rows.push(...batch);
    if (batch.length < ORDER_PAGE) return { status: "ok", data: { rows, truncated: false } };
  }
  return { status: "ok", data: { rows, truncated: true } };
}

function clampMiles(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(value, 3000);
}

/** Aggregates for one company. Never returns order ids, customer keys, or addresses. */
export async function loadMapSummary(
  supabase: GhostClient,
  companyId: string,
  filters: MapFilters = {},
): Promise<QueryResult<MapSummary>> {
  const client = loose(supabase);

  const [syncResult, ordersResult, prospectResult, companyResult] = await Promise.all([
    client
      .from("company_sales_sync")
      .select("source_label, last_synced_at, history_complete, notes")
      .eq("company_id", companyId)
      .maybeSingle(),
    loadOrders(supabase, companyId),
    client.from("company_prospects").select("zip, state_code").eq("company_id", companyId).limit(2000),
    client.from("companies").select("name").eq("id", companyId).maybeSingle(),
  ]);

  if (ordersResult.status === "error") return ordersResult;

  const sync: MapSyncMeta | null =
    !syncResult.error && syncResult.data
      ? {
          sourceLabel: String(syncResult.data.source_label ?? ""),
          lastSyncedAt: (syncResult.data.last_synced_at as string | null) ?? null,
          historyComplete: Boolean(syncResult.data.history_complete),
          notes: String(syncResult.data.notes ?? ""),
        }
      : null;

  const { rows: orderRows, truncated } = ordersResult.data;
  const prospectRows =
    prospectResult.error || !prospectResult.data
      ? []
      : (prospectResult.data as Array<{ zip: string | null; state_code: string | null }>);

  // Reference centroids for every ZIP we may place (orders + prospects + search target).
  const searchZip = isValidZip(filters.zip?.trim()) ? filters.zip!.trim() : null;
  const centroids = await loadCentroidsForZips(supabase, [
    ...orderRows.map((row) => row.shipping_zip).filter((zip): zip is string => isValidZip(zip)),
    ...prospectRows.map((row) => row.zip).filter((zip): zip is string => isValidZip(zip)),
    ...(searchZip ? [searchZip] : []),
  ]);

  let notice: string | null = null;
  const radiusMiles = clampMiles(filters.radiusMiles);
  let center: (GeoPoint & { zip: string | null }) | null = null;
  if (radiusMiles) {
    if (searchZip) {
      const hit = centroids.get(searchZip);
      if (hit) center = { lat: hit.lat, lng: hit.lng, zip: searchZip };
      else notice = `ZIP ${searchZip} is not in the reference table, so the radius search was skipped.`;
    } else if (
      typeof filters.lat === "number" &&
      typeof filters.lng === "number" &&
      Number.isFinite(filters.lat) &&
      Number.isFinite(filters.lng)
    ) {
      center = { lat: filters.lat, lng: filters.lng, zip: null };
    }
  }

  let zipFilter: Set<string> | null = null;
  if (radiusMiles && center) {
    const box = boundingBox(center, radiusMiles);
    const near = await client
      .from("zip_centroids")
      .select("zip, state_code, city, lat, lng")
      .gte("lat", box.minLat)
      .lte("lat", box.maxLat)
      .gte("lng", box.minLng)
      .lte("lng", box.maxLng)
      .limit(5000);
    const candidates = ((near.data ?? []) as CentroidRow[]).map(toCentroid);
    for (const candidate of candidates) centroids.set(candidate.zip, candidate);
    zipFilter = zipsWithinRadius(candidates, center, radiusMiles);
  } else if (searchZip) {
    zipFilter = new Set([searchZip]);
  }

  const state = /^[A-Za-z]{2}$/.test(filters.state?.trim() ?? "")
    ? filters.state!.trim().toUpperCase()
    : null;
  const stateOfZip = (zip: string) => centroids.get(zip)?.state ?? null;

  const orders: SalesOrder[] = orderRows.map((row) => ({
    id: row.id,
    companyId,
    customerKey: row.customer_key,
    paidAt: row.paid_at,
    amountCents: row.amount_cents,
    paymentState: row.payment_state,
    fulfillment: row.fulfillment,
    shippingZip: row.shipping_zip,
    shippingState: row.shipping_state,
    historyComplete: row.history_complete,
  }));

  const aggregates = summarizeSalesOrders(orders, {
    from: filters.from ?? null,
    to: filters.to ?? null,
    zips: zipFilter,
    states: state ? new Set([state]) : null,
    stateOfZip,
  });

  const zipPoints: MapZipPoint[] = [];
  let unlocatedZipCount = 0;
  for (const aggregate of aggregates.zips) {
    const centroid = centroids.get(aggregate.zip);
    if (!centroid) {
      unlocatedZipCount += 1;
      continue;
    }
    zipPoints.push({
      ...aggregate,
      state: aggregate.state ?? centroid.state,
      city: centroid.city,
      lat: centroid.lat,
      lng: centroid.lng,
    });
  }

  // Prospects stay separate from customer aggregates.
  const prospects: MapProspectPoint[] = aggregateProspectsByZip(
    prospectRows.map((row) => ({ zip: row.zip, stateCode: row.state_code })),
    stateOfZip,
  )
    .filter((row) => (zipFilter ? zipFilter.has(row.zip) : true))
    .filter((row) => (state ? row.state === state : true))
    .map((row) => {
      const centroid = centroids.get(row.zip);
      return {
        ...row,
        city: centroid?.city ?? "",
        lat: centroid?.lat ?? null,
        lng: centroid?.lng ?? null,
      };
    });

  return {
    status: "ok",
    data: {
      companyId,
      companyName: (companyResult.data?.name as string | undefined) ?? null,
      sync,
      dataSourceLabel: sync?.sourceLabel?.trim() || (orderRows.length > 0 ? "Order data (sync not recorded)" : "No orders synced"),
      hasTestData: orderRows.some((row) => row.is_test),
      filters: {
        state,
        zip: searchZip,
        radiusMiles: center ? radiusMiles : null,
        center,
        from: filters.from ?? null,
        to: filters.to ?? null,
      },
      aggregates,
      zipPoints,
      unlocatedZipCount,
      prospects,
      orderRowsRead: orderRows.length,
      orderRowsTruncated: truncated,
      notice:
        notice ??
        (truncated
          ? `Only the first ${ORDER_PAGE * ORDER_MAX_PAGES} orders were read; totals may be incomplete.`
          : null),
    },
  };
}
