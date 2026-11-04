import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import {
  addEvidenceAction,
  createExecutionBlockerAction,
  createUpstreamChangeAction,
  escalateExecutionDecisionAction,
  initializeBuildExecutionAction,
  markPackageImplementedAction,
  refreshPackageReadinessAction,
  resolveExecutionBlockerAction,
  resolveUpstreamChangeAction,
  startPackageExecutionAction,
  syncExecutionNextActionAction,
  transitionBuildExecutionAction,
} from "@/lib/build-execution/actions";
import {
  loadBuildExecution,
  loadBuildExecutionBundle,
  loadBuildExecutionHistory,
} from "@/lib/build-execution/queries";
import {
  IMPLEMENTATION_EVIDENCE_KINDS,
  UPSTREAM_ARTIFACT_KINDS,
  UPSTREAM_CHANGE_STATUSES,
} from "@/lib/build-execution/types";
import { evaluateExecutionBundle } from "@/lib/build-execution/workflow";
import { loadBuildPlan } from "@/lib/build-plan/queries";
import { loadLatestConversation } from "@/lib/conversation/queries";
import { loadProjectDetail } from "@/lib/projects/queries";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Build Execution ${id.slice(0, 8)}` };
}

function options(values: readonly string[]) {
  return values.map((value) => (
    <option key={value} value={value}>
      {value}
    </option>
  ));
}

export default async function BuildExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (!UUID_PATTERN.test(projectId)) notFound();

  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status === "error") {
    return (
      <div className="stack">
        <h1>Build Execution</h1>
        <ErrorState message={project.message} />
      </div>
    );
  }
  if (!project.data) notFound();

  const executionResult = await loadBuildExecution(session.supabase, projectId);
  if (executionResult.status === "error") {
    return (
      <div className="stack">
        <h1>Build Execution</h1>
        <ErrorState message={executionResult.message} />
      </div>
    );
  }

  if (!executionResult.data) {
    const [conversation, plan] = await Promise.all([
      loadLatestConversation(session.supabase, projectId),
      loadBuildPlan(session.supabase, projectId),
    ]);
    const planStatus = plan.status === "ok" ? plan.data?.status ?? null : null;
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <p className="eyebrow">Build Execution</p>
            <h1>{project.data.name}</h1>
          </div>
          <Link className="button-secondary" href={`/projects/${projectId}`}>
            Back to project
          </Link>
        </div>
        <Panel title="Initialize Build Execution">
          <p className="quiet">
            Starts controlled implementation of a BUILD_PLAN_READY Build Plan. Package executions begin as QUEUED and
            become READY when dependencies are met. IMPLEMENTED means evidence-backed implementation only — not
            verified and not deployed. Ghost will not invent evidence.
          </p>
          {plan.status === "error" ? <ErrorState message={plan.message} /> : null}
          <p className="quiet">
            Build Plan: {planStatus ?? "not initialized"}
            {planStatus && planStatus !== "BUILD_PLAN_READY" ? " (must be BUILD_PLAN_READY first)" : ""}
          </p>
          <ActionForm action={initializeBuildExecutionAction} submitLabel="Initialize Build Execution">
            <input type="hidden" name="projectId" value={projectId} />
          </ActionForm>
        </Panel>
        <Panel title="Ask Ghost about this execution">
          <p className="quiet">
            Build Execution is not initialized yet. Answers must say what is unknown until execution records exist.
          </p>
          {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
          <GhostConversation
            projectId={projectId}
            projectName={project.data.name}
            conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
            messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
            providerConfigured={isModelConfigured()}
          />
        </Panel>
      </div>
    );
  }

  const execution = executionResult.data;
  const [bundleResult, history, conversation] = await Promise.all([
    loadBuildExecutionBundle(session.supabase, execution),
    loadBuildExecutionHistory(session.supabase, execution.id),
    loadLatestConversation(session.supabase, projectId),
  ]);

  if (bundleResult.status === "error") {
    return (
      <div className="stack">
        <h1>Build Execution</h1>
        <ErrorState message={bundleResult.message} />
      </div>
    );
  }

  const bundle = bundleResult.data;
  const { completion, waves, coverage, blockers: gaps } = evaluateExecutionBundle(bundle);
  const historyRows = history.status === "ok" ? history.data : [];
  const humanByWp = new Map(bundle.packages.map((row) => [row.id, row.humanId]));
  const titleByWp = new Map(bundle.packages.map((row) => [row.id, row.title]));
  const label = (workPackageId: string) =>
    `${humanByWp.get(workPackageId) ?? workPackageId.slice(0, 8)}: ${titleByWp.get(workPackageId) ?? "package"}`;

  const now = bundle.packageExecutions.filter((row) => row.status === "IN_PROGRESS");
  const ready = bundle.packageExecutions.filter((row) => row.status === "READY");
  const blocked = bundle.packageExecutions.filter((row) => row.status === "BLOCKED");
  const implemented = bundle.packageExecutions.filter((row) => row.status === "IMPLEMENTED");
  const openBlockers = bundle.blockers.filter((row) => row.status === "OPEN");
  const openUpstream = bundle.upstreamChanges.filter((row) => row.status === "OPEN");

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Build Execution</p>
          <h1>{project.data.name}</h1>
        </div>
        <ul className="meta">
          <li>
            <StatusBadge status={execution.status} />
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}`}>
              Project
            </Link>
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}/build-plan`}>
              Build Plan
            </Link>
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}/verification`}>
              Verification
            </Link>
          </li>
        </ul>
      </div>

      <Panel title="Lifecycle">
        <p>
          Status <strong>{execution.status}</strong> · Build Plan {bundle.planStatus ?? "missing"} · Packages{" "}
          {bundle.packageExecutions.length}
        </p>
        <ul className="meta">
          <li>In progress: {now.length}</li>
          <li>Ready: {ready.length}</li>
          <li>Blocked: {blocked.length}</li>
          <li>Implemented: {implemented.length}</li>
          <li>Evidence: {bundle.evidence.length}</li>
          <li>Open blockers: {openBlockers.length}</li>
          <li>Open upstream: {openUpstream.length}</li>
          <li>Open decisions: {bundle.openDecisionCount}</li>
        </ul>
        <p className="quiet">
          IMPLEMENTED means evidence-backed implementation only. It is not verified and not deployed. V6–V8 records are
          not silently rewritten from this page.
        </p>
        <div className="meta">
          {(["EXECUTING", "IMPLEMENTATION_REVIEW", "IMPLEMENTED"] as const).map((status) => (
            <ActionForm key={status} action={transitionBuildExecutionAction} submitLabel={`Move to ${status}`}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="toStatus" value={status} />
              <input type="hidden" name="reason" value={`Founder moved Build Execution to ${status}.`} />
            </ActionForm>
          ))}
        </div>
        <ActionForm action={syncExecutionNextActionAction} submitLabel="Record justified next action">
          <input type="hidden" name="projectId" value={projectId} />
        </ActionForm>
        <ActionForm action={refreshPackageReadinessAction} submitLabel="Recompute package readiness">
          <input type="hidden" name="projectId" value={projectId} />
        </ActionForm>
      </Panel>

      <Panel title="Readiness / completion gaps">
        {completion.implementationComplete ? (
          <>
            <p>
              <strong>IMPLEMENTATION COMPLETE</strong> (not verified, not deployed)
            </p>
            <ul className="meta">
              {completion.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p>
              <strong>NOT COMPLETE</strong> · {gaps.length} item{gaps.length === 1 ? "" : "s"} remaining
            </p>
            <ul className="meta">
              {gaps.map((gap) => (
                <li key={gap.code}>{gap.message}</li>
              ))}
            </ul>
          </>
        )}
        {waves.length > 0 ? (
          <p className="quiet">
            Remaining waves:{" "}
            {waves.map((wave, index) => `W${index + 1}[${wave.join(", ")}]`).join("; ")}
          </p>
        ) : (
          <p className="quiet">No remaining execution waves.</p>
        )}
      </Panel>

      <Panel title="Now">
        {now.length === 0 ? <EmptyState>No package is IN_PROGRESS.</EmptyState> : null}
        {now.map((pkg) => (
          <article className="list-item" key={pkg.id}>
            <h3>{label(pkg.workPackageId)}</h3>
            <p className="quiet">Status: {pkg.status}</p>
            <ActionForm action={addEvidenceAction} submitLabel="Add evidence">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="packageExecutionId" value={pkg.id} />
              <label className="field">
                <span>Kind</span>
                <select name="kind" defaultValue="COMMIT">
                  {options(IMPLEMENTATION_EVIDENCE_KINDS)}
                </select>
              </label>
              <label className="field">
                <span>Reference (no secrets)</span>
                <input name="reference" required placeholder="commit SHA, path, route…" />
              </label>
              <label className="field">
                <span>Summary</span>
                <textarea name="summary" />
              </label>
            </ActionForm>
            <ActionForm action={markPackageImplementedAction} submitLabel="Mark IMPLEMENTED">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="packageExecutionId" value={pkg.id} />
              <label className="field">
                <span>Notes</span>
                <textarea name="notes" />
              </label>
            </ActionForm>
            <ActionForm action={createExecutionBlockerAction} submitLabel="Record blocker">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="packageExecutionId" value={pkg.id} />
              <label className="field">
                <span>Description</span>
                <textarea name="description" required />
              </label>
            </ActionForm>
          </article>
        ))}
      </Panel>

      <Panel title="Ready">
        {ready.length === 0 ? <EmptyState>No packages are READY.</EmptyState> : null}
        {ready.map((pkg) => (
          <article className="list-item" key={pkg.id}>
            <h3>{label(pkg.workPackageId)}</h3>
            <ActionForm action={startPackageExecutionAction} submitLabel="Start package">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="packageExecutionId" value={pkg.id} />
            </ActionForm>
          </article>
        ))}
      </Panel>

      <Panel title="Blocked">
        {blocked.length === 0 && openBlockers.length === 0 ? (
          <EmptyState>No blocked packages or open blockers.</EmptyState>
        ) : null}
        {blocked.map((pkg) => (
          <article className="list-item" key={pkg.id}>
            <h3>{label(pkg.workPackageId)}</h3>
            <p className="quiet">Status: BLOCKED</p>
          </article>
        ))}
        {openBlockers.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>Open blocker</h3>
            <p>{row.description}</p>
            <ActionForm action={resolveExecutionBlockerAction} submitLabel="Resolve blocker">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="blockerId" value={row.id} />
              <label className="field">
                <span>Resolution</span>
                <textarea name="resolution" required />
              </label>
            </ActionForm>
          </article>
        ))}
      </Panel>

      <Panel title="Implemented">
        {implemented.length === 0 ? <EmptyState>No packages are IMPLEMENTED yet.</EmptyState> : null}
        {implemented.map((pkg) => (
          <article className="list-item" key={pkg.id}>
            <h3>{label(pkg.workPackageId)}</h3>
            <p className="quiet">
              Completed {pkg.completedAt ?? "unknown"} · evidence{" "}
              {bundle.evidence.filter((row) => row.packageExecutionId === pkg.id).length}
            </p>
          </article>
        ))}
      </Panel>

      <Panel title="Coverage">
        <p className="quiet">Requirement/feature coverage via V8 work package links → package execution status.</p>
        <h3>Requirements</h3>
        <ul className="meta">
          {coverage.requirements.slice(0, 20).map((row) => (
            <li key={row.id}>
              {row.humanId}: {row.implemented ? "IMPLEMENTED" : row.packageExecutionStatuses.join(", ") || "unlinked"}
            </li>
          ))}
        </ul>
        <h3>Features</h3>
        <ul className="meta">
          {coverage.features.slice(0, 20).map((row) => (
            <li key={row.id}>
              {row.humanId}: {row.implemented ? "IMPLEMENTED" : row.packageExecutionStatuses.join(", ") || "unlinked"}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Evidence">
        {bundle.evidence.length === 0 ? <EmptyState>No implementation evidence recorded.</EmptyState> : null}
        {bundle.evidence.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.kind}: {row.reference}
            </h3>
            <p className="quiet">{row.summary || "No summary"}</p>
          </article>
        ))}
        <ActionForm action={addEvidenceAction} submitLabel="Add evidence to package">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Package execution</span>
            <select name="packageExecutionId" required>
              {bundle.packageExecutions.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {label(pkg.workPackageId)} ({pkg.status})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Kind</span>
            <select name="kind" defaultValue="COMMIT">
              {options(IMPLEMENTATION_EVIDENCE_KINDS)}
            </select>
          </label>
          <label className="field">
            <span>Reference</span>
            <input name="reference" required />
          </label>
          <label className="field">
            <span>Summary</span>
            <textarea name="summary" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Decisions">
        {bundle.openDecisions.length === 0 ? <EmptyState>No open project decisions.</EmptyState> : null}
        {bundle.openDecisions.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>{row.title}</h3>
            <p>{row.question}</p>
          </article>
        ))}
        <ActionForm action={escalateExecutionDecisionAction} submitLabel="Escalate execution decision">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Question</span>
            <textarea name="question" required />
          </label>
          <label className="field">
            <span>Option A</span>
            <input name="optionA" />
          </label>
          <label className="field">
            <span>Option B</span>
            <input name="optionB" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Upstream">
        <p className="quiet">
          Upstream changes protect V6–V8. Record issues here; do not silently rewrite product, system, or plan records.
        </p>
        {openUpstream.length === 0 ? <EmptyState>No open upstream changes.</EmptyState> : null}
        {bundle.upstreamChanges.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.artifactKind} ({row.status})
            </h3>
            <p>{row.issue}</p>
            {row.status === "OPEN" ? (
              <ActionForm action={resolveUpstreamChangeAction} submitLabel="Resolve upstream change">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="changeId" value={row.id} />
                <label className="field">
                  <span>Resolution</span>
                  <textarea name="resolution" required />
                </label>
                <label className="field">
                  <span>Status</span>
                  <select name="status" defaultValue="RESOLVED">
                    {options(UPSTREAM_CHANGE_STATUSES.filter((value) => value !== "OPEN"))}
                  </select>
                </label>
              </ActionForm>
            ) : null}
          </article>
        ))}
        <ActionForm action={createUpstreamChangeAction} submitLabel="Record upstream change">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Artifact kind</span>
            <select name="artifactKind" defaultValue="BUILD_PLAN">
              {options(UPSTREAM_ARTIFACT_KINDS)}
            </select>
          </label>
          <label className="field">
            <span>Artifact ref</span>
            <input name="artifactRef" />
          </label>
          <label className="field">
            <span>Package (optional)</span>
            <select name="packageExecutionId" defaultValue="">
              <option value="">None</option>
              {bundle.packageExecutions.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {label(pkg.workPackageId)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Issue</span>
            <textarea name="issue" required />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="History">
        {historyRows.length === 0 ? <EmptyState>No transitions recorded yet.</EmptyState> : null}
        <ul className="meta">
          {historyRows.map((row) => (
            <li key={row.id}>
              {row.fromStatus ?? "∅"} → {row.toStatus} · {row.reason} · {row.changedAt}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Ask Ghost">
        <p className="quiet">
          Ask about what is building now, what is next, blockers, coverage, and evidence. Ghost must not claim
          verification or deployment from V9 records.
        </p>
        {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
        <GhostConversation
          projectId={projectId}
          projectName={project.data.name}
          conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
          messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
          providerConfigured={isModelConfigured()}
        />
      </Panel>
    </div>
  );
}
