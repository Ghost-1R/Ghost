import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, ErrorState } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { loadFounderAuthorizations } from "@/lib/approvals/queries";
import { getSession } from "@/lib/auth/session";
import { loadOpenDecisions } from "@/lib/decisions/queries";
import { formatTimestamp } from "@/lib/format";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Decisions",
};

export default async function DecisionsPage() {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const [projects, decisions, authorizations] = await Promise.all([
    loadProjectSummaries(session.supabase),
    loadOpenDecisions(session.supabase),
    loadFounderAuthorizations(session.supabase, session.user.id),
  ]);

  const projectNames = new Map(
    projects.status === "ok" ? projects.data.map((row) => [row.id, row.name]) : [],
  );
  const decisionList = decisions.status === "ok" ? decisions.data : [];
  const pendingAuth =
    authorizations.status === "ok"
      ? authorizations.data.filter(
          (row) => row.effectiveStatus === "PENDING" || row.status === "PENDING",
        )
      : [];

  return (
    <div className="surface-page">
      <header className="surface-hero">
        <p className="eyebrow">Decisions</p>
        <h1>What needs your judgment</h1>
        <p className="quiet">
          Judgment and executable authorizations stay separate. Approving a discussion is not paid
          dispatch.
        </p>
        <p>
          <Link href="/approvals">Open Approval Center</Link>
        </p>
      </header>

      <section className="surface-grid" aria-label="Decision queues">
        <article className="list-item">
          <p className="eyebrow">Open decisions</p>
          <p className="worker-count">{decisionList.length}</p>
        </article>
        <article className="list-item">
          <p className="eyebrow">Pending authorizations</p>
          <p className="worker-count">{pendingAuth.length}</p>
        </article>
        <article className="list-item">
          <p className="eyebrow">Projects in view</p>
          <p className="worker-count">{projects.status === "ok" ? projects.data.length : 0}</p>
        </article>
      </section>

      {decisions.status === "error" ? (
        <ErrorState message="Open decisions could not be loaded." />
      ) : null}
      {authorizations.status === "error" ? (
        <ErrorState message="Authorizations could not be loaded." />
      ) : null}

      <section aria-labelledby="open-decisions-heading">
        <h2 id="open-decisions-heading">Open decisions</h2>
        {decisionList.length === 0 ? (
          <EmptyState>Nothing is waiting on a founder decision.</EmptyState>
        ) : (
          <ul className="worker-approvals">
            {decisionList.map((decision) => (
              <li key={decision.id} className="list-item">
                <h3>{decision.title}</h3>
                <p>{decision.question}</p>
                <p className="quiet">
                  {projectNames.get(decision.projectId ?? "") ?? "Workspace"} ·{" "}
                  {formatTimestamp(decision.createdAt)}
                </p>
                {decision.projectId ? (
                  <Link href={`/projects/${decision.projectId}`}>Open project</Link>
                ) : (
                  <Link href="/dashboard">Back to Today</Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pending-auth-heading">
        <h2 id="pending-auth-heading">Pending authorizations</h2>
        {pendingAuth.length === 0 ? (
          <EmptyState>No PENDING one-time authorizations.</EmptyState>
        ) : (
          <ul className="worker-approvals">
            {pendingAuth.map((auth) => (
              <li key={auth.id} className="list-item">
                <div className="approval-card-head">
                  <h3>
                    {auth.actionType}
                    <span className="quiet"> · {auth.projectName}</span>
                  </h3>
                  <StatusBadge status={auth.effectiveStatus} />
                </div>
                <p>
                  <strong>Scope:</strong> {auth.actionScope}
                </p>
                <p className="quiet">
                  Fingerprint {auth.scopeFingerprint.slice(0, 16)}… · spend {auth.estimatedCost} ·
                  expires {formatTimestamp(auth.expiresAt)}
                </p>
                <Link href="/approvals">Review in Approval Center</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
