import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAccessContext, hasFounderSurface } from "@/lib/access/session-access";
import { loadCompanyTimeline, formatRelativeTime } from "@/lib/activity/queries";
import { getSession } from "@/lib/auth/session";
import { loadCompaniesForUser } from "@/lib/companies/queries";
import { markCommunicationsRead } from "@/lib/command/actions";
import { INBOX_READ_COOKIE } from "@/lib/command/cookies";

export const metadata: Metadata = {
  title: "Communications",
};

export default async function CommunicationsPage({
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
  const scoped = companyFilter
    ? companies.filter((row) => row.id === companyFilter)
    : companies.filter((row) => access.ownedCompanyIds.includes(row.id));

  const timelines = await Promise.all(
    scoped.slice(0, 8).map(async (company) => {
      const timeline = await loadCompanyTimeline(session.supabase, company.id, {
        limit: 30,
        includePresence: true,
      });
      return {
        company,
        entries: timeline.status === "ok" ? timeline.data : [],
        error: timeline.status === "error" ? timeline.message : null,
      };
    }),
  );

  const jar = await cookies();
  const readIds = new Set(
    (jar.get(INBOX_READ_COOKIE)?.value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );

  const inbox = timelines
    .flatMap(({ company, entries }) =>
      entries.map((entry) => ({
        ...entry,
        companyName: company.name,
        companyId: company.id,
        href: entry.projectId
          ? `/projects/${entry.projectId}`
          : `/companies/${company.id}`,
        unread: !readIds.has(entry.id),
      })),
    )
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 60);

  const unreadCount = inbox.filter((item) => item.unread).length;

  return (
    <div className="stack" style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 80px" }}>
      <header className="stack" style={{ gap: 8 }}>
        <p className="ghost-brand">COMMUNICATIONS</p>
        <h1>Inbox</h1>
        <p className="quiet">
          Ghost activity and presence from companies you can access. External outbound mail stays
          draft or approval-gated. Unread uses a local cookie — not a separate mailbox table.
        </p>
        <p className="meta">
          {unreadCount} unread · {inbox.length} shown ·{" "}
          <Link href="/command">Back to Command</Link> ·{" "}
          <Link href="/dashboard#ask-ghost">Ask Ghost</Link>
        </p>
      </header>

      <form method="get" className="meta" action="/communications">
        <label htmlFor="comms-company">Company</label>
        <select id="comms-company" name="company" defaultValue={companyFilter ?? ""}>
          <option value="">All owned companies</option>
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

      {inbox.length === 0 ? (
        <p role="status">No activity recorded yet for the selected companies.</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, gap: 10 }}>
          {inbox.map((item) => (
            <li
              key={item.id}
              style={{
                border: "1px solid rgba(120,160,220,0.25)",
                borderRadius: 8,
                padding: "12px 14px",
                background: item.unread ? "rgba(40,70,120,0.25)" : "transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>
                  {item.unread ? "● " : ""}
                  {item.summary || item.action}
                </strong>
                <span className="quiet">{formatRelativeTime(item.at)}</span>
              </div>
              <p className="meta" style={{ marginTop: 6 }}>
                {item.companyName} · {item.actorLabel} · {item.action}
                {item.externalUnconnected ? " · external source unconnected" : ""}
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                <Link href={item.href}>Open source</Link>
                {item.unread && (
                  <form action={markCommunicationsRead}>
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" className="button-secondary">
                      Mark read
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="stack" style={{ marginTop: 24 }}>
        <h2>External connectors</h2>
        <p className="quiet">
          Email / Slack / CRM outbound is not enabled in this build. Configure providers in Settings
          when authorized; until then Ghost keeps consequential sends behind approvals.
        </p>
        <Link href="/settings">Open Settings →</Link>
      </section>
    </div>
  );
}
