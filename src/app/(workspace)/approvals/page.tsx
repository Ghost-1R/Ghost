import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  approveFounderAuthorization,
  bucketAuthorizations,
  loadAuthorizationEvents,
  loadFounderAuthorizations,
  rejectFounderAuthorization,
  requestFounderAuthorization,
  revokeFounderAuthorization,
  type FounderActionAuthorization,
} from "@/lib/approvals";
import { getSession } from "@/lib/auth/session";
import { loadOpenDecisions } from "@/lib/decisions/queries";
import { formatTimestamp } from "@/lib/format";
import { loadProjectSummaries } from "@/lib/projects/queries";
import { randomUUID } from "node:crypto";

export const metadata: Metadata = {
  title: "Approvals",
};

function AuthorizationCard({
  row,
  events,
}: {
  row: FounderActionAuthorization;
  events: Array<{ id: string; eventType: string; detail: string; createdAt: string }>;
}) {
  const effective = row.effectiveStatus;
  return (
    <article className="list-item approval-card" data-status={effective}>
      <div className="approval-card-head">
        <h3>
          {row.actionType}
          <span className="quiet"> · {row.projectName}</span>
        </h3>
        <StatusBadge status={effective} />
      </div>
      <ul className="meta">
        <li>Environment: {row.environmentLabel}</li>
        <li>Reuse: {row.reusePolicy}{row.maxUses != null ? ` (max ${row.maxUses})` : ""}</li>
        <li>Uses: {row.useCount}</li>
        <li>Requested {formatTimestamp(row.requestedAt)}</li>
        <li>Expires {formatTimestamp(row.expiresAt)}</li>
        {row.decidedAt ? <li>Decided {formatTimestamp(row.decidedAt)}</li> : null}
        {row.revokedAt ? <li>Revoked {formatTimestamp(row.revokedAt)}</li> : null}
        <li>Cost: {row.estimatedCost}</li>
        {row.decisionId ? (
          <li>
            Linked decision:{" "}
            <Link href={`/projects/${row.projectId}`}>open project decision</Link>
          </li>
        ) : null}
      </ul>
      <p>
        <strong>Scope:</strong> {row.actionScope}
      </p>
      <p>
        <strong>Reason:</strong> {row.reason}
      </p>
      {row.sideEffects ? (
        <p className="quiet">
          <strong>Side effects:</strong> {row.sideEffects}
        </p>
      ) : (
        <p className="quiet">Side effects: none recorded</p>
      )}
      {row.evidence.length > 0 ? (
        <ul className="meta">
          {row.evidence.map((item, index) => (
            <li key={`${item.reference}-${index}`}>
              Evidence: {item.source} · {item.reference}
              {item.at ? ` · ${formatTimestamp(item.at)}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="quiet">No evidence references attached.</p>
      )}
      <p className="quiet mono">Fingerprint {row.scopeFingerprint.slice(0, 12)}…</p>

      {effective === "PENDING" ? (
        <div className="approval-actions">
          <ActionForm action={approveFounderAuthorization} submitLabel="Approve">
            <input type="hidden" name="authorizationId" value={row.id} />
          </ActionForm>
          <ActionForm action={rejectFounderAuthorization} submitLabel="Reject">
            <input type="hidden" name="authorizationId" value={row.id} />
          </ActionForm>
        </div>
      ) : null}

      {effective === "APPROVED" ? (
        <ActionForm action={revokeFounderAuthorization} submitLabel="Revoke">
          <input type="hidden" name="authorizationId" value={row.id} />
          <label className="field">
            <span>Revoke reason</span>
            <input name="revokeReason" required maxLength={2000} placeholder="Why this authorization ends" />
          </label>
        </ActionForm>
      ) : null}

      {effective === "EXPIRED" ? (
        <p className="notice">Expired — cannot approve, reject, or authorize execution.</p>
      ) : null}

      <details className="approval-audit">
        <summary>Inspect audit history ({events.length})</summary>
        {events.length === 0 ? (
          <EmptyState>No audit events recorded yet.</EmptyState>
        ) : (
          <ul className="meta">
            {events.map((event) => (
              <li key={event.id}>
                {event.eventType} · {formatTimestamp(event.createdAt)} — {event.detail}
              </li>
            ))}
          </ul>
        )}
      </details>
    </article>
  );
}

export default async function ApprovalsPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const [authorizations, projects, openDecisions] = await Promise.all([
    loadFounderAuthorizations(session.supabase, session.user.id),
    loadProjectSummaries(session.supabase),
    loadOpenDecisions(session.supabase),
  ]);

  const rows = authorizations.status === "ok" ? authorizations.data : [];
  const projectList = projects.status === "ok" ? projects.data : [];
  const decisions = openDecisions.status === "ok" ? openDecisions.data : [];
  const buckets = bucketAuthorizations(rows);

  const eventEntries = await Promise.all(
    rows.slice(0, 40).map(async (row) => {
      const events = await loadAuthorizationEvents(session.supabase, session.user.id, row.id);
      return [row.id, events.status === "ok" ? events.data : []] as const;
    }),
  );
  const eventsById = new Map(eventEntries);

  const defaultIdempotency = randomUUID();

  return (
    <div className="stack approvals-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Founder Approval Center</p>
          <h1>Authorize exact actions.</h1>
          <p className="quiet lede">
            Project decisions are judgment. These records are limited executable authorizations.
            Approving does not run the action. Executors must revalidate scope, ownership, and
            expiry before use.
          </p>
        </div>
      </div>

      {authorizations.status === "error" ? <ErrorState message={authorizations.message} /> : null}

      <Panel title="Request authorization">
        <p className="quiet">
          Deny by default. Provide project, exact action, scope, reason, and expiration. Double
          submit with the same idempotency key returns the existing request.
        </p>
        {projectList.length === 0 ? (
          <EmptyState>Create a project before requesting action authorization.</EmptyState>
        ) : (
          <ActionForm action={requestFounderAuthorization} submitLabel="Request authorization">
            <input type="hidden" name="idempotencyKey" value={defaultIdempotency} />
            <label className="field">
              <span>Project</span>
              <select name="projectId" required defaultValue={projectList[0]?.id}>
                {projectList.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Environment</span>
              <input name="environmentLabel" defaultValue="LOCAL" maxLength={80} required />
            </label>
            <label className="field">
              <span>Linked project decision (optional)</span>
              <select name="decisionId" defaultValue="">
                <option value="">None — judgment only, no link</option>
                {decisions.map((decision) => (
                  <option key={decision.id} value={decision.id}>
                    {decision.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Exact action type</span>
              <input
                name="actionType"
                required
                maxLength={120}
                placeholder="e.g. start_deployment"
              />
            </label>
            <label className="field">
              <span>Exact action scope</span>
              <textarea
                name="actionScope"
                required
                maxLength={2000}
                placeholder="Bound identifiers only — release id, commit SHA, check name"
              />
            </label>
            <label className="field">
              <span>Reason</span>
              <textarea name="reason" required maxLength={4000} />
            </label>
            <label className="field">
              <span>Side effects (if known)</span>
              <textarea name="sideEffects" maxLength={4000} placeholder="Optional" />
            </label>
            <label className="field">
              <span>Estimated cost</span>
              <input name="estimatedCost" defaultValue="UNKNOWN" maxLength={200} />
            </label>
            <label className="field">
              <span>Evidence source</span>
              <input name="evidenceSource" maxLength={120} placeholder="e.g. project_truth" />
            </label>
            <label className="field">
              <span>Evidence reference</span>
              <input name="evidenceReference" maxLength={200} placeholder="e.g. DEP-12" />
            </label>
            <label className="field">
              <span>Expires in hours (1–168)</span>
              <input name="expiresInHours" type="number" min={1} max={168} defaultValue={24} required />
            </label>
            <label className="field">
              <span>Reuse policy</span>
              <select name="reusePolicy" defaultValue="ONE_TIME">
                <option value="ONE_TIME">ONE_TIME</option>
                <option value="BOUNDED">BOUNDED</option>
              </select>
            </label>
            <label className="field">
              <span>Max uses (BOUNDED only)</span>
              <input name="maxUses" type="number" min={1} max={100} defaultValue={1} />
            </label>
          </ActionForm>
        )}
      </Panel>

      <Panel title="Pending requests">
        {buckets.pending.length === 0 ? <EmptyState>No pending authorization requests.</EmptyState> : null}
        {buckets.pending.map((row) => (
          <AuthorizationCard key={row.id} row={row} events={eventsById.get(row.id) ?? []} />
        ))}
      </Panel>

      <Panel title="Approved">
        {buckets.approved.length === 0 ? <EmptyState>No active approvals.</EmptyState> : null}
        {buckets.approved.map((row) => (
          <AuthorizationCard key={row.id} row={row} events={eventsById.get(row.id) ?? []} />
        ))}
      </Panel>

      <Panel title="Rejected">
        {buckets.rejected.length === 0 ? <EmptyState>No rejected requests.</EmptyState> : null}
        {buckets.rejected.map((row) => (
          <AuthorizationCard key={row.id} row={row} events={eventsById.get(row.id) ?? []} />
        ))}
      </Panel>

      <Panel title="Expired or revoked">
        {buckets.expiredOrRevoked.length === 0 ? (
          <EmptyState>No expired or revoked authorizations.</EmptyState>
        ) : null}
        {buckets.expiredOrRevoked.map((row) => (
          <AuthorizationCard key={row.id} row={row} events={eventsById.get(row.id) ?? []} />
        ))}
      </Panel>

      {buckets.consumed.length > 0 ? (
        <Panel title="Consumed (one-time / exhausted)">
          {buckets.consumed.map((row) => (
            <AuthorizationCard key={row.id} row={row} events={eventsById.get(row.id) ?? []} />
          ))}
        </Panel>
      ) : null}

      <Panel title="Related project decisions (not executable)">
        <p className="quiet">
          These are ordinary founder judgments from Project Brain. Resolving them does not authorize
          execution. Create an authorization request above to grant limited action scope.
        </p>
        {decisions.length === 0 ? <EmptyState>No open project decisions.</EmptyState> : null}
        <ul className="ghost-home-rail-list">
          {decisions.map((decision) => (
            <li key={decision.id}>
              <p>{decision.title}</p>
              <p className="quiet">{decision.question}</p>
              <Link href={decision.projectId ? `/projects/${decision.projectId}` : "/dashboard"}>
                Open decision
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
