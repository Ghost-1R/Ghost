import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { loadLatestConversation } from "@/lib/conversation/queries";
import {
  completeDeploymentAction,
  completeManualActionAction,
  createManualActionAction,
  ensureEnvironmentsAction,
  escalateReleaseDecisionAction,
  failDeploymentAction,
  initializeReleaseAction,
  recordDeploymentEvidenceAction,
  recordHealthCheckAction,
  recordLiveShaAction,
  recordProductionGateAction,
  requestRollbackAction,
  setConfigPresenceAction,
  setEnvironmentAction,
  setMigrationStatusAction,
  startDeploymentAction,
  syncReleaseNextActionAction,
  transitionReleaseAction,
  updateReleaseOverviewAction,
} from "@/lib/deployment-release/actions";
import { ProjectTruthPanel } from "@/components/operations/project-truth-panel";
import { loadLatestRelease, loadReleaseBundle, loadReleases } from "@/lib/deployment-release/queries";
import { loadProjectTruthSnapshot } from "@/lib/project-truth";
import {
  CONFIG_PRESENCE_STATUSES,
  DEPLOYMENT_ENVIRONMENT_TYPES,
  DEPLOYMENT_EVIDENCE_KINDS,
  DEPLOYMENT_HEALTH_STATUSES,
  RELEASE_MIGRATION_STATUSES,
} from "@/lib/deployment-release/types";
import { evaluateReleaseBundle, shasMatch } from "@/lib/deployment-release/workflow";
import { loadProjectDetail } from "@/lib/projects/queries";
import { loadVerificationProgram } from "@/lib/verification/queries";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Deploy ${id.slice(0, 8)}` };
}

function options(values: readonly string[]) {
  return values.map((value) => (
    <option key={value} value={value}>
      {value}
    </option>
  ));
}

export default async function DeployPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (!UUID_PATTERN.test(projectId)) notFound();

  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status === "error") {
    return (
      <div className="stack">
        <h1>Deploy</h1>
        <ErrorState message={project.message} />
      </div>
    );
  }
  if (!project.data) notFound();

  const [releaseResult, verification, conversation, truthResult] = await Promise.all([
    loadLatestRelease(session.supabase, projectId),
    loadVerificationProgram(session.supabase, projectId),
    loadLatestConversation(session.supabase, projectId),
    loadProjectTruthSnapshot(session.supabase, {
      projectId,
      projectName: project.data.name,
      hasFreshInspectorPass: null,
    }),
  ]);

  if (releaseResult.status === "error") {
    return (
      <div className="stack">
        <h1>Deploy</h1>
        <ErrorState message={releaseResult.message} />
      </div>
    );
  }

  const verificationStatus = verification.status === "ok" ? verification.data?.status ?? null : null;

  const truthPanel =
    truthResult.status === "ok" ? (
      <ProjectTruthPanel
        snapshot={truthResult.data}
        title="Project Truth"
        deployHref={`/projects/${projectId}/deploy`}
      />
    ) : (
      <ErrorState message="Project Truth could not be loaded from recorded evidence." />
    );

  const ask = (
    <Panel title="Ask Ghost">
      <p className="quiet">
        Ask what is deployed, which commit is live, whether migrations are applied, or what blocks release. VERIFIED is
        not DEPLOYED, and DEPLOYED is not PRODUCTION_VERIFIED. Past Ghost answers are not evidence.
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
  );

  if (!releaseResult.data) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <p className="eyebrow">Deployment</p>
            <h1>{project.data.name}</h1>
          </div>
          <ul className="meta">
            <li>
              <Link className="button-secondary" href={`/projects/${projectId}`}>
                Back to project
              </Link>
            </li>
            <li>
              <Link className="button-secondary" href={`/projects/${projectId}/verification`}>
                Verification
              </Link>
            </li>
            <li>
              <Link className="button-secondary" href={`/projects/${projectId}/execution`}>
                Build Execution
              </Link>
            </li>
          </ul>
        </div>
        {truthPanel}
        <Panel title="Initialize Release">
          <p className="quiet">
            Creates a release candidate from a VERIFIED Verification Program. VERIFIED is not deployed. Ghost records
            configuration presence only and never stores secret values.
          </p>
          <p className="quiet">
            Verification: {verificationStatus ?? "not initialized"}
            {verificationStatus && verificationStatus !== "VERIFIED" ? " (must be VERIFIED first)" : ""}
          </p>
          <ActionForm action={initializeReleaseAction} submitLabel="Initialize Release">
            <input type="hidden" name="projectId" value={projectId} />
            <label className="field">
              <span>Source branch</span>
              <input name="sourceBranch" defaultValue={project.data.repositoryBranch ?? ""} />
            </label>
            <label className="field">
              <span>Source commit SHA (required)</span>
              <input name="sourceCommitSha" required defaultValue={project.data.repositoryCommit ?? ""} />
            </label>
            <label className="field">
              <span>Required migration paths (one per line, optional)</span>
              <textarea name="migrationPaths" />
            </label>
          </ActionForm>
        </Panel>
        {ask}
      </div>
    );
  }

  const [bundleResult, releases] = await Promise.all([
    loadReleaseBundle(session.supabase, releaseResult.data),
    loadReleases(session.supabase, projectId),
  ]);
  if (bundleResult.status === "error") {
    return (
      <div className="stack">
        <h1>Deploy</h1>
        <ErrorState message={bundleResult.message} />
      </div>
    );
  }

  const bundle = bundleResult.data;
  const release = bundle.release;
  const { readiness, production, latestDeployment } = evaluateReleaseBundle(bundle);
  const environment = bundle.environments.find((row) => row.id === release.environmentId) ?? null;
  const releaseRows = releases.status === "ok" ? releases.data : [release];
  const history = bundle.history ?? [];
  const activeDeployments = bundle.deployments.filter((row) => row.status === "QUEUED" || row.status === "IN_PROGRESS");
  const succeeded = bundle.deployments.filter((row) => row.status === "SUCCEEDED");
  const productionGateTarget = succeeded[0] ?? null;
  const canEditSha = release.status === "DRAFT" || release.status === "DEPLOYMENT_READY";

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Deployment</p>
          <h1>{project.data.name}</h1>
        </div>
        <ul className="meta">
          <li>
            <StatusBadge status={release.status} />
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}`}>
              Back to project
            </Link>
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}/verification`}>
              Verification
            </Link>
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}/execution`}>
              Build Execution
            </Link>
          </li>
        </ul>
      </div>
      {truthPanel}

      <Panel title="Release">
        <p>
          {release.humanId} · <strong>{release.status}</strong> · Verification {bundle.verificationStatus ?? "missing"} ·
          Deployments {bundle.deployments.length}
        </p>
        <ul className="meta">
          <li>Source commit: {release.sourceCommitSha || "unknown"}</li>
          <li>Branch: {release.sourceBranch || "unknown"}</li>
          <li>Environment: {environment ? `${environment.name} (${environment.provider || "provider unknown"})` : "none"}</li>
          <li>Latest deployment: {latestDeployment ? `${latestDeployment.humanId} ${latestDeployment.status}` : "none"}</li>
          <li>Open decisions: {bundle.openDecisionCount}</li>
        </ul>
        <p className="quiet">
          VERIFIED is not deployed. DEPLOYED is not PRODUCTION_VERIFIED. Configuration is recorded as presence only; no
          secret values are stored anywhere.
        </p>
        <div className="meta">
          {(["DRAFT", "DEPLOYMENT_READY", "PRODUCTION_VERIFICATION", "PRODUCTION_VERIFIED"] as const).map((status) => (
            <ActionForm key={status} action={transitionReleaseAction} submitLabel={`Move to ${status}`}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="toStatus" value={status} />
              <input type="hidden" name="reason" value={`Founder moved Release to ${status}.`} />
            </ActionForm>
          ))}
        </div>
        <ActionForm action={syncReleaseNextActionAction} submitLabel="Record justified next action">
          <input type="hidden" name="projectId" value={projectId} />
        </ActionForm>
        <ActionForm action={updateReleaseOverviewAction} submitLabel="Update release">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Summary</span>
            <textarea name="summary" defaultValue={release.summary} />
          </label>
          <label className="field">
            <span>Source branch</span>
            <input name="sourceBranch" defaultValue={release.sourceBranch} />
          </label>
          <label className="field">
            <span>Source commit SHA{canEditSha ? "" : " (locked after deploy starts)"}</span>
            <input name="sourceCommitSha" defaultValue={release.sourceCommitSha} readOnly={!canEditSha} />
          </label>
          <label className="field">
            <span>Release version</span>
            <input name="releaseVersion" defaultValue={release.releaseVersion} />
          </label>
          <label className="field">
            <span>Deployment sequence (one step per line)</span>
            <textarea name="deploymentSequence" defaultValue={release.deploymentSequence.join("\n")} />
          </label>
          <label className="field">
            <span>Rollback strategy</span>
            <textarea name="rollbackStrategy" defaultValue={release.rollbackStrategy} />
          </label>
          <label className="field">
            <span>Rollback target commit SHA</span>
            <input name="rollbackTargetCommitSha" defaultValue={release.rollbackTargetCommitSha} />
          </label>
          <label className="field">
            <span>Note</span>
            <textarea name="note" defaultValue={release.note} />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Deployment readiness gaps">
        {readiness.ready ? (
          <>
            <p>
              <strong>DEPLOYMENT READY</strong> (not deployed)
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
              <strong>NOT READY</strong> · {readiness.gaps.length} item{readiness.gaps.length === 1 ? "" : "s"} remaining
            </p>
            <ul className="meta">
              {readiness.gaps.map((gap) => (
                <li key={gap.code + gap.message}>{gap.message}</li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel title="Environment">
        {bundle.environments.length === 0 ? <EmptyState>No environments recorded.</EmptyState> : null}
        {bundle.environments.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.name} · {row.environmentType}
              {row.id === release.environmentId ? " · selected" : ""}
            </h3>
            <p className="quiet">
              {row.provider || "provider unknown"} · {row.applicationUrl || "no URL"}
              {row.healthEndpoint ? ` · health ${row.healthEndpoint}` : ""}
            </p>
          </article>
        ))}
        <ActionForm action={ensureEnvironmentsAction} submitLabel="Record default Production environment">
          <input type="hidden" name="projectId" value={projectId} />
        </ActionForm>
        <ActionForm action={setEnvironmentAction} submitLabel="Save environment">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Name</span>
            <input name="name" required />
          </label>
          <label className="field">
            <span>Type</span>
            <select name="environmentType" defaultValue="PRODUCTION">
              {options(DEPLOYMENT_ENVIRONMENT_TYPES)}
            </select>
          </label>
          <label className="field">
            <span>Provider</span>
            <input name="provider" />
          </label>
          <label className="field">
            <span>Application URL</span>
            <input name="applicationUrl" />
          </label>
          <label className="field">
            <span>Health endpoint</span>
            <input name="healthEndpoint" />
          </label>
          <label className="field">
            <span>Service identity (name only)</span>
            <input name="serviceIdentity" />
          </label>
          <label className="field">
            <span>Use for this release</span>
            <select name="makeCurrent" defaultValue="1">
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Configuration presence">
        <p className="quiet">
          Presence only: PRESENT, MISSING, or UNKNOWN. Ghost never asks for, stores, or displays a value.
        </p>
        {bundle.configRequirements.length === 0 ? <EmptyState>No configuration requirements recorded.</EmptyState> : null}
        {bundle.configRequirements.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.variableName} · <StatusBadge status={row.presence} />
            </h3>
            <p className="quiet">
              {row.isRequired ? "Required" : "Optional"} · {row.isSecret ? "secret" : "non-secret"}
              {row.verifiedAt ? ` · confirmed ${row.verifiedAt}` : ""}
            </p>
            <ActionForm action={setConfigPresenceAction} submitLabel="Update presence">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="configId" value={row.id} />
              <label className="field">
                <span>Presence</span>
                <select name="presence" defaultValue={row.presence}>
                  {options(CONFIG_PRESENCE_STATUSES)}
                </select>
              </label>
              <label className="field">
                <span>Note (no values)</span>
                <input name="note" defaultValue={row.note} />
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={setConfigPresenceAction} submitLabel="Add requirement">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Variable name</span>
            <input name="variableName" required placeholder="SOME_VARIABLE_NAME" />
          </label>
          <label className="field">
            <span>Presence</span>
            <select name="presence" defaultValue="UNKNOWN">
              {options(CONFIG_PRESENCE_STATUSES)}
            </select>
          </label>
          <label className="field">
            <span>Secret</span>
            <select name="isSecret" defaultValue="1">
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </label>
          <label className="field">
            <span>Required</span>
            <select name="isRequired" defaultValue="1">
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Migrations">
        <p className="quiet">Committed is not applied. Record APPLIED only after confirming it ran on the target database.</p>
        {bundle.migrations.length === 0 ? <EmptyState>No release migrations recorded.</EmptyState> : null}
        {bundle.migrations.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.migrationPath} · <StatusBadge status={row.status} />
            </h3>
            <p className="quiet">
              {row.isRequired ? "Required" : "Optional"}
              {row.appliedAt ? ` · applied ${row.appliedAt}` : ""}
              {row.evidenceRef ? ` · ${row.evidenceRef}` : ""}
            </p>
            <ActionForm action={setMigrationStatusAction} submitLabel="Update migration">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="migrationId" value={row.id} />
              <label className="field">
                <span>Status</span>
                <select name="status" defaultValue={row.status}>
                  {options(RELEASE_MIGRATION_STATUSES)}
                </select>
              </label>
              <label className="field">
                <span>Evidence reference (no secrets)</span>
                <input name="evidenceRef" defaultValue={row.evidenceRef} />
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={setMigrationStatusAction} submitLabel="Add migration">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Migration path</span>
            <input name="migrationPath" required placeholder="supabase/migrations/…" />
          </label>
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue="PENDING">
              {options(RELEASE_MIGRATION_STATUSES)}
            </select>
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Manual actions">
        {bundle.manualActions.length === 0 ? <EmptyState>No manual actions recorded.</EmptyState> : null}
        {bundle.manualActions.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.title} · <StatusBadge status={row.status} />
            </h3>
            <p className="quiet">{row.isRequired ? "Required" : "Optional"}</p>
            {row.instruction ? <p>{row.instruction}</p> : null}
            {row.status === "PENDING" || row.status === "BLOCKED" ? (
              <ActionForm action={completeManualActionAction} submitLabel="Record result">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="actionId" value={row.id} />
                <label className="field">
                  <span>Status</span>
                  <select name="status" defaultValue="COMPLETED">
                    <option value="COMPLETED">COMPLETED</option>
                    <option value="BLOCKED">BLOCKED</option>
                    <option value="SKIPPED">SKIPPED</option>
                  </select>
                </label>
                <label className="field">
                  <span>Evidence reference</span>
                  <input name="evidenceRef" />
                </label>
              </ActionForm>
            ) : null}
          </article>
        ))}
        <ActionForm action={createManualActionAction} submitLabel="Add manual action">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="field">
            <span>Title</span>
            <input name="title" required />
          </label>
          <label className="field">
            <span>Instruction</span>
            <textarea name="instruction" />
          </label>
          <label className="field">
            <span>Required</span>
            <select name="isRequired" defaultValue="1">
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Deployment">
        <p className="quiet">
          Ghost does not deploy for you. Start an attempt, deploy through the provider, then record evidence and the live
          commit SHA. An attempt can only SUCCEED with evidence and a live SHA matching the expected SHA.
        </p>
        {release.status === "DEPLOYMENT_READY" ? (
          <ActionForm action={startDeploymentAction} submitLabel="Start deployment">
            <input type="hidden" name="projectId" value={projectId} />
            <label className="field">
              <span>Provider deployment id (optional)</span>
              <input name="providerDeploymentId" />
            </label>
          </ActionForm>
        ) : (
          <p className="quiet">Start deployment is available while the release is DEPLOYMENT_READY.</p>
        )}
        {bundle.deployments.length === 0 ? <EmptyState>No deployment attempts recorded.</EmptyState> : null}
        {bundle.deployments.map((row) => {
          const rows = bundle.evidence.filter((item) => item.deploymentId === row.id);
          const active = row.status === "IN_PROGRESS" || row.status === "QUEUED";
          return (
            <article className="list-item" key={row.id}>
              <h3>
                {row.humanId} · <StatusBadge status={row.status} />
              </h3>
              <p className="quiet">
                Expected {row.expectedCommitSha || "unknown"} · Live {row.liveCommitSha || "not recorded"}
                {row.liveCommitSha ? (shasMatch(row.expectedCommitSha, row.liveCommitSha) ? " · match" : " · MISMATCH") : ""}
              </p>
              {row.failureReason ? <p>Failure: {row.failureReason}</p> : null}
              <p className="quiet">Evidence rows: {rows.length}</p>
              {rows.map((item) => (
                <p className="quiet" key={item.id}>
                  {item.kind}: {item.reference}
                  {item.summary ? ` — ${item.summary}` : ""}
                </p>
              ))}
              {active ? (
                <>
                  <ActionForm action={recordDeploymentEvidenceAction} submitLabel="Add evidence">
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="deploymentId" value={row.id} />
                    <label className="field">
                      <span>Kind</span>
                      <select name="kind" defaultValue="PROVIDER_STATUS">
                        {options(DEPLOYMENT_EVIDENCE_KINDS)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Reference (no secrets)</span>
                      <input name="reference" required placeholder="provider deploy id, URL, command…" />
                    </label>
                    <label className="field">
                      <span>Summary</span>
                      <textarea name="summary" />
                    </label>
                  </ActionForm>
                  <ActionForm action={recordLiveShaAction} submitLabel="Record live SHA">
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="deploymentId" value={row.id} />
                    <label className="field">
                      <span>Live commit SHA</span>
                      <input name="liveCommitSha" required />
                    </label>
                  </ActionForm>
                  <ActionForm action={completeDeploymentAction} submitLabel="Mark SUCCEEDED">
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="deploymentId" value={row.id} />
                  </ActionForm>
                  <ActionForm action={failDeploymentAction} submitLabel="Mark FAILED">
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="deploymentId" value={row.id} />
                    <label className="field">
                      <span>Failure reason</span>
                      <textarea name="failureReason" required />
                    </label>
                  </ActionForm>
                </>
              ) : null}
            </article>
          );
        })}
        {activeDeployments.length === 0 && release.status === "DEPLOYED" ? (
          <p className="quiet">Deployed is not production verified. Move to PRODUCTION_VERIFICATION to record health and gates.</p>
        ) : null}
      </Panel>

      <Panel title="Health checks">
        {bundle.healthChecks.length === 0 ? <EmptyState>No health checks recorded.</EmptyState> : null}
        {bundle.healthChecks.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.checkName} · <StatusBadge status={row.status} />
            </h3>
            <p className="quiet">
              {row.expectedValue ? `Expected ${row.expectedValue}` : "No expected value"} ·{" "}
              {row.observedValue ? `Observed ${row.observedValue}` : "Not observed"}
            </p>
            <ActionForm action={recordHealthCheckAction} submitLabel="Update health check">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="healthCheckId" value={row.id} />
              <label className="field">
                <span>Status</span>
                <select name="status" defaultValue={row.status}>
                  {options(DEPLOYMENT_HEALTH_STATUSES)}
                </select>
              </label>
              <label className="field">
                <span>Observed</span>
                <input name="observedValue" defaultValue={row.observedValue} />
              </label>
              <label className="field">
                <span>Evidence reference</span>
                <input name="evidenceRef" defaultValue={row.evidenceRef} />
              </label>
            </ActionForm>
          </article>
        ))}
        {bundle.deployments.length > 0 ? (
          <ActionForm action={recordHealthCheckAction} submitLabel="Add health check">
            <input type="hidden" name="projectId" value={projectId} />
            <label className="field">
              <span>Deployment</span>
              <select name="deploymentId" required>
                {bundle.deployments.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.humanId} ({row.status})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Check name</span>
              <input name="checkName" required placeholder="api health" />
            </label>
            <label className="field">
              <span>Expected</span>
              <input name="expectedValue" />
            </label>
            <label className="field">
              <span>Observed</span>
              <input name="observedValue" />
            </label>
            <label className="field">
              <span>Status</span>
              <select name="status" defaultValue="PENDING">
                {options(DEPLOYMENT_HEALTH_STATUSES)}
              </select>
            </label>
          </ActionForm>
        ) : null}
      </Panel>

      <Panel title="Production verification">
        {production.productionVerified ? (
          <>
            <p>
              <strong>PRODUCTION EVIDENCE COMPLETE</strong>
            </p>
            <ul className="meta">
              {production.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p>
              <strong>NOT PRODUCTION VERIFIED</strong> · {production.gaps.length} item
              {production.gaps.length === 1 ? "" : "s"} remaining
            </p>
            <ul className="meta">
              {production.gaps.map((gap) => (
                <li key={gap.code + gap.message}>{gap.message}</li>
              ))}
            </ul>
          </>
        )}
        {production.warnings.length > 0 ? (
          <ul className="meta">
            {production.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        {productionGateTarget ? (
          <ActionForm action={recordProductionGateAction} submitLabel="Record production gate">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="deploymentId" value={productionGateTarget.id} />
            <p className="quiet">
              Recording against {productionGateTarget.humanId} (inspector {productionGateTarget.inspectorResult || "none"}
              , presentation {productionGateTarget.presentationResult || "none"}).
            </p>
            <label className="field">
              <span>Inspector result</span>
              <select name="inspectorResult" defaultValue="">
                <option value="">(unchanged)</option>
                <option value="PASSED">PASSED</option>
                <option value="FAILED">FAILED</option>
                <option value="BLOCKED">BLOCKED</option>
              </select>
            </label>
            <label className="field">
              <span>Presentation result</span>
              <select name="presentationResult" defaultValue="">
                <option value="">(unchanged)</option>
                <option value="READY">READY</option>
                <option value="READY_WITH_GAPS">READY_WITH_GAPS</option>
                <option value="NOT_READY">NOT_READY</option>
              </select>
            </label>
            <label className="field">
              <span>Evidence reference (inspector run id, no secrets)</span>
              <input name="evidenceRef" />
            </label>
          </ActionForm>
        ) : (
          <EmptyState>Production gates are recorded against a SUCCEEDED deployment.</EmptyState>
        )}
      </Panel>

      <Panel title="Rollback">
        <p className="quiet">
          Rollback records are not performed rollbacks. Ghost never rolls back for you. Strategy:{" "}
          {release.rollbackStrategy || "not recorded"}
        </p>
        {bundle.rollbacks.length === 0 ? <EmptyState>No rollback records.</EmptyState> : null}
        {bundle.rollbacks.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              <StatusBadge status={row.status} /> {row.targetCommitSha || "no target SHA"}
            </h3>
            {row.reason ? <p>{row.reason}</p> : null}
          </article>
        ))}
        <ActionForm action={requestRollbackAction} submitLabel="Request rollback">
          <input type="hidden" name="projectId" value={projectId} />
          {bundle.rollbacks.find((row) => row.status === "AVAILABLE") ? (
            <input
              type="hidden"
              name="rollbackId"
              value={bundle.rollbacks.find((row) => row.status === "AVAILABLE")?.id ?? ""}
            />
          ) : null}
          <label className="field">
            <span>Reason</span>
            <textarea name="reason" required />
          </label>
          <label className="field">
            <span>Target commit SHA</span>
            <input name="targetCommitSha" defaultValue={release.rollbackTargetCommitSha} />
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
        <ActionForm action={escalateReleaseDecisionAction} submitLabel="Escalate deployment decision">
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

      <Panel title="History">
        <h3>Releases</h3>
        <ul className="meta">
          {releaseRows.map((row) => (
            <li key={row.id}>
              {row.humanId} · {row.status} · {row.sourceCommitSha.slice(0, 12) || "no sha"} · {row.createdAt}
            </li>
          ))}
        </ul>
        <h3>Transitions ({release.humanId})</h3>
        {history.length === 0 ? <EmptyState>No transitions yet.</EmptyState> : null}
        <ul className="meta">
          {history.map((row) => (
            <li key={row.id}>
              {row.fromStatus ?? "∅"} → {row.toStatus} · {row.reason} · {row.changedAt}
            </li>
          ))}
        </ul>
        {release.status === "PRODUCTION_VERIFIED" ? (
          <ActionForm action={initializeReleaseAction} submitLabel="Create new release">
            <input type="hidden" name="projectId" value={projectId} />
            <label className="field">
              <span>Source branch</span>
              <input name="sourceBranch" defaultValue={release.sourceBranch} />
            </label>
            <label className="field">
              <span>Source commit SHA</span>
              <input name="sourceCommitSha" required />
            </label>
            <label className="field">
              <span>Required migration paths (one per line, optional)</span>
              <textarea name="migrationPaths" />
            </label>
          </ActionForm>
        ) : null}
      </Panel>

      {ask}
    </div>
  );
}
