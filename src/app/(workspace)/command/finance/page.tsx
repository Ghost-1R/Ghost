import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccessContext, hasFounderSurface } from "@/lib/access/session-access";
import { getSession } from "@/lib/auth/session";
import { createFinanceEntry } from "@/lib/command/actions";
import { loadCompaniesForUser } from "@/lib/companies/queries";
import { loose } from "@/lib/db/loose";

export const metadata: Metadata = {
  title: "Finance ledger",
};

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function CommandFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");
  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!hasFounderSurface(access)) redirect("/dashboard");

  const { company: companyFilter } = await searchParams;
  const companiesResult = await loadCompaniesForUser(session.supabase, session.user.id);
  const companies = companiesResult.status === "ok" ? companiesResult.data : [];
  const scopedIds = (
    companyFilter
      ? companies.filter((row) => row.id === companyFilter)
      : companies.filter((row) => access.ownedCompanyIds.includes(row.id))
  ).map((row) => row.id);

  const entriesQuery = scopedIds.length
    ? await loose(session.supabase)
        .from("ceo_finance_entries")
        .select(
          "id, company_id, kind, amount_cents, currency, status, label, source_ref, occurred_on, created_at",
        )
        .eq("owner_id", session.user.id)
        .in("company_id", scopedIds)
        .order("occurred_on", { ascending: false })
        .limit(80)
    : { data: [], error: null };

  const missing =
    entriesQuery.error &&
    /ceo_finance_entries|does not exist|schema cache/i.test(entriesQuery.error.message);

  const rows = missing ? [] : (entriesQuery.data ?? []);
  const byCompany = new Map(companies.map((row) => [row.id, row.name]));

  let cash = 0;
  let invoiced = 0;
  let expenses = 0;
  for (const row of rows) {
    const amount = Number(row.amount_cents) || 0;
    const kind = String(row.kind);
    const status = String(row.status);
    if (kind === "CASH" && status === "CLEARED") cash += amount;
    if (kind === "INVOICE" && status !== "VOID") invoiced += amount;
    if (kind === "EXPENSE" && status !== "VOID") expenses += amount;
    if (kind === "REFUND" && status === "CLEARED") cash -= amount;
  }

  return (
    <div className="stack" style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 80px" }}>
      <p className="ghost-brand">FINANCE</p>
      <h1>Company ledger</h1>
      <p className="quiet">
        Drill-down from Command totals. Cleared cash ≠ unpaid invoices. Live payment processing is
        not enabled.
      </p>
      <p className="meta">
        <Link href="/command#finance">← Command</Link>
      </p>

      {missing ? (
        <p role="status">
          `ceo_finance_entries` migration is not applied on this database. Apply{" "}
          <code>20261105093000_ceo_opportunities_finance.sql</code> on the disposable instance.
        </p>
      ) : (
        <>
          <section className="meta" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <strong>Cash collected</strong>
              <div>{money(cash)}</div>
            </div>
            <div>
              <strong>Invoiced</strong>
              <div>{money(invoiced)}</div>
            </div>
            <div>
              <strong>Expenses</strong>
              <div>{money(expenses)}</div>
            </div>
            <div>
              <strong>Profit (cash − expenses)</strong>
              <div>{money(cash - expenses)}</div>
            </div>
          </section>

          <form method="get" action="/command/finance" className="meta">
            <label htmlFor="fin-company">Company</label>
            <select id="fin-company" name="company" defaultValue={companyFilter ?? ""}>
              <option value="">All owned</option>
              {companies.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <button type="submit" className="button-secondary">
              Filter
            </button>
          </form>

          <h2>Source rows</h2>
          {rows.length === 0 ? (
            <p>No ledger rows in scope.</p>
          ) : (
            <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
              {rows.map((row) => (
                <li
                  key={String(row.id)}
                  style={{
                    borderBottom: "1px solid rgba(120,160,220,0.2)",
                    padding: "10px 0",
                  }}
                >
                  <strong>
                    {String(row.kind)} · {money(Number(row.amount_cents) || 0, String(row.currency || "USD"))}
                  </strong>
                  <div className="meta">
                    {byCompany.get(String(row.company_id)) ?? "Company"} · {String(row.status)} ·{" "}
                    {String(row.occurred_on)} · {String(row.label || row.source_ref || "—")}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <section className="stack" style={{ marginTop: 28 }}>
            <h2>Add manual entry</h2>
            <p className="quiet">Demo / local path. Prefer PENDING for unpaid invoices.</p>
            <form action={createFinanceEntry} className="stack" style={{ maxWidth: 420 }}>
              <label>
                Company
                <select name="companyId" required defaultValue={scopedIds[0] ?? ""}>
                  {companies
                    .filter((row) => access.ownedCompanyIds.includes(row.id))
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Kind
                <select name="kind" defaultValue="CASH">
                  <option value="CASH">CASH</option>
                  <option value="INVOICE">INVOICE</option>
                  <option value="EXPENSE">EXPENSE</option>
                  <option value="REFUND">REFUND</option>
                </select>
              </label>
              <label>
                Status
                <select name="status" defaultValue="CLEARED">
                  <option value="CLEARED">CLEARED</option>
                  <option value="PENDING">PENDING</option>
                  <option value="VOID">VOID</option>
                  <option value="REFUNDED">REFUNDED</option>
                </select>
              </label>
              <label>
                Amount (USD)
                <input name="amountDollars" type="number" step="0.01" required />
              </label>
              <label>
                Label
                <input name="label" maxLength={200} placeholder="Invoice # / deposit note" />
              </label>
              <button type="submit">Record entry</button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
