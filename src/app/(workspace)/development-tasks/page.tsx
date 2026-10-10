import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/lib/auth/session";
import { formatTimestamp } from "@/lib/format";
import { loadRemoteDevTasks, toFounderReviewCard } from "@/lib/remote-development";

export const metadata: Metadata = {
  title: "Remote Development",
};

export default async function DevelopmentTasksPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const loaded = await loadRemoteDevTasks(session.supabase, { limit: 50 });
  if (loaded.status === "error") {
    return (
      <div className="stack-lg">
        <header className="page-header">
          <p className="eyebrow">Operations</p>
          <h1>Remote Development</h1>
        </header>
        <ErrorState message={loaded.message} />
      </div>
    );
  }

  const cards = loaded.data.map(toFounderReviewCard);
  const byStatus = {
    awaitingApproval: cards.filter((c) => c.status === "AWAITING_APPROVAL"),
    queued: cards.filter((c) => c.status === "QUEUED"),
    running: cards.filter((c) => c.status === "RUNNING"),
    blocked: cards.filter((c) => c.status === "BLOCKED"),
    failed: cards.filter((c) => c.status === "FAILED"),
    awaitingReview: cards.filter((c) => c.status === "AWAITING_FOUNDER_REVIEW"),
    verified: cards.filter((c) => c.status === "VERIFIED"),
  };

  return (
    <div className="stack-lg">
      <header className="page-header">
        <p className="eyebrow">Operations</p>
        <h1>Remote Development</h1>
        <p className="lede">
          Founder-approved remote development tasks. Only persisted rows appear here — never invented
          activity. Deployment stays separately authorized.
        </p>
      </header>

      <Panel title="Persistence">
        <p className="quiet">
          Showing {cards.length} recorded task{cards.length === 1 ? "" : "s"}. If the schema is not
          applied locally, this list stays empty (NOT VERIFIED against a disposable database in this
          environment).
        </p>
      </Panel>

      {(
        [
          ["Awaiting approval", byStatus.awaitingApproval],
          ["Queued", byStatus.queued],
          ["Running", byStatus.running],
          ["Blocked", byStatus.blocked],
          ["Failed", byStatus.failed],
          ["Awaiting founder review", byStatus.awaitingReview],
          ["Verified", byStatus.verified],
        ] as const
      ).map(([title, rows]) => (
        <section key={title} className="stack" aria-labelledby={`rd-${title}`}>
          <h2 id={`rd-${title}`}>
            {title} <span className="quiet">({rows.length})</span>
          </h2>
          {rows.length === 0 ? (
            <EmptyState>No tasks in this state.</EmptyState>
          ) : (
            <div className="stack">
              {rows.map((card) => (
                <article key={card.taskId} className="list-item">
                  <div className="approval-card-head">
                    <h3>
                      {card.objective.slice(0, 120)}
                      {card.objective.length > 120 ? "…" : ""}
                    </h3>
                    <StatusBadge status={card.status} />
                  </div>
                  <ul className="meta">
                    <li>Project: {card.projectName}</li>
                    <li>
                      Authorization: <code>{card.authorizationId}</code>
                    </li>
                    <li>
                      Repo: {card.repository} @ {card.baseBranch}
                    </li>
                    <li>Evidence: {card.evidenceState}</li>
                    {card.commitSha ? <li>Commit: {card.commitSha}</li> : null}
                    {card.pullRequestRef ? <li>PR: {card.pullRequestRef}</li> : null}
                    <li>Deployment authorized: no</li>
                  </ul>
                  <p>
                    <Link href={card.destinationHref}>Open project</Link>
                    {" · "}
                    <Link href="/approvals">Founder Approvals</Link>
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      ))}

      <p className="quiet">Updated view · {formatTimestamp(new Date().toISOString())}</p>
    </div>
  );
}
