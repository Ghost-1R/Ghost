import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { Pilot03RequestFields } from "@/components/remote-development/pilot03-request-fields";
import { loadProjectAllowanceSnapshot, centsToUsdDisplay } from "@/lib/allowance";
import { loadAuthorizationById } from "@/lib/approvals/queries";
import { getSession } from "@/lib/auth/session";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { PILOT_03_OBJECTIVE } from "@/lib/codegen/pilot03-constants";
import { listVerifiedCodingOptions } from "@/lib/codegen/request-contract";
import { formatTimestamp } from "@/lib/format";
import { loadProjectSummaries } from "@/lib/projects/queries";
import {
  approveDevelopmentWorkflow,
  cancelDevelopmentWorkflow,
  executeDurableCodegenLiveWorkflow,
  executeDurableCodegenWorkflow,
  listMemoryDevelopmentTasksForOwner,
  queueDevelopmentWorkflow,
  reviewDevelopmentWorkflow,
  reviewDurableDevelopmentWorkflow,
  runSimulatedDevelopmentWorkflow,
  submitDevelopmentRequest,
  verifyDevelopmentEvidenceWorkflow,
} from "@/lib/remote-development/actions";
import { toFounderInboxCard } from "@/lib/remote-development/inbox";
import {
  MEMORY_PERSISTENCE_MODE,
  memoryLoadAuthorization,
} from "@/lib/remote-development/memory-store";
import {
  loadFounderDeliverableReviewsForTask,
  loadRemoteDevTasks,
} from "@/lib/remote-development/queries";
import { projectDevelopmentState } from "@/lib/remote-development/state-projection";

/** Pilot 02 historical local ACCEPT — display only; never auto-submitted. */
const PILOT_02_DOCUMENTED_ACCEPT = {
  remoteTaskId: "1513be21-f47b-4092-8ce4-8e14c538557b",
  decision: "ACCEPT" as const,
  source: ".ghost/pilot-02/FOUNDER_ACCEPTANCE.md",
};

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
  // Prefer durable DATABASE rows; MEMORY_TEST_ONLY only fills gaps for simulations.
  const byId = new Map(memoryTasks.map((t) => [t.id, t]));
  for (const task of dbTasks) byId.set(task.id, task);
  const tasks = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const cards = await Promise.all(
    tasks.map(async (task) => {
      const isMemory = memoryTasks.some((m) => m.id === task.id) && !dbTasks.some((d) => d.id === task.id);
      const durableAuth = isMemory
        ? null
        : await loadAuthorizationById(session.supabase, session.user.id, task.binding.authorizationId);
      const authorization = isMemory
        ? memoryLoadAuthorization(task.binding.authorizationId)
        : durableAuth && durableAuth.status === "ok"
          ? durableAuth.data
          : null;
      const card = toFounderInboxCard({
        task,
        authorization,
        persistenceMode: isMemory ? MEMORY_PERSISTENCE_MODE : "DATABASE",
      });
      const projection = projectDevelopmentState({
        remote: task,
        authorization,
        agent: null,
        persistenceMode: isMemory ? MEMORY_PERSISTENCE_MODE : "DATABASE",
      });
      const durableReviews =
        !isMemory
          ? await loadFounderDeliverableReviewsForTask(session.supabase, session.user.id, task.id)
          : null;
      const founderReviews =
        durableReviews && durableReviews.status === "ok" ? durableReviews.data : [];
      return {
        ...card,
        projectionState: projection.state,
        agentTaskId: task.agentTaskId,
        founderReviews,
        isPilot02DocumentedAccept:
          !isMemory && task.id === PILOT_02_DOCUMENTED_ACCEPT.remoteTaskId,
      };
    }),
  );

  const projectList = projects.status === "ok" ? projects.data : [];
  const defaultIdempotency = randomUUID();
  const codingOptions = listVerifiedCodingOptions();
  const liveFlagOn = isCodegenLiveEnabled();

  const allowanceViews = await Promise.all(
    projectList.map(async (project) => {
      const snap = await loadProjectAllowanceSnapshot(session.supabase, session.user.id, project.id, 100);
      if (snap.status !== "ok") {
        return {
          projectId: project.id,
          projectName: project.name,
          availableCents: 0,
          allowanceCents: 0,
          reservedCents: 0,
          chargedCents: 0,
          alert: "HARD_STOP",
          provisioned: false,
        };
      }
      return {
        projectId: project.id,
        projectName: project.name,
        availableCents: snap.data.availableCents,
        allowanceCents: snap.data.allowanceCents,
        reservedCents: snap.data.reservedCents,
        chargedCents: snap.data.chargedCents,
        alert: snap.data.alert,
        provisioned: snap.data.provisioned,
      };
    }),
  );

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
          DEVELOPMENT workflow: request → founder authorization → queue → execution → durable review.
          Pilot 03 AI code-generation prep uses this same page. Live provider dispatch stays disabled.
          Deployment stays separately authorized.
        </p>
      </header>

      <Panel title="Persistence">
        <p className="quiet">
          Showing {cards.length} task{cards.length === 1 ? "" : "s"}. New requests require durable
          Founder Approval Center + <code>remote_development_tasks</code> (fail closed if schema
          missing). Queue binds <code>agent_tasks</code> only after authorized revalidation. Durable
          founder reviews persist to <code>remote_development_founder_reviews</code>. Ghost Allowance
          V1 (SQL ledger) is shown before authorization. Execution modes are separate:{" "}
          <strong>MOCK</strong> (default) vs <strong>LIVE</strong> (server flag + exact founder scope).
          Current flag: <code>GHOST_CODEGEN_LIVE_ENABLED</code>={liveFlagOn ? "1" : "off (default)"}.
          No automatic deployment. Consumed authorizations are not reused.
        </p>
      </Panel>

      <Panel title="Ghost Allowance V1 (per project)">
        {allowanceViews.length === 0 ? (
          <EmptyState>Create a project to view AI allowance.</EmptyState>
        ) : (
          <ul className="meta">
            {allowanceViews.map((a) => (
              <li key={a.projectId}>
                {a.projectName}: available {centsToUsdDisplay(a.availableCents)}
                {a.provisioned
                  ? ` (allowance ${centsToUsdDisplay(a.allowanceCents)}, reserved ${centsToUsdDisplay(a.reservedCents)}, charged ${centsToUsdDisplay(a.chargedCents)}, alert ${a.alert})`
                  : " — not provisioned (treat as $0.00; set ≥ $1.00 before any live trial)"}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="New development request">
        <p className="quiet">
          Creates a durable PENDING DEVELOPMENT authorization bound to an exact scope fingerprint
          (including Pilot 03 provider/model when selected). Approving does not execute. Workers stay
          disabled. Live API calls: 0 from this form.
        </p>
        {projectList.length === 0 ? (
          <EmptyState>Create a project before requesting development work.</EmptyState>
        ) : (
          <ActionForm action={submitDevelopmentRequest} submitLabel="Submit development request">
            <input type="hidden" name="idempotencyKey" value={defaultIdempotency} />
            <Pilot03RequestFields
              codingOptions={codingOptions}
              allowances={allowanceViews}
              defaultProjectId={projectList[0]!.id}
              pilot03Objective={PILOT_03_OBJECTIVE}
            />
            <label className="field">
              <span>Repository</span>
              <input name="repository" required defaultValue="Ghost-1R/Ghost" maxLength={200} />
            </label>
            <label className="field">
              <span>Approved base branch</span>
              <input
                name="approvedBaseBranch"
                required
                defaultValue="cursor/pilot-03-real-ai-coding-prep"
                maxLength={200}
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
                    <StatusBadge status={card.founderStatusLabel} />
                  </div>
                  {card.simulationLabel === "SIMULATED" ? (
                    <p className="notice" role="status">
                      SIMULATED activity — not live production execution.
                    </p>
                  ) : null}
                  {card.isCodegenPilot ? (
                    <p className="notice" role="status" data-execution-mode={card.evidenceAttributionMode}>
                      Pilot 03 execution mode:{" "}
                      <strong>
                        {card.evidenceAttributionMode === "LIVE_PROVIDER"
                          ? "LIVE_PROVIDER (real OpenAI usage recorded)"
                          : "MOCK_GENERATION (no live spend)"}
                      </strong>
                      . Evidence: {card.evidenceAttributionLabel}. MOCK and LIVE use separate
                      entrypoints — never interchangeable.
                    </p>
                  ) : null}
                  <ul className="meta">
                    <li>Founder status: {card.founderStatusLabel}</li>
                    <li>Project: {card.projectName}</li>
                    <li>Projection: {card.projectionState}</li>
                    <li>
                      Authorization: {card.approvalState}
                      {card.approvalState === "APPROVED"
                        ? " (ONE_TIME not yet consumed — Queue required)"
                        : card.approvalState === "CONSUMED"
                          ? " (ONE_TIME consumed — no reuse)"
                          : ""}
                    </li>
                    <li>Evidence attribution: {card.evidenceAttributionLabel}</li>
                    {card.codegenProviderModel ? (
                      <li>
                        Codegen provider/model: <code>{card.codegenProviderModel}</code>
                      </li>
                    ) : null}
                    {card.isCodegenPilot ? (
                      <>
                        <li>
                          Project allowance:{" "}
                          {(() => {
                            const a = allowanceViews.find((x) => x.projectId === card.projectId);
                            if (!a) return "unknown";
                            return a.provisioned
                              ? `${centsToUsdDisplay(a.availableCents)} available (reserved ${centsToUsdDisplay(a.reservedCents)}, charged ${centsToUsdDisplay(a.chargedCents)})`
                              : "not provisioned ($0.00)";
                          })()}
                        </li>
                        <li>
                          Task spend ceiling:{" "}
                          {card.maxEstimatedCostUsd != null
                            ? `USD ${card.maxEstimatedCostUsd} (Pilot 03 max $1.00)`
                            : "unspecified"}
                        </li>
                        <li>
                          Authorization scope (exact): <code>{card.authorizedScope.slice(0, 240)}</code>
                          {card.authorizedScope.length > 240 ? "…" : ""}
                        </li>
                        <li>
                          Verification evidence: {card.evidenceState}
                          {card.evidenceCommitSha ? ` · sha ${card.evidenceCommitSha.slice(0, 12)}` : ""}
                        </li>
                      </>
                    ) : null}
                    <li>
                      Scope: <code>{card.actionType}</code> · {card.authorizedScope.slice(0, 160)}
                      {card.authorizedScope.length > 160 ? "…" : ""}
                    </li>
                    <li>Execution: {card.executionState}</li>
                    <li>
                      Agent task:{" "}
                      {card.agentTaskId ? <code>{card.agentTaskId.slice(0, 8)}…</code> : "not bound"}
                    </li>
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
                    {card.founderReviews.length > 0 ? (
                      <li>
                        Durable reviews:{" "}
                        {card.founderReviews
                          .map((r) => `${r.decision}→${r.resultingStatus}`)
                          .join(", ")}
                      </li>
                    ) : null}
                  </ul>
                  {card.isPilot02DocumentedAccept &&
                  card.workflowStage === "AWAITING_REVIEW" &&
                  card.persistenceMode === "DATABASE" ? (
                    <p className="notice" role="status">
                      Previously documented founder decision:{" "}
                      <strong>{PILOT_02_DOCUMENTED_ACCEPT.decision}</strong> (local record in{" "}
                      <code>{PILOT_02_DOCUMENTED_ACCEPT.source}</code>). Not written to the database.
                      Confirm below through authenticated durable review — nothing is auto-submitted.
                    </p>
                  ) : null}
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
                    {card.workflowStage === "QUEUED" &&
                    card.persistenceMode === MEMORY_PERSISTENCE_MODE ? (
                      <ActionForm
                        action={runSimulatedDevelopmentWorkflow}
                        submitLabel="Run SIMULATED execution"
                      >
                        <input type="hidden" name="taskId" value={card.taskId} />
                      </ActionForm>
                    ) : null}
                    {card.workflowStage === "QUEUED" &&
                    card.persistenceMode === "DATABASE" &&
                    card.isCodegenPilot &&
                    !liveFlagOn ? (
                      <>
                        <ActionForm
                          action={executeDurableCodegenWorkflow}
                          submitLabel="Run MOCK codegen + Docker validate"
                        >
                          <input type="hidden" name="taskId" value={card.taskId} />
                          <input type="hidden" name="liveDispatch" value="0" />
                        </ActionForm>
                        <p className="quiet" role="status" data-live-entrypoint="disabled">
                          LIVE entrypoint disabled (<code>GHOST_CODEGEN_LIVE_ENABLED</code>≠1).
                          Requires founder scope OpenAI gpt-5-mini PUBLIC ≤$1, SQL allowance, and
                          separate confirmation. See{" "}
                          <code>.ghost/pilot-03/FOUNDER_LIVE_AUTHORIZATION.md</code>.
                        </p>
                      </>
                    ) : null}
                    {card.workflowStage === "QUEUED" &&
                    card.persistenceMode === "DATABASE" &&
                    card.isCodegenPilot &&
                    liveFlagOn ? (
                      <div className="stack" data-live-entrypoint="armed">
                        <p className="notice" role="status">
                          LIVE FLAG ARMED — this is the separate LIVE OpenAI entrypoint (not MOCK).
                          Max $1.00. One-time dispatch. Uncertain billing preserves reservation.
                          Founder review still required after execution.
                        </p>
                        <ActionForm
                          action={executeDurableCodegenLiveWorkflow}
                          submitLabel="Run LIVE OpenAI codegen (≤$1) + Docker validate"
                        >
                          <input type="hidden" name="taskId" value={card.taskId} />
                          <input type="hidden" name="confirmLive" value="LIVE_OPENAI_GPT5MINI_USD1" />
                        </ActionForm>
                        <p className="quiet">
                          MOCK button is unavailable while the live flag is on — modes stay separate.
                        </p>
                      </div>
                    ) : null}
                    {card.workflowStage === "AWAITING_REVIEW" &&
                    card.persistenceMode === MEMORY_PERSISTENCE_MODE ? (
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
                    {card.workflowStage === "AWAITING_REVIEW" &&
                    card.persistenceMode === "DATABASE" ? (
                      <div className="stack">
                        <p className="quiet">
                          Durable founder deliverable review — authenticated owner only. Records an
                          immutable audit row. Does not deploy. Does not reuse authorization.
                        </p>
                        <ActionForm
                          action={reviewDurableDevelopmentWorkflow}
                          submitLabel={
                            card.isPilot02DocumentedAccept
                              ? "Confirm documented ACCEPT (durable)"
                              : "Accept durable deliverable"
                          }
                        >
                          <input type="hidden" name="taskId" value={card.taskId} />
                          <input type="hidden" name="decision" value="ACCEPT" />
                          <input
                            type="hidden"
                            name="idempotencyKey"
                            value={`durable-accept-${card.taskId}`}
                          />
                          <label className="field">
                            <span>Note (optional)</span>
                            <textarea name="note" maxLength={4000} rows={2} placeholder="Optional founder note" />
                          </label>
                        </ActionForm>
                        <ActionForm
                          action={reviewDurableDevelopmentWorkflow}
                          submitLabel="Reject durable deliverable"
                        >
                          <input type="hidden" name="taskId" value={card.taskId} />
                          <input type="hidden" name="decision" value="REJECT" />
                          <input
                            type="hidden"
                            name="idempotencyKey"
                            value={`durable-reject-${card.taskId}`}
                          />
                          <label className="field">
                            <span>Note (optional)</span>
                            <textarea name="note" maxLength={4000} rows={2} />
                          </label>
                        </ActionForm>
                        <ActionForm
                          action={reviewDurableDevelopmentWorkflow}
                          submitLabel="Request changes"
                        >
                          <input type="hidden" name="taskId" value={card.taskId} />
                          <input type="hidden" name="decision" value="REQUEST_CHANGES" />
                          <input
                            type="hidden"
                            name="idempotencyKey"
                            value={`durable-changes-${card.taskId}`}
                          />
                          <label className="field">
                            <span>Note (optional)</span>
                            <textarea name="note" maxLength={4000} rows={2} />
                          </label>
                        </ActionForm>
                      </div>
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
