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
  createBuildPhaseAction,
  createBuildRiskAction,
  createConfigRequirementAction,
  createDependencyAction,
  createManualActionAction,
  createVerificationAction,
  createWorkPackageAction,
  deleteDependencyAction,
  escalateBuildDecisionAction,
  initializeBuildPlanAction,
  linkArchitectureAction,
  linkFeatureAction,
  linkRequirementAction,
  saveBuildOverviewAction,
  syncBuildNextActionAction,
  transitionBuildPlanAction,
  unlinkArchitectureAction,
  updateBuildPhaseAction,
  updateBuildRiskAction,
  updateManualActionAction,
  updateWorkPackageAction,
} from "@/lib/build-plan/actions";
import { loadBuildPlan, loadBuildPlanBundle, loadBuildPlanHistory } from "@/lib/build-plan/queries";
import {
  ARCHITECTURE_LINK_KINDS,
  BUILD_RISK_SEVERITIES,
  DEPENDENCY_EDGE_KINDS,
  PATH_CERTAINTIES,
  V8_MANUAL_ACTION_STATUSES,
  V8_WORK_PACKAGE_STATUSES,
  VERIFICATION_KINDS,
  WORK_PACKAGE_PRIORITIES,
} from "@/lib/build-plan/types";
import {
  evaluateBuildPlanBundle,
  uncoveredApprovedFeatures,
  uncoveredCriticalRequirements,
  uncoveredKeyArchitecture,
} from "@/lib/build-plan/workflow";
import { loadLatestConversation } from "@/lib/conversation/queries";
import { loadProjectDetail } from "@/lib/projects/queries";
import { loadSystemArchitecture } from "@/lib/system-architecture/queries";
import { CONFIG_CLASSIFICATIONS } from "@/lib/system-architecture/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Build Plan ${id.slice(0, 8)}` };
}

function options(values: readonly string[]) {
  return values.map((value) => (
    <option key={value} value={value}>
      {value}
    </option>
  ));
}

export default async function BuildPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (!UUID_PATTERN.test(projectId)) notFound();

  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status === "error") {
    return (
      <div className="stack">
        <h1>Build Plan</h1>
        <ErrorState message={project.message} />
      </div>
    );
  }
  if (!project.data) notFound();

  const planResult = await loadBuildPlan(session.supabase, projectId);
  if (planResult.status === "error") {
    return (
      <div className="stack">
        <h1>Build Plan</h1>
        <ErrorState message={planResult.message} />
      </div>
    );
  }

  if (!planResult.data) {
    const [conversation, system] = await Promise.all([
      loadLatestConversation(session.supabase, projectId),
      loadSystemArchitecture(session.supabase, projectId),
    ]);
    const systemStatus = system.status === "ok" ? system.data?.status ?? null : null;
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <p className="eyebrow">Build Plan</p>
            <h1>{project.data.name}</h1>
          </div>
          <Link className="button-secondary" href={`/projects/${projectId}`}>
            Back to project
          </Link>
        </div>
        <Panel title="Initialize Build Plan">
          <p className="quiet">
            Turns an ARCHITECTURE_READY System Architecture into an executable implementation blueprint: phases, work
            packages, dependencies, verification plans, and coverage. This is planning only. It does not implement,
            migrate, or deploy anything, and Ghost will not invent work packages for you.
          </p>
          {system.status === "error" ? <ErrorState message={system.message} /> : null}
          <p className="quiet">
            System Architecture: {systemStatus ?? "not initialized"}
            {systemStatus && systemStatus !== "ARCHITECTURE_READY" ? " (must be ARCHITECTURE_READY first)" : ""}
          </p>
          <ActionForm action={initializeBuildPlanAction} submitLabel="Initialize Build Plan">
            <input type="hidden" name="projectId" value={projectId} />
          </ActionForm>
        </Panel>
        <Panel title="Ask Ghost about this build plan">
          <p className="quiet">Build Plan is not initialized yet. Answers must say what is unknown until plan records exist.</p>
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

  const plan = planResult.data;
  const [bundleResult, history, conversation] = await Promise.all([
    loadBuildPlanBundle(session.supabase, plan),
    loadBuildPlanHistory(session.supabase, plan.id),
    loadLatestConversation(session.supabase, projectId),
  ]);

  if (bundleResult.status === "error") {
    return (
      <div className="stack">
        <h1>Build Plan</h1>
        <ErrorState message={bundleResult.message} />
      </div>
    );
  }

  const bundle = bundleResult.data;
  const { phases, packages, dependencies, verifications, manualActions, configRequirements, risks } = bundle;
  const historyRows = history.status === "ok" ? history.data : [];
  const { readiness, waves, criticalPath, blockers } = evaluateBuildPlanBundle(bundle);
  const reqGaps = uncoveredCriticalRequirements(bundle.requirements, bundle.requirementLinks);
  const featGaps = uncoveredApprovedFeatures(bundle.features, bundle.featureLinks);
  const archGaps = uncoveredKeyArchitecture(bundle.architectureRecords, bundle.architectureLinks);
  const packageLabel = (id: string) => packages.find((row) => row.id === id)?.humanId ?? id.slice(0, 8);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Build Plan</p>
          <h1>{project.data.name}</h1>
        </div>
        <ul className="meta">
          <li>
            <StatusBadge status={plan.status} />
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}`}>
              Project
            </Link>
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}/architecture`}>
              System Architecture
            </Link>
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}/execution`}>
              Build Execution
            </Link>
          </li>
        </ul>
      </div>

      <Panel title="Overview">
        <p>
          Status <strong>{plan.status}</strong> · System {bundle.systemStatus ?? "missing"} · Product{" "}
          {bundle.productStatus ?? "missing"}
        </p>
        <ul className="meta">
          <li>Phases: {phases.length}</li>
          <li>Work packages: {packages.length}</li>
          <li>Dependencies: {dependencies.length}</li>
          <li>Verifications: {verifications.length}</li>
          <li>Manual actions: {manualActions.length}</li>
          <li>Config names: {configRequirements.length}</li>
          <li>Risks: {risks.length}</li>
          <li>Open decisions: {bundle.openDecisionCount}</li>
        </ul>
        <p className="quiet">
          Build Plan is planning only. It is not implementation, an applied migration, a passing test, or a deployment.
          Ghost does not invent completion percentages.
        </p>
      </Panel>

      <Panel title="Readiness">
        {readiness.buildPlanReady ? (
          <>
            <p>
              <strong>BUILD PLAN READY</strong> (planned for coding, not built)
            </p>
            <ul className="meta">
              {readiness.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p>
              <strong>NOT BUILD PLAN READY</strong> · {blockers.length} item{blockers.length === 1 ? "" : "s"} remaining
            </p>
            <ul className="meta">
              {blockers.map((gap) => (
                <li key={gap.code}>{gap.message}</li>
              ))}
            </ul>
          </>
        )}
        <ActionForm action={syncBuildNextActionAction} submitLabel="Record justified next action">
          <input type="hidden" name="projectId" value={projectId} />
        </ActionForm>
        <div className="meta">
          {(["PLANNING", "REVIEW", "APPROVED", "BUILD_PLAN_READY"] as const).map((status) => (
            <ActionForm key={status} action={transitionBuildPlanAction} submitLabel={`Move to ${status}`}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="toStatus" value={status} />
              <input type="hidden" name="reason" value={`Founder moved Build Plan to ${status}.`} />
            </ActionForm>
          ))}
        </div>
        {historyRows.length ? (
          <ul className="meta">
            {historyRows.slice(0, 5).map((row) => (
              <li key={row.id}>
                {row.fromStatus ?? "none"} → {row.toStatus}: {row.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Ask Ghost">
        <p className="quiet">
          Answers must use Build Plan records. Planned work is not implemented, and BUILD_PLAN_READY is not production.
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

      <Panel title="Overview details">
        <ActionForm action={saveBuildOverviewAction} submitLabel="Save overview">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Summary</span>
            <textarea name="summary" defaultValue={plan.summary} maxLength={8000} />
          </label>
          <label className="field">
            <span>Deployment sequence (one step per line)</span>
            <textarea name="deploymentSequence" defaultValue={plan.deploymentSequence.join("\n")} />
          </label>
          <label className="field">
            <span>Rollback summary</span>
            <textarea name="rollbackSummary" defaultValue={plan.rollbackSummary} maxLength={4000} />
          </label>
          <label className="field">
            <span>Note</span>
            <textarea name="note" defaultValue={plan.note} maxLength={4000} />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Phases">
        {phases.length === 0 ? <EmptyState>No phases yet.</EmptyState> : null}
        {phases.map((phase) => (
          <article className="list-item" key={phase.id}>
            <h3>
              {phase.humanId}: {phase.name}
            </h3>
            <p>{phase.objective || "No objective recorded."}</p>
            <ActionForm action={updateBuildPhaseAction} submitLabel="Save phase">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="phaseId" value={phase.id} />
              <label className="field">
                <span>Name</span>
                <input name="name" defaultValue={phase.name} required />
              </label>
              <label className="field">
                <span>Objective</span>
                <textarea name="objective" defaultValue={phase.objective} />
              </label>
              <label className="field">
                <span>Position</span>
                <input name="position" type="number" defaultValue={phase.position} />
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createBuildPhaseAction} submitLabel="Add phase">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Name</span>
            <input name="name" required />
          </label>
          <label className="field">
            <span>Objective</span>
            <textarea name="objective" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Work Packages">
        {packages.length === 0 ? <EmptyState>No work packages yet. Ghost will not invent them.</EmptyState> : null}
        {packages.map((pkg) => (
          <article className="list-item" key={pkg.id}>
            <h3>
              {pkg.humanId}: {pkg.title}
            </h3>
            <p className="quiet">
              {pkg.status} · {pkg.priority} · {pkg.pathCertainty}
            </p>
            <p>{pkg.objective || pkg.description || "No objective recorded."}</p>
            <ActionForm action={updateWorkPackageAction} submitLabel="Save work package">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="packageId" value={pkg.id} />
              <label className="field">
                <span>Title</span>
                <input name="title" defaultValue={pkg.title} required />
              </label>
              <label className="field">
                <span>Phase</span>
                <select name="phaseId" defaultValue={pkg.phaseId ?? ""}>
                  <option value="">None</option>
                  {phases.map((phase) => (
                    <option key={phase.id} value={phase.id}>
                      {phase.humanId}: {phase.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Status (V8: PLANNED / READY / BLOCKED)</span>
                <select name="status" defaultValue={pkg.status}>
                  {options(V8_WORK_PACKAGE_STATUSES)}
                </select>
              </label>
              <label className="field">
                <span>Priority</span>
                <select name="priority" defaultValue={pkg.priority}>
                  {options(WORK_PACKAGE_PRIORITIES)}
                </select>
              </label>
              <label className="field">
                <span>Objective</span>
                <textarea name="objective" defaultValue={pkg.objective} />
              </label>
              <label className="field">
                <span>Likely code areas (one per line)</span>
                <textarea name="likelyCodeAreas" defaultValue={pkg.likelyCodeAreas.join("\n")} />
              </label>
              <label className="field">
                <span>Path certainty</span>
                <select name="pathCertainty" defaultValue={pkg.pathCertainty}>
                  {options(PATH_CERTAINTIES)}
                </select>
              </label>
              <label className="field">
                <span>Database impact</span>
                <textarea name="databaseImpact" defaultValue={pkg.databaseImpact} />
              </label>
              <label className="field">
                <span>Definition of done (one per line)</span>
                <textarea name="definitionOfDone" defaultValue={pkg.definitionOfDone.join("\n")} />
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createWorkPackageAction} submitLabel="Add work package">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Title</span>
            <input name="title" required />
          </label>
          <label className="field">
            <span>Phase</span>
            <select name="phaseId" defaultValue="">
              <option value="">None</option>
              {phases.map((phase) => (
                <option key={phase.id} value={phase.id}>
                  {phase.humanId}: {phase.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Objective</span>
            <textarea name="objective" />
          </label>
          <label className="field">
            <span>Priority</span>
            <select name="priority" defaultValue="MEDIUM">
              {options(WORK_PACKAGE_PRIORITIES)}
            </select>
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Dependencies">
        <p className="quiet">
          Waves from DEPENDS_ON / BLOCKS only. CAN_RUN_WITH does not order. Critical path:{" "}
          {criticalPath.length ? criticalPath.join(" → ") : "none"}
        </p>
        {waves.length === 0 ? (
          <EmptyState>No packages to wave.</EmptyState>
        ) : (
          <ul className="meta">
            {waves.map((wave, index) => (
              <li key={`wave-${index}`}>
                Wave {index + 1}: {wave.join(", ")}
              </li>
            ))}
          </ul>
        )}
        {dependencies.map((dep) => (
          <article className="list-item" key={dep.id}>
            <p>
              {packageLabel(dep.fromPackageId)} {dep.edgeKind} {packageLabel(dep.toPackageId)}
            </p>
            <ActionForm action={deleteDependencyAction} submitLabel="Remove">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="dependencyId" value={dep.id} />
            </ActionForm>
          </article>
        ))}
        {packages.length >= 2 ? (
          <ActionForm action={createDependencyAction} submitLabel="Add dependency">
            <input type="hidden" name="projectId" value={projectId} />
            <label className="field">
              <span>From</span>
              <select name="fromPackageId" required>
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.humanId}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>To</span>
              <select name="toPackageId" required>
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.humanId}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Kind</span>
              <select name="edgeKind" defaultValue="DEPENDS_ON">
                {options(DEPENDENCY_EDGE_KINDS)}
              </select>
            </label>
          </ActionForm>
        ) : null}
      </Panel>

      <Panel title="Coverage">
        <ul className="meta">
          <li>Unlinked critical/high requirements: {reqGaps.length}</li>
          <li>Unlinked approved features: {featGaps.length}</li>
          <li>Unlinked key architecture: {archGaps.length}</li>
        </ul>
        {reqGaps.map((row) => (
          <p className="quiet" key={row.id}>
            {row.humanId} {row.title} ({row.priority})
          </p>
        ))}
        {featGaps.map((row) => (
          <p className="quiet" key={row.id}>
            {row.humanId} {row.name}
          </p>
        ))}
        {archGaps.map((row) => (
          <p className="quiet" key={`${row.kind}-${row.humanId}`}>
            {row.kind} {row.humanId} {row.name}
          </p>
        ))}
        {packages.length > 0 ? (
          <>
            <ActionForm action={linkRequirementAction} submitLabel="Link requirement">
              <input type="hidden" name="projectId" value={projectId} />
              <label className="field">
                <span>Work package</span>
                <select name="packageId" required>
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.humanId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Requirement</span>
                <select name="requirementId" required>
                  {bundle.requirements
                    .filter((row) => row.approvalStatus === "ACCEPTED")
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.humanId}: {row.title}
                      </option>
                    ))}
                </select>
              </label>
            </ActionForm>
            <ActionForm action={linkFeatureAction} submitLabel="Link feature">
              <input type="hidden" name="projectId" value={projectId} />
              <label className="field">
                <span>Work package</span>
                <select name="packageId" required>
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.humanId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Feature</span>
                <select name="featureId" required>
                  {bundle.features.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.humanId}: {row.name}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
            <ActionForm action={linkArchitectureAction} submitLabel="Link architecture">
              <input type="hidden" name="projectId" value={projectId} />
              <label className="field">
                <span>Work package</span>
                <select name="packageId" required>
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.humanId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Kind</span>
                <select name="linkKind" defaultValue="COMPONENT">
                  {options(ARCHITECTURE_LINK_KINDS)}
                </select>
              </label>
              <label className="field">
                <span>Record ref (human id)</span>
                <input name="recordRef" required list="arch-refs" />
                <datalist id="arch-refs">
                  {bundle.architectureRecords.map((row) => (
                    <option key={`${row.kind}-${row.humanId}`} value={row.humanId}>
                      {row.kind} {row.name}
                    </option>
                  ))}
                </datalist>
              </label>
            </ActionForm>
            {bundle.architectureLinks.map((link) => (
              <article className="list-item" key={link.id}>
                <p>
                  {packageLabel(link.workPackageId)} → {link.linkKind} {link.recordRef}
                </p>
                <ActionForm action={unlinkArchitectureAction} submitLabel="Unlink">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="linkId" value={link.id} />
                </ActionForm>
              </article>
            ))}
          </>
        ) : null}
      </Panel>

      <Panel title="Verification">
        {verifications.length === 0 ? <EmptyState>No verification plans yet.</EmptyState> : null}
        {verifications.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {packageLabel(row.workPackageId)} · {row.kind}
            </h3>
            <p>{row.description}</p>
            <p className="quiet">{row.observableSignal || "No observable signal recorded."} · planned, not passed</p>
          </article>
        ))}
        {packages.length > 0 ? (
          <ActionForm action={createVerificationAction} submitLabel="Add verification plan">
            <input type="hidden" name="projectId" value={projectId} />
            <label className="field">
              <span>Work package</span>
              <select name="packageId" required>
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.humanId}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Kind</span>
              <select name="kind" defaultValue="UNIT">
                {options(VERIFICATION_KINDS)}
              </select>
            </label>
            <label className="field">
              <span>Description</span>
              <textarea name="description" required />
            </label>
            <label className="field">
              <span>Observable signal</span>
              <textarea name="observableSignal" />
            </label>
          </ActionForm>
        ) : null}
      </Panel>

      <Panel title="Manual Actions">
        {manualActions.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.humanId}: {row.title}
            </h3>
            <p className="quiet">{row.status}</p>
            <ActionForm action={updateManualActionAction} submitLabel="Save">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="actionId" value={row.id} />
              <label className="field">
                <span>Title</span>
                <input name="title" defaultValue={row.title} required />
              </label>
              <label className="field">
                <span>Status (V8 cannot set DONE)</span>
                <select name="status" defaultValue={row.status}>
                  {options(V8_MANUAL_ACTION_STATUSES)}
                </select>
              </label>
              <label className="field">
                <span>Description</span>
                <textarea name="description" defaultValue={row.description} />
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createManualActionAction} submitLabel="Add manual action">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Title</span>
            <input name="title" required />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea name="description" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Deployment">
        <ul className="meta">
          {plan.deploymentSequence.length === 0 ? (
            <li>No deployment sequence recorded.</li>
          ) : (
            plan.deploymentSequence.map((step) => <li key={step}>{step}</li>)
          )}
        </ul>
        <p className="quiet">Rollback: {plan.rollbackSummary || "none recorded"}</p>
        <p className="quiet">Config variable names (never values):</p>
        {configRequirements.map((row) => (
          <p className="quiet" key={row.id}>
            {row.variableName} · {row.classification} · {row.environment}
          </p>
        ))}
        <ActionForm action={createConfigRequirementAction} submitLabel="Add config name">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Variable name</span>
            <input name="variableName" required />
          </label>
          <label className="field">
            <span>Purpose</span>
            <textarea name="purpose" />
          </label>
          <label className="field">
            <span>Classification</span>
            <select name="classification" defaultValue="SERVER_SECRET">
              {options(CONFIG_CLASSIFICATIONS)}
            </select>
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Risks">
        {risks.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.humanId} ({row.severity})
            </h3>
            <p>{row.description}</p>
            <ActionForm action={updateBuildRiskAction} submitLabel="Save risk">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="riskId" value={row.id} />
              <label className="field">
                <span>Description</span>
                <textarea name="description" defaultValue={row.description} required />
              </label>
              <label className="field">
                <span>Severity</span>
                <select name="severity" defaultValue={row.severity}>
                  {options(BUILD_RISK_SEVERITIES)}
                </select>
              </label>
              <label className="field">
                <span>Mitigation</span>
                <textarea name="mitigation" defaultValue={row.mitigation} />
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createBuildRiskAction} submitLabel="Add risk">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Description</span>
            <textarea name="description" required />
          </label>
          <label className="field">
            <span>Severity</span>
            <select name="severity" defaultValue="MEDIUM">
              {options(BUILD_RISK_SEVERITIES)}
            </select>
          </label>
          <label className="field">
            <span>Mitigation</span>
            <textarea name="mitigation" />
          </label>
        </ActionForm>
        <ActionForm action={escalateBuildDecisionAction} submitLabel="Escalate build decision">
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
    </div>
  );
}
