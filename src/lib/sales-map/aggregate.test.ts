import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateOrdersByState,
  aggregateOrdersByZip,
  aggregateProspectsByZip,
  boundingBox,
  firstPaidOrderIds,
  haversineMiles,
  nearestZip,
  separatePickupAndMissingZip,
  summarizeSalesOrders,
  zipsWithinRadius,
  type SalesOrder,
} from "./aggregate";
import { buildLabeledTestOrders } from "./test-orders";

let counter = 0;
function order(partial: Partial<SalesOrder> & Pick<SalesOrder, "customerKey" | "paidAt">): SalesOrder {
  counter += 1;
  return {
    id: `o${counter}`,
    amountCents: 1000,
    paymentState: "PAID",
    fulfillment: "SHIPPED",
    shippingZip: "10001",
    shippingState: "NY",
    ...partial,
  };
}

test("first-time is the earliest PAID order per customer", () => {
  const first = order({ id: "a", customerKey: "c1", paidAt: "2026-01-01T00:00:00Z" });
  const second = order({ id: "b", customerKey: "c1", paidAt: "2026-02-01T00:00:00Z" });
  const other = order({ id: "c", customerKey: "c2", paidAt: "2026-03-01T00:00:00Z" });
  const ids = firstPaidOrderIds([second, other, first]);
  assert.deepEqual([...ids].sort(), ["a", "c"]);
});

test("a refunded earlier order does not make the next PAID order returning", () => {
  const refunded = order({
    id: "r",
    customerKey: "c1",
    paidAt: "2026-01-01T00:00:00Z",
    paymentState: "REFUNDED",
  });
  const paid = order({ id: "p", customerKey: "c1", paidAt: "2026-02-01T00:00:00Z" });
  assert.deepEqual([...firstPaidOrderIds([refunded, paid])], ["p"]);
});

test("aggregateOrdersByZip counts orders, revenue, first-time and returning customers", () => {
  const rows = [
    order({ id: "1", customerKey: "a", paidAt: "2026-01-01T00:00:00Z", amountCents: 1000 }),
    order({ id: "2", customerKey: "a", paidAt: "2026-01-05T00:00:00Z", amountCents: 500 }),
    order({ id: "3", customerKey: "b", paidAt: "2026-01-06T00:00:00Z", amountCents: 700 }),
    order({
      id: "4",
      customerKey: "c",
      paidAt: "2026-01-07T00:00:00Z",
      amountCents: 900,
      shippingZip: "30301",
      shippingState: "GA",
    }),
  ];
  const zips = aggregateOrdersByZip(rows);
  const ny = zips.find((row) => row.zip === "10001");
  const ga = zips.find((row) => row.zip === "30301");
  assert.deepEqual(ny, {
    zip: "10001",
    state: "NY",
    orderCount: 3,
    revenueCents: 2200,
    firstTimeCustomers: 2,
    returningCustomers: 1,
  });
  assert.equal(ga?.firstTimeCustomers, 1);
  assert.equal(ga?.returningCustomers, 0);
  assert.equal(zips[0]?.zip, "10001", "sorted by revenue desc");
});

test("refunds are counted separately and never become location points", () => {
  const rows = [
    order({ id: "1", customerKey: "a", paidAt: "2026-01-01T00:00:00Z", amountCents: 1000 }),
    order({
      id: "2",
      customerKey: "b",
      paidAt: "2026-01-02T00:00:00Z",
      amountCents: 4000,
      paymentState: "REFUNDED",
      shippingZip: "60601",
      shippingState: "IL",
    }),
    order({
      id: "3",
      customerKey: "c",
      paidAt: "2026-01-03T00:00:00Z",
      amountCents: 2000,
      paymentState: "PARTIAL_REFUND",
      refundedCents: 500,
      shippingZip: "60601",
      shippingState: "IL",
    }),
  ];
  const summary = summarizeSalesOrders(rows);
  assert.deepEqual(
    summary.zips.map((row) => row.zip),
    ["10001"],
  );
  assert.equal(summary.states.some((row) => row.state === "IL"), false);
  assert.deepEqual(summary.refunds, {
    orderCount: 2,
    fullRefundCount: 1,
    partialRefundCount: 1,
    refundedCents: 4500,
    grossCents: 6000,
  });
  assert.equal(summary.totals.orderCount, 1, "refunds are not part of paid totals");
  assert.equal(summary.totals.revenueCents, 1000);
});

test("pickup and missing-ZIP orders are separated from map points", () => {
  const rows = [
    order({ id: "1", customerKey: "a", paidAt: "2026-01-01T00:00:00Z" }),
    order({
      id: "2",
      customerKey: "b",
      paidAt: "2026-01-02T00:00:00Z",
      fulfillment: "PICKUP",
      shippingZip: null,
      shippingState: null,
      amountCents: 300,
    }),
    order({
      id: "3",
      customerKey: "a",
      paidAt: "2026-01-03T00:00:00Z",
      shippingZip: null,
      shippingState: null,
      amountCents: 400,
    }),
    order({
      id: "4",
      customerKey: "d",
      paidAt: "2026-01-04T00:00:00Z",
      shippingZip: "1234",
      shippingState: null,
      amountCents: 200,
    }),
  ];
  const split = separatePickupAndMissingZip(rows);
  assert.deepEqual(split.pickup, {
    orderCount: 1,
    revenueCents: 300,
    firstTimeCustomers: 1,
    returningCustomers: 0,
  });
  assert.equal(split.missingZip.orderCount, 2);
  assert.equal(split.missingZip.revenueCents, 600);
  assert.equal(split.missingZip.returningCustomers, 1, "customer a's second order is returning");
  assert.equal(aggregateOrdersByZip(rows).length, 1);
});

test("date filters keep first-time classification from full history", () => {
  const rows = [
    order({ id: "1", customerKey: "a", paidAt: "2026-01-01T00:00:00Z" }),
    order({ id: "2", customerKey: "a", paidAt: "2026-03-01T00:00:00Z" }),
  ];
  const [zip] = aggregateOrdersByZip(rows, { from: "2026-02-01", to: "2026-03-31" });
  assert.equal(zip?.orderCount, 1);
  assert.equal(zip?.firstTimeCustomers, 0, "earlier January order is still the first-time order");
  assert.equal(zip?.returningCustomers, 1);
});

test("a bare 'to' date includes the whole UTC day", () => {
  const rows = [order({ customerKey: "a", paidAt: "2026-03-01T23:30:00Z" })];
  assert.equal(aggregateOrdersByZip(rows, { to: "2026-03-01" }).length, 1);
  assert.equal(aggregateOrdersByZip(rows, { to: "2026-02-28" }).length, 0);
});

test("area filters drop pickup and missing-ZIP buckets", () => {
  const rows = [
    order({ customerKey: "a", paidAt: "2026-01-01T00:00:00Z" }),
    order({
      customerKey: "b",
      paidAt: "2026-01-02T00:00:00Z",
      fulfillment: "PICKUP",
      shippingZip: null,
      shippingState: null,
    }),
  ];
  const summary = summarizeSalesOrders(rows, { zips: new Set(["10001"]) });
  assert.equal(summary.zips.length, 1);
  assert.equal(summary.pickup.orderCount, 0);
  assert.equal(summary.totals.orderCount, 1);
});

test("state rollup de-duplicates customers across ZIPs and falls back to ZIP lookup", () => {
  const rows = [
    order({
      id: "1",
      customerKey: "a",
      paidAt: "2026-01-01T00:00:00Z",
      shippingZip: "30301",
      shippingState: null,
    }),
    order({
      id: "2",
      customerKey: "a",
      paidAt: "2026-01-02T00:00:00Z",
      shippingZip: "30308",
      shippingState: null,
    }),
    order({
      id: "3",
      customerKey: "a",
      paidAt: "2026-01-03T00:00:00Z",
      shippingZip: "30301",
      shippingState: null,
    }),
  ];
  const states = aggregateOrdersByState(rows, { stateOfZip: () => "GA" });
  assert.equal(states.length, 1);
  assert.equal(states[0]?.state, "GA");
  assert.equal(states[0]?.orderCount, 3);
  assert.equal(states[0]?.returningCustomers, 1, "one returning customer, not one per ZIP");
  assert.equal(states[0]?.zipCount, 2);
});

test("prospects are aggregated on their own and not mixed into orders", () => {
  const prospects = aggregateProspectsByZip([
    { zip: "75201", stateCode: "TX" },
    { zip: "75201", stateCode: "TX" },
    { zip: null, stateCode: "WA" },
    { zip: "98101", stateCode: null },
  ], () => "WA");
  assert.deepEqual(prospects, [
    { zip: "75201", state: "TX", prospectCount: 2 },
    { zip: "98101", state: "WA", prospectCount: 1 },
  ]);
  const summary = summarizeSalesOrders([]);
  assert.equal(summary.zips.length, 0);
});

test("incomplete history marks first-time counts as unreliable", () => {
  const rows = [order({ customerKey: "a", paidAt: "2026-01-01T00:00:00Z", historyComplete: false })];
  assert.equal(summarizeSalesOrders(rows).firstTimeReliable, false);
  assert.equal(summarizeSalesOrders([]).firstTimeReliable, true);
});

test("output carries no order ids, customer keys, or addresses", () => {
  const rows = [order({ id: "secret-order", customerKey: "secret-customer", paidAt: "2026-01-01T00:00:00Z" })];
  const json = JSON.stringify(summarizeSalesOrders(rows));
  assert.equal(json.includes("secret-order"), false);
  assert.equal(json.includes("secret-customer"), false);
});

test("radius helpers", () => {
  const ny = { zip: "10001", lat: 40.7506, lng: -73.9971 };
  const bk = { zip: "11201", lat: 40.694, lng: -73.99 };
  const la = { zip: "90210", lat: 34.0901, lng: -118.4065 };
  assert.ok(haversineMiles(ny, bk) < 6);
  assert.ok(haversineMiles(ny, la) > 2400);
  assert.deepEqual([...zipsWithinRadius([ny, bk, la], ny, 25)].sort(), ["10001", "11201"]);
  assert.equal(nearestZip([ny, bk, la], { lat: 34.1, lng: -118.4 })?.zip, "90210");
  const box = boundingBox(ny, 25);
  assert.ok(box.minLat < ny.lat && box.maxLat > ny.lat && box.minLng < ny.lng && box.maxLng > ny.lng);
});

test("labeled test orders cover first-time, returning, refund, pickup, and missing ZIP", () => {
  const labeled = buildLabeledTestOrders("company-1", new Date("2026-11-04T12:00:00Z"));
  const labels = new Set(labeled.map((entry) => entry.label));
  for (const label of ["first-time", "returning", "refund", "pickup", "missing-zip"] as const) {
    assert.ok(labels.has(label), `missing ${label}`);
  }
  assert.ok(labeled.every((entry) => entry.row.is_test && entry.row.external_order_id.startsWith("TEST-")));

  const orders: SalesOrder[] = labeled.map((entry) => ({
    id: entry.row.external_order_id,
    customerKey: entry.row.customer_key,
    paidAt: entry.row.paid_at,
    amountCents: entry.row.amount_cents,
    paymentState: entry.row.payment_state,
    fulfillment: entry.row.fulfillment,
    shippingZip: entry.row.shipping_zip,
    shippingState: entry.row.shipping_state,
  }));
  const summary = summarizeSalesOrders(orders);
  assert.equal(summary.refunds.orderCount, 1);
  assert.equal(summary.pickup.orderCount, 1);
  assert.equal(summary.missingZip.orderCount, 1);
  assert.equal(summary.totals.firstTimeCustomers, 6, "4 mapped + pickup + missing-ZIP customers");
  assert.equal(summary.totals.returningCustomers, 2);
  assert.equal(summary.zips.some((zip) => zip.zip === "60601"), false, "refund has no location point");
});
