/**
 * Labeled TEST orders for local sales-map verification. Always is_test = true and
 * external ids start with "TEST-" so they can never be mistaken for real sales.
 */

export type TestOrderRow = {
  company_id: string;
  external_order_id: string;
  customer_key: string;
  paid_at: string;
  amount_cents: number;
  payment_state: "PAID" | "REFUNDED" | "PARTIAL_REFUND";
  fulfillment: "SHIPPED" | "PICKUP" | "UNKNOWN";
  shipping_zip: string | null;
  shipping_state: string | null;
  is_test: true;
  history_complete: true;
};

export type TestOrderLabel =
  | "first-time"
  | "returning"
  | "refund"
  | "pickup"
  | "missing-zip";

export type LabeledTestOrder = { label: TestOrderLabel; row: TestOrderRow };

export const TEST_PROSPECTS = [
  { label: "TEST prospect · Dallas", zip: "75201", state_code: "TX" },
  { label: "TEST prospect · Seattle", zip: "98101", state_code: "WA" },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildLabeledTestOrders(
  companyId: string,
  now: Date = new Date(),
): LabeledTestOrder[] {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const make = (
    label: TestOrderLabel,
    externalId: string,
    fields: Omit<TestOrderRow, "company_id" | "external_order_id" | "is_test" | "history_complete">,
  ): LabeledTestOrder => ({
    label,
    row: {
      company_id: companyId,
      external_order_id: externalId,
      is_test: true,
      history_complete: true,
      ...fields,
    },
  });

  return [
    make("first-time", "TEST-FIRST-TIME-NY", {
      customer_key: "test-cust-ny-1",
      paid_at: ago(40),
      amount_cents: 4500,
      payment_state: "PAID",
      fulfillment: "SHIPPED",
      shipping_zip: "10001",
      shipping_state: "NY",
    }),
    make("first-time", "TEST-FIRST-TIME-GA", {
      customer_key: "test-cust-ga-1",
      paid_at: ago(30),
      amount_cents: 3200,
      payment_state: "PAID",
      fulfillment: "SHIPPED",
      shipping_zip: "30301",
      shipping_state: "GA",
    }),
    make("first-time", "TEST-FIRST-TIME-CA", {
      customer_key: "test-cust-ca-1",
      paid_at: ago(25),
      amount_cents: 7800,
      payment_state: "PAID",
      fulfillment: "SHIPPED",
      shipping_zip: "94105",
      shipping_state: "CA",
    }),
    make("first-time", "TEST-FIRST-TIME-TX", {
      customer_key: "test-cust-tx-1",
      paid_at: ago(20),
      amount_cents: 6100,
      payment_state: "PAID",
      fulfillment: "SHIPPED",
      shipping_zip: "78701",
      shipping_state: "TX",
    }),
    make("returning", "TEST-RETURNING-NY", {
      customer_key: "test-cust-ny-1",
      paid_at: ago(10),
      amount_cents: 2900,
      payment_state: "PAID",
      fulfillment: "SHIPPED",
      shipping_zip: "10001",
      shipping_state: "NY",
    }),
    make("returning", "TEST-RETURNING-GA", {
      customer_key: "test-cust-ga-1",
      paid_at: ago(7),
      amount_cents: 3800,
      payment_state: "PAID",
      fulfillment: "SHIPPED",
      shipping_zip: "30308",
      shipping_state: "GA",
    }),
    make("refund", "TEST-REFUND-IL", {
      customer_key: "test-cust-il-1",
      paid_at: ago(15),
      amount_cents: 5100,
      payment_state: "REFUNDED",
      fulfillment: "SHIPPED",
      shipping_zip: "60601",
      shipping_state: "IL",
    }),
    make("pickup", "TEST-PICKUP", {
      customer_key: "test-cust-pickup-1",
      paid_at: ago(5),
      amount_cents: 2600,
      payment_state: "PAID",
      fulfillment: "PICKUP",
      shipping_zip: null,
      shipping_state: null,
    }),
    make("missing-zip", "TEST-MISSING-ZIP", {
      customer_key: "test-cust-nozip-1",
      paid_at: ago(3),
      amount_cents: 3900,
      payment_state: "PAID",
      fulfillment: "SHIPPED",
      shipping_zip: null,
      shipping_state: null,
    }),
  ];
}
