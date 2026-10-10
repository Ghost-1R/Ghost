import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/lib/auth/session";
import { formatTimestamp } from "@/lib/format";
import { loadProjectSummaries } from "@/lib/projects/queries";
import {
  approveDevelopmentWorkflow,
  cancelDevelopmentWorkflow,
  listMemoryDevelopmentTasksForOwner,
  queueDevelopmentWorkflow,
  reviewDevelopmentWorkflow,
  runSimulatedDevelopmentWorkflow,
  submitDevelopmentRequest,
  verifyDevelopmentEvidenceWorkflow,
} from "@/lib/remote-development/actions";
import { toFounderInboxCard } from "@/lib/remote-development/inbox";
import {
  MEMORY_PERSISTENCE_MODE,
  memoryLoadAuthorization,
} from "@/lib/remote-development/memory-store";
import { loadRemoteDevTasks } from "@/lib/remote-development/queries";

export const metadata: Metadata = {
  title: "Remote Development",
};

export default async function DevelopmentTasksPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const [dbLoaded, projects] = await Promise.all([
    loadRemoteDevTasks(session.supabase, { limit: 50 }),
    loadProjectSummaries(session.supabase),
  ]);

  if (dbLoaded.status === "error" && !/not available|does not exist|schema cache/i.test(dbLoaded.message)) {
    return (
      <div className="stack-lg">
        <header className="page-header">
          <p className="eyebrow">Operations</p>
          <h1>Remote Development</h1>
        </header>
        <ErrorState message={dbLoaded.message} />
      </div>
    );
  }

  const memoryTasks = await listMemoryDevelopmentTasksForOwner(session.user.id);
  const dbTasks = dbLoaded.status === "ok" ? dbLoaded.data : [];
  // Prefer memory workflow tasks for this cloud demo; merge by id without inventing rows.
  const byId = new Map(dbTasks.map((t) => [t.id, t]));
  for (const task of memoryTasks) byId.set(task.id, task);
  const tasks = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const cards = tasks.map((task) =>
    toFounderInboxCard({
      task,
      authorization: memoryLoadAuthorization(task.binding.authorizationId),
      persistenceMode: memoryTasks.some((m) => m.id === task.id)
        ? MEMORY_PERSISTENCE_MODE
        : "DATABASE",
    }),
  );

  const projectList = projects.status === "ok" ? projects.data : [];
  const defaultIdempotency = randomUUID();

  const byStage = {
    awaitingApproval: cards.filter(
      (c) => c.workflowStage === "AWAITING_APPROVAL" || c.workflowStage === "DRAFT",
    ),
    approved: cards.filter((c) => c.workflowStage === "APPROVED"),
    queued: cards.filter((c) => c.workflowStage === "QUEUED"),
    running: cards.filter((c) => c.workflowStage === "RUNNING"),
    blocked: cards.filter((c) => c.workflowStage === "BLOCKED"),
    failed: cards.filter((c) => c.workflowStage === "FAILED"),
    awaitingReview: cards.filter((c) => c.workflowStage === "AWAITING_REVIEW"),
    reviewed: cards.filter((c) => c.workflowStage === "REVIEWED"),
  };

  return (
    <div className="stack-lg">
      <header className="page-header">
        <p className="eyebrow">Operations</p>
        <h1>Remote Development</h1>
        <p className="lede">
          End-to-end DEVELOPMENT workflow: request → founder authorization → queue →{" "}
          <strong>SIMULATED</strong> fake-provider execution → founder review. Never live agent
          dispatch. Deployment stays separately authorized.
        </p>
      </header>

      <Panel title="Persistence">
        <p className="quiet">
          Showing {cards.length} task{cards.length === 1 ? "" : "s"}. Cloud demo persistence is{" "}
          <code>{MEMORY_PERSISTENCE_MODE}</code> (process-local). Hosted SQL writes: 0. Database
          schema apply remains NOT VERIFIED in this environment.
        </p>
      </Panel>

      <Panel title="New development request">
        <p className="quiet">
          Creates a PENDING DEVELOPMENT authorization bound to an exact scope fingerprint. Approving
          does not execute. Simulated runs are labeled SIMULATED and never become Project Truth
          VERIFIED_LOCALLY / VERIFIED_IN_PRODUCTION.
        </p>
        {projectList.length === 0 ? (
          <EmptyState>Create a project before requesting development work.</EmptyState>
        ) : (
          <ActionForm action={submitDevelopmentRequest} submitLabel="Submit development request">
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
              <span>Objective</span>
              <textarea
                name="objective"
                required
                minLength={8}
                maxLength={4000}
                rows={3}
                placeholder="Exact development objective"
              />
            </label>
            <label className="field">
              <span>Repository</span>
              <input name="repository" required defaultValue="Ghost-1R/Ghost" maxLength={200} />
            </label>
            <label className="field">
              <span>Approved base branch</span>
              <input
                name="approvedBaseBranch"
                required
                defaultValue="cursor/approval-bound-agent-task-772f"
                maxLength={200}
              />
            </label>
            <label className="field">
              <span>Development environment</span>
              <input name="environmentLabel" required defaultValue="REMOTE_DEV" maxLength={80} />
            </label>
            <label className="field">
              <span>Max spending budget (USD)</span>
              <input
                name="maxEstimatedCostUsd"
                type="number"
                min={0}
                max={500}
                step="0.01"
                required
                defaultValue="5"
              />
            </label>
            <label className="field">
              <span>Max duration (hours)</span>
              <input
                name="maxDurationHours"
                type="number"
                min={1}
                max={24}
                required
                defaultValue="1"
              />
            </label>
            <label className="field">
              <span>Requirements / notes</span>
              <textarea name="requirements" maxLength={4000} rows={2} placeholder="Optional constraints" />
            </label>
            <label className="field">
              <span>Evidence source (optional)</span>
              <input name="evidenceSource" maxLength={120} placeholder="spec" />
            </label>
            <label className="field">
              <span>Evidence reference (optional)</span>
              <input name="evidenceReference" maxLength={500} placeholder="doc-id or URL path" />
            </label>
          </ActionForm>
        )}
      </Panel>

      {(
        [
          ["Awaiting approval", byStage.awaitingApproval],
          ["Approved (not queued)", byStage.approved],
          ["Queued", byStage.queued],
          ["Running", byStage.running],
          ["Blocked", byStage.blocked],
          ["Failed", byStage.failed],
          ["Awaiting founder review", byStage.awaitingReview],
          ["Reviewed", byStage.reviewed],
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
                <article key={card.taskId} className="list-item" data-simulation={card.simulationLabel}>
                  <div className="approval-card-head">
                    <h3>
                      {card.objective.slice(0, 120)}
                      {card.objective.length > 120 ? "…" : ""}
                    </h3>
                    <StatusBadge status={card.workflowStage} />
                  </div>
                  {card.simulationLabel === "SIMULATED" ? (
                    <p className="notice" role="status">
                      SIMULATED activity — not live production execution.
                    </p>
                  ) : null}
                  <ul className="meta">
                    <li>Project: {card.projectName}</li>
                    <li>Approval: {card.approvalState}</li>
                    <li>
                      Scope: <code>{card.actionType}</code> · {card.authorizedScope.slice(0, 160)}
                      {card.authorizedScope.length > 160 ? "…" : ""}
                    </li>
                    <li>Execution: {card.executionState}</li>
                    <li>Provider: {card.providerActivity}</li>
                    <li>
                      Budget:{" "}
                      {card.maxEstimatedCostUsd != null
                        ? `USD ${card.maxEstimatedCostUsd}`
                        : "unspecified"}{" "}
                      · Duration ≤ {Math.round(card.maxDurationMs / 3600000)}h
                    </li>
                    <li>Evidence: {card.evidenceState}</li>
                    {card.evidenceCommitSha ? <li>Commit: {card.evidenceCommitSha}</li> : null}
                    {card.evidencePullRequestRef ? (
                      <li>PR: {card.evidencePullRequestRef}</li>
                    ) : null}
                    {card.lastError ? <li>Error: {card.lastError}</li> : null}
                    <li>Review decision: {card.reviewDecision}</li>
                    <li>Next: {card.nextAction}</li>
                    <li>Project Truth: {card.projectTruthNote}</li>
                    <li>Persistence: {card.persistenceMode}</li>
                    <li>Deployment authorized: no</li>
                  </ul>
                  <p>
                    <Link href={card.destinationHref}>Open project</Link>
                    {" · "}
                    <Link href={card.approvalsHref}>Founder Approvals</Link>
                  </p>
                  <div className="approval-actions">
                    {(card.workflowStage === "AWAITING_APPROVAL" ||
                      card.workflowStage === "DRAFT") &&
                    card.persistenceMode === MEMORY_PERSISTENCE_MODE ? (
                      <ActionForm action={approveDevelopmentWorkflow} submitLabel="Approve DEVELOPMENT auth">
                        <input type="hidden" name="taskId" value={card.taskId} />
                      </ActionForm>
                    ) : null}
                    {card.workflowStage === "APPROVED" ? (
                      <ActionForm action={queueDevelopmentWorkflow} submitLabel="Queue (revalidate auth)">
                        <input type="hidden" name="taskId" value={card.taskId} />
                      </ActionForm>
                    ) : null}
                    {card.workflowStage === "QUEUED" ? (
                      <ActionForm
                        action={runSimulatedDevelopmentWorkflow}
                        submitLabel="Run SIMULATED execution"
                      >
                        <input type="hidden" name="taskId" value={card.taskId} />
                      </ActionForm>
                    ) : null}
                    {card.workflowStage === "AWAITING_REVIEW" ? (
                      <>
                        {card.evidenceState === "UNVERIFIED" ? (
                          <ActionForm
                            action={verifyDevelopmentEvidenceWorkflow}
                            submitLabel="Independently verify SIMULATED evidence"
                          >
                            <input type="hidden" name="taskId" value={card.taskId} />
                          </ActionForm>
                        ) : null}
                        <ActionForm action={reviewDevelopmentWorkflow} submitLabel="Accept SIMULATED review">
                          <input type="hidden" name="taskId" value={card.taskId} />
                          <input type="hidden" name="decision" value="ACCEPT" />
                        </ActionForm>
                        <ActionForm action={reviewDevelopmentWorkflow} submitLabel="Reject SIMULATED outcome">
                          <input type="hidden" name="taskId" value={card.taskId} />
                          <input type="hidden" name="decision" value="REJECT" />
                        </ActionForm>
                      </>
                    ) : null}
                    {card.workflowStage === "QUEUED" ||
                    card.workflowStage === "RUNNING" ||
                    card.workflowStage === "APPROVED" ||
                    card.workflowStage === "AWAITING_APPROVAL" ? (
                      <ActionForm action={cancelDevelopmentWorkflow} submitLabel="Cancel">
                        <input type="hidden" name="taskId" value={card.taskId} />
                      </ActionForm>
                    ) : null}
                  </div>
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
