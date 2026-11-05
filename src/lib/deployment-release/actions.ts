"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { createNextAction } from "@/lib/operations/actions";
import { PRESENTATION_RESULTS } from "@/lib/presentation/types";
import {
  DEFAULT_PRODUCTION_ENVIRONMENT,
  initializeReleaseFromProject,
  parseLineList,
} from "./initialize";
import {
  addDeploymentEvidence,
  createDeployment,
  createHealthCheck,
  createManualAction,
  createRollback,
  ensureDefaultEnvironments,
  loadLatestRelease,
  loadReleaseBundle,
  recordReleaseTransition,
  saveDeploymentEnvironment,
  updateConfigPresence,
  updateDeployment,
  updateHealthCheck,
  updateManualAction,
  updateReleaseMigration,
  updateReleaseOverview,
  updateRollback,
  upsertConfigRequirement,
  createReleaseMigration,
} from "./queries";
import {
  CONFIG_PRESENCE_STATUSES,
  DEPLOYMENT_ENVIRONMENT_TYPES,
  DEPLOYMENT_EVIDENCE_KINDS,
  DEPLOYMENT_HEALTH_STATUSES,
  MANUAL_ACTION_STATUSES,
  RELEASE_MIGRATION_STATUSES,
  RELEASE_STATUSES,
  type ReleaseBundle,
  type ReleaseStatus,
} from "./types";
import {
  canTransitionRelease,
  evaluateReleaseBundle,
  shasMatch,
  suggestReleaseNextAction,
} from "./workflow";

type Session = Extract<Awaited<ReturnType<typeof getSession>>, { status: "authenticated" }>;

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readEnum<T extends string>(formData: FormData, name: string, allowed: readonly T[], fallback: T): T {
  const value = readField(formData, name);
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function revalidateDeployment(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/deploy`);
  revalidatePath(`/projects/${projectId}/verification`);
  revalidatePath("/dashboard");
}

async function authenticated(): Promise<Session | null> {
  const session = await getSession();
  return session.status === "authenticated" ? session : null;
}

const NOT_SIGNED_IN: ActionState = { error: "You are not signed in.", notice: null };

const INSPECTOR_RESULTS = ["PASSED", "FAILED", "BLOCKED", "READY", "NOT_READY"] as const;
const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

async function targetFor(
  session: Session,
  projectId: string,
): Promise<{ bundle: ReleaseBundle } | { error: ActionState }> {
  const release = await loadLatestRelease(session.supabase, projectId);
  if (release.status === "error") return { error: { error: release.message, notice: null } };
  if (!release.data) return { error: { error: "No release exists for this project yet.", notice: null } };
  const bundle = await loadReleaseBundle(session.supabase, release.data);
  if (bundle.status === "error") return { error: { error: bundle.message, notice: null } };
  return { bundle: bundle.data };
}

function failure(message: string): ActionState {
  return { error: message, notice: null };
}

export async function initializeReleaseAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const created = await initializeReleaseFromProject(session.supabase, {
    projectId,
    sourceBranch: readField(formData, "sourceBranch"),
    sourceCommitSha: readField(formData, "sourceCommitSha"),
    migrationPaths: parseLineList(String(formData.get("migrationPaths") ?? "")),
  });
  if (created.status === "error") return failure(created.message);
  revalidateDeployment(projectId);
  redirect(`/projects/${projectId}/deploy`);
}

export async function transitionReleaseAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const toStatus = readField(formData, "toStatus") as ReleaseStatus;
  if (!RELEASE_STATUSES.includes(toStatus)) return failure("Unknown release status.");
  const reason = readField(formData, "reason") || `Founder moved Release to ${toStatus}.`;

  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { bundle } = target;
  const from = bundle.release.status;
  if (!canTransitionRelease(from, toStatus)) {
    return failure(`Cannot move Release from ${from} to ${toStatus}.`);
  }

  const evaluation = evaluateReleaseBundle(bundle);

  if (toStatus === "DEPLOYING") {
    return failure("Use Start deployment to begin a deployment attempt. Moving the status alone is not a deployment.");
  }

  if (toStatus === "DEPLOYMENT_READY" && evaluation.readiness.gaps.length > 0) {
    const gaps = evaluation.readiness.gaps;
    return failure(`Not DEPLOYMENT_READY (${gaps.length} gap${gaps.length === 1 ? "" : "s"}). ${gaps[0].message}`);
  }

  if (toStatus === "DEPLOYED") {
    const latest = evaluation.latestDeployment;
    if (!latest || latest.status !== "SUCCEEDED") {
      return failure("Not DEPLOYED: the latest deployment attempt is not SUCCEEDED.");
    }
    if (!shasMatch(latest.expectedCommitSha, latest.liveCommitSha)) {
      return failure("Not DEPLOYED: the live commit SHA is missing or does not match the expected SHA.");
    }
    if (!shasMatch(latest.expectedCommitSha, bundle.release.sourceCommitSha)) {
      return failure("Not DEPLOYED: the deployment's expected SHA does not match the release source SHA.");
    }
  }

  if (toStatus === "PRODUCTION_VERIFIED" && evaluation.production.gaps.length > 0) {
    const gaps = evaluation.production.gaps;
    return failure(
      `Not PRODUCTION_VERIFIED (${gaps.length} gap${gaps.length === 1 ? "" : "s"}). ${gaps[0].message}`,
    );
  }

  const transitioned = await recordReleaseTransition(session.supabase, bundle.release.id, toStatus, reason);
  if (transitioned.status === "error") return failure(transitioned.message);
  revalidateDeployment(projectId);
  return {
    error: null,
    notice:
      toStatus === "PRODUCTION_VERIFIED"
        ? "Release is PRODUCTION_VERIFIED. Production evidence passed."
        : toStatus === "DEPLOYED"
          ? "Release is DEPLOYED. Deployed is not production verified."
          : toStatus === "DEPLOYMENT_READY"
            ? "Release is DEPLOYMENT_READY. That is not deployed."
            : `Release is now ${toStatus}.`,
  };
}

export async function updateReleaseOverviewAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { release } = target.bundle;

  const patch: Parameters<typeof updateReleaseOverview>[2] = {
    summary: readField(formData, "summary"),
    note: readField(formData, "note"),
    sourceBranch: readField(formData, "sourceBranch"),
    releaseVersion: readField(formData, "releaseVersion"),
    rollbackStrategy: readField(formData, "rollbackStrategy"),
    rollbackTargetCommitSha: readField(formData, "rollbackTargetCommitSha"),
    deploymentSequence: parseLineList(String(formData.get("deploymentSequence") ?? "")),
  };
  const sha = readField(formData, "sourceCommitSha");
  if (sha && sha !== release.sourceCommitSha) {
    if (release.status !== "DRAFT" && release.status !== "DEPLOYMENT_READY") {
      return failure("The source commit SHA can only change while the release is DRAFT or DEPLOYMENT_READY.");
    }
    patch.sourceCommitSha = sha;
  }
  const environmentId = readField(formData, "environmentId");
  if (environmentId) patch.environmentId = environmentId;

  const updated = await updateReleaseOverview(session.supabase, release.id, patch);
  if (updated.status === "error") return failure(updated.message);
  revalidateDeployment(projectId);
  return { error: null, notice: "Release overview updated." };
}

export async function setEnvironmentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const name = readField(formData, "name");
  if (!name) return failure("Environment name is required.");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;

  const saved = await saveDeploymentEnvironment(session.supabase, {
    projectId,
    name,
    environmentType: readEnum(formData, "environmentType", DEPLOYMENT_ENVIRONMENT_TYPES, "PRODUCTION"),
    provider: readField(formData, "provider"),
    applicationUrl: readField(formData, "applicationUrl"),
    healthEndpoint: readField(formData, "healthEndpoint"),
    serviceIdentity: readField(formData, "serviceIdentity"),
    note: readField(formData, "note"),
  });
  if (saved.status === "error") return failure(saved.message);

  if (readField(formData, "makeCurrent") !== "0") {
    const linked = await updateReleaseOverview(session.supabase, target.bundle.release.id, {
      environmentId: saved.data.id,
    });
    if (linked.status === "error") return failure(linked.message);
  }
  revalidateDeployment(projectId);
  return { error: null, notice: `Environment ${saved.data.name} saved (safe metadata only).` };
}

export async function ensureEnvironmentsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;

  const environments = await ensureDefaultEnvironments(session.supabase, projectId, [DEFAULT_PRODUCTION_ENVIRONMENT]);
  if (environments.status === "error") return failure(environments.message);
  const production = environments.data.find((row) => row.environmentType === "PRODUCTION") ?? environments.data[0];
  if (production && !target.bundle.release.environmentId) {
    const linked = await updateReleaseOverview(session.supabase, target.bundle.release.id, {
      environmentId: production.id,
    });
    if (linked.status === "error") return failure(linked.message);
  }
  revalidateDeployment(projectId);
  return { error: null, notice: `${environments.data.length} environment${environments.data.length === 1 ? "" : "s"} recorded.` };
}

export async function setConfigPresenceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { release } = target.bundle;

  const presence = readEnum(formData, "presence", CONFIG_PRESENCE_STATUSES, "UNKNOWN");
  const configId = readField(formData, "configId");
  const note = readField(formData, "note");

  if (configId) {
    if (!target.bundle.configRequirements.some((row) => row.id === configId)) {
      return failure("That configuration requirement does not belong to this release.");
    }
    const updated = await updateConfigPresence(session.supabase, configId, { presence, note });
    if (updated.status === "error") return failure(updated.message);
    revalidateDeployment(projectId);
    return { error: null, notice: `${updated.data.variableName} recorded as ${presence}. The value is never stored.` };
  }

  const created = await upsertConfigRequirement(session.supabase, {
    releaseId: release.id,
    projectId,
    environmentId: release.environmentId,
    variableName: readField(formData, "variableName"),
    isRequired: readField(formData, "isRequired") !== "0",
    isSecret: readField(formData, "isSecret") !== "0",
    presence,
    note,
  });
  if (created.status === "error") return failure(created.message);
  revalidateDeployment(projectId);
  return { error: null, notice: `${created.data.variableName} recorded as ${presence}. The value is never stored.` };
}

export async function setMigrationStatusAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { release } = target.bundle;

  const status = readEnum(formData, "status", RELEASE_MIGRATION_STATUSES, "PENDING");
  const migrationId = readField(formData, "migrationId");
  const evidenceRef = readField(formData, "evidenceRef");
  const note = readField(formData, "note");

  if (migrationId) {
    if (!target.bundle.migrations.some((row) => row.id === migrationId)) {
      return failure("That migration does not belong to this release.");
    }
    const updated = await updateReleaseMigration(session.supabase, migrationId, { status, evidenceRef, note });
    if (updated.status === "error") return failure(updated.message);
    revalidateDeployment(projectId);
    return { error: null, notice: `${updated.data.migrationPath} recorded as ${status}.` };
  }

  const migrationPath = readField(formData, "migrationPath");
  if (!migrationPath) return failure("A migration path is required.");
  const created = await createReleaseMigration(session.supabase, {
    releaseId: release.id,
    projectId,
    environmentId: release.environmentId,
    migrationPath,
    isRequired: readField(formData, "isRequired") !== "0",
    status,
    evidenceRef,
    note,
  });
  if (created.status === "error") return failure(created.message);
  revalidateDeployment(projectId);
  return { error: null, notice: `${created.data.migrationPath} recorded as ${status}.` };
}

export async function createManualActionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;

  const title = readField(formData, "title");
  if (!title) return failure("A manual action title is required.");
  const created = await createManualAction(session.supabase, {
    releaseId: target.bundle.release.id,
    projectId,
    title,
    instruction: readField(formData, "instruction"),
    isRequired: readField(formData, "isRequired") !== "0",
  });
  if (created.status === "error") return failure(created.message);
  revalidateDeployment(projectId);
  return { error: null, notice: "Manual action recorded." };
}

export async function completeManualActionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;

  const actionId = readField(formData, "actionId");
  if (!target.bundle.manualActions.some((row) => row.id === actionId)) {
    return failure("That manual action does not belong to this release.");
  }
  const status = readEnum(formData, "status", MANUAL_ACTION_STATUSES, "COMPLETED");
  const updated = await updateManualAction(session.supabase, actionId, {
    status,
    evidenceRef: readField(formData, "evidenceRef"),
    note: readField(formData, "note"),
  });
  if (updated.status === "error") return failure(updated.message);
  revalidateDeployment(projectId);
  return { error: null, notice: `Manual action marked ${status}.` };
}

export async function startDeploymentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { bundle } = target;
  const { release } = bundle;

  if (release.status !== "DEPLOYMENT_READY") {
    return failure(`Release is ${release.status}. It must be DEPLOYMENT_READY before a deployment can start.`);
  }
  const active = bundle.deployments.find((row) => row.status === "QUEUED" || row.status === "IN_PROGRESS");
  if (active) return failure(`${active.humanId} is already ${active.status}. Finish or fail it first.`);

  const evaluation = evaluateReleaseBundle(bundle);
  if (evaluation.readiness.gaps.length > 0) {
    return failure(`Readiness regressed. ${evaluation.readiness.gaps[0].message}`);
  }

  const environment = bundle.environments.find((row) => row.id === release.environmentId);
  if (!environment) return failure("Select a deployment environment first.");

  const created = await createDeployment(session.supabase, {
    releaseId: release.id,
    projectId,
    environmentId: environment.id,
    provider: environment.provider,
    providerDeploymentId: readField(formData, "providerDeploymentId"),
    expectedCommitSha: release.sourceCommitSha,
    deploymentUrl: environment.applicationUrl,
  });
  if (created.status === "error") return failure(created.message);

  const started = await updateDeployment(session.supabase, created.data.id, {
    status: "IN_PROGRESS",
    startedAt: new Date().toISOString(),
  });
  if (started.status === "error") return failure(started.message);

  const transitioned = await recordReleaseTransition(
    session.supabase,
    release.id,
    "DEPLOYING",
    `Founder started deployment ${created.data.humanId}.`,
  );
  if (transitioned.status === "error") return failure(transitioned.message);

  revalidateDeployment(projectId);
  return {
    error: null,
    notice: `${created.data.humanId} IN_PROGRESS. Record evidence and the live SHA before completing. Deploying is not deployed.`,
  };
}

export async function recordDeploymentEvidenceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;

  const deploymentId = readField(formData, "deploymentId");
  if (!target.bundle.deployments.some((row) => row.id === deploymentId)) {
    return failure("That deployment does not belong to this release.");
  }
  const created = await addDeploymentEvidence(session.supabase, {
    deploymentId,
    releaseId: target.bundle.release.id,
    projectId,
    kind: readEnum(formData, "kind", DEPLOYMENT_EVIDENCE_KINDS, "MANUAL_OBSERVATION"),
    reference: readField(formData, "reference"),
    summary: readField(formData, "summary"),
  });
  if (created.status === "error") return failure(created.message);
  revalidateDeployment(projectId);
  return { error: null, notice: "Deployment evidence recorded (reference only — no secret values)." };
}

export async function recordLiveShaAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;

  const deploymentId = readField(formData, "deploymentId");
  const deployment = target.bundle.deployments.find((row) => row.id === deploymentId);
  if (!deployment) return failure("That deployment does not belong to this release.");
  const liveCommitSha = readField(formData, "liveCommitSha");
  if (!SHA_PATTERN.test(liveCommitSha)) return failure("Enter the live commit SHA (7–64 hex characters).");

  const updated = await updateDeployment(session.supabase, deploymentId, { liveCommitSha });
  if (updated.status === "error") return failure(updated.message);
  const evidence = await addDeploymentEvidence(session.supabase, {
    deploymentId,
    releaseId: target.bundle.release.id,
    projectId,
    kind: "LIVE_SHA",
    reference: `live-sha:${liveCommitSha}`,
    summary: readField(formData, "summary") || "Live commit SHA observed by the founder.",
  });
  if (evidence.status === "error") return failure(evidence.message);
  revalidateDeployment(projectId);
  const matches = shasMatch(deployment.expectedCommitSha, liveCommitSha);
  return {
    error: null,
    notice: matches
      ? "Live SHA recorded and matches the expected SHA."
      : "Live SHA recorded but does NOT match the expected SHA. The deployment cannot complete.",
  };
}

export async function completeDeploymentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { bundle } = target;

  const deploymentId = readField(formData, "deploymentId");
  const deployment = bundle.deployments.find((row) => row.id === deploymentId);
  if (!deployment) return failure("That deployment does not belong to this release.");
  if (!shasMatch(deployment.expectedCommitSha, deployment.liveCommitSha)) {
    return failure("Cannot complete: the live commit SHA is missing or does not match the expected SHA.");
  }
  const evidenceCount = bundle.evidence.filter((row) => row.deploymentId === deploymentId).length;

  const updated = await updateDeployment(
    session.supabase,
    deploymentId,
    { status: "SUCCEEDED", completedAt: new Date().toISOString(), failureReason: "" },
    { evidenceCount },
  );
  if (updated.status === "error") return failure(updated.message);

  if (bundle.release.status === "DEPLOYING") {
    const transitioned = await recordReleaseTransition(
      session.supabase,
      bundle.release.id,
      "DEPLOYED",
      `Deployment ${deployment.humanId} SUCCEEDED with evidence and a matching live SHA.`,
    );
    if (transitioned.status === "error") return failure(transitioned.message);
  }

  revalidateDeployment(projectId);
  return {
    error: null,
    notice: `${deployment.humanId} SUCCEEDED. Release is DEPLOYED, which is not production verified.`,
  };
}

export async function failDeploymentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { bundle } = target;

  const deploymentId = readField(formData, "deploymentId");
  const deployment = bundle.deployments.find((row) => row.id === deploymentId);
  if (!deployment) return failure("That deployment does not belong to this release.");
  const failureReason = readField(formData, "failureReason");
  if (!failureReason) return failure("A failure reason is required.");

  const updated = await updateDeployment(session.supabase, deploymentId, {
    status: "FAILED",
    failureReason,
    completedAt: new Date().toISOString(),
  });
  if (updated.status === "error") return failure(updated.message);

  if (bundle.release.status === "DEPLOYING") {
    const transitioned = await recordReleaseTransition(
      session.supabase,
      bundle.release.id,
      "DEPLOYMENT_READY",
      `Deployment ${deployment.humanId} FAILED: ${failureReason.slice(0, 200)}`,
    );
    if (transitioned.status === "error") return failure(transitioned.message);
  }

  await createNextAction(session.supabase, {
    projectId,
    title: "Resolve failed deployment",
    description: `${deployment.humanId} FAILED: ${failureReason.slice(0, 200)}. Fix the cause, then start a new attempt.`,
    provenance: "FOUNDER_APPROVED_ACTION",
    sourceKind: "deployment",
    sourceRef: deployment.id,
    priority: "HIGH",
  });

  revalidateDeployment(projectId);
  return {
    error: null,
    notice: `${deployment.humanId} FAILED. History is preserved; the release is back to DEPLOYMENT_READY.`,
  };
}

export async function recordHealthCheckAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { bundle } = target;

  const status = readEnum(formData, "status", DEPLOYMENT_HEALTH_STATUSES, "PENDING");
  const healthCheckId = readField(formData, "healthCheckId");

  if (healthCheckId) {
    if (!bundle.healthChecks.some((row) => row.id === healthCheckId)) {
      return failure("That health check does not belong to this release.");
    }
    const updated = await updateHealthCheck(session.supabase, healthCheckId, {
      status,
      observedValue: readField(formData, "observedValue"),
      evidenceRef: readField(formData, "evidenceRef"),
      note: readField(formData, "note"),
    });
    if (updated.status === "error") return failure(updated.message);
    revalidateDeployment(projectId);
    return { error: null, notice: `Health check "${updated.data.checkName}" recorded as ${status}.` };
  }

  const deploymentId = readField(formData, "deploymentId");
  if (!bundle.deployments.some((row) => row.id === deploymentId)) {
    return failure("That deployment does not belong to this release.");
  }
  const checkName = readField(formData, "checkName");
  if (!checkName) return failure("A health check name is required.");
  const created = await createHealthCheck(session.supabase, {
    deploymentId,
    releaseId: bundle.release.id,
    projectId,
    checkName,
    status,
    expectedValue: readField(formData, "expectedValue"),
    observedValue: readField(formData, "observedValue"),
    evidenceRef: readField(formData, "evidenceRef"),
    note: readField(formData, "note"),
  });
  if (created.status === "error") return failure(created.message);
  revalidateDeployment(projectId);
  return { error: null, notice: `Health check "${created.data.checkName}" recorded as ${status}.` };
}

export async function recordProductionGateAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;

  const deploymentId = readField(formData, "deploymentId");
  if (!target.bundle.deployments.some((row) => row.id === deploymentId)) {
    return failure("That deployment does not belong to this release.");
  }
  const inspectorResult = readField(formData, "inspectorResult").toUpperCase();
  const presentationResult = readField(formData, "presentationResult").toUpperCase();
  if (inspectorResult && !(INSPECTOR_RESULTS as readonly string[]).includes(inspectorResult)) {
    return failure(`Inspector result must be one of ${INSPECTOR_RESULTS.join(", ")}.`);
  }
  if (presentationResult && !(PRESENTATION_RESULTS as readonly string[]).includes(presentationResult)) {
    return failure(`Presentation result must be one of ${PRESENTATION_RESULTS.join(", ")}.`);
  }

  const updated = await updateDeployment(session.supabase, deploymentId, {
    ...(inspectorResult ? { inspectorResult } : {}),
    ...(presentationResult ? { presentationResult } : {}),
  });
  if (updated.status === "error") return failure(updated.message);

  const evidenceRef = readField(formData, "evidenceRef");
  if (evidenceRef) {
    const evidence = await addDeploymentEvidence(session.supabase, {
      deploymentId,
      releaseId: target.bundle.release.id,
      projectId,
      kind: presentationResult && !inspectorResult ? "PRESENTATION_GATE" : "INSPECTOR_RUN",
      reference: evidenceRef,
      summary: readField(formData, "summary") || "Production gate evidence.",
    });
    if (evidence.status === "error") return failure(evidence.message);
  }

  revalidateDeployment(projectId);
  return {
    error: null,
    notice:
      presentationResult === "READY_WITH_GAPS"
        ? "Production gate recorded. READY_WITH_GAPS is allowed, but gaps stay visible."
        : "Production gate recorded.",
  };
}

export async function requestRollbackAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { bundle } = target;

  const reason = readField(formData, "reason");
  if (!reason) return failure("A rollback reason is required.");
  const rollbackId = readField(formData, "rollbackId");

  if (rollbackId) {
    if (!bundle.rollbacks.some((row) => row.id === rollbackId)) {
      return failure("That rollback does not belong to this release.");
    }
    const updated = await updateRollback(session.supabase, rollbackId, { status: "REQUESTED", reason });
    if (updated.status === "error") return failure(updated.message);
  } else {
    const created = await createRollback(session.supabase, {
      releaseId: bundle.release.id,
      projectId,
      targetReleaseId: bundle.release.rollbackTargetReleaseId,
      targetCommitSha: readField(formData, "targetCommitSha") || bundle.release.rollbackTargetCommitSha,
      status: "REQUESTED",
      reason,
    });
    if (created.status === "error") return failure(created.message);
  }

  await createNextAction(session.supabase, {
    projectId,
    title: "Carry out requested rollback",
    description: `Rollback requested: ${reason.slice(0, 200)}. Record evidence when it completes.`,
    provenance: "FOUNDER_APPROVED_ACTION",
    sourceKind: "deployment",
    sourceRef: bundle.release.id,
    priority: "HIGH",
  });

  revalidateDeployment(projectId);
  return { error: null, notice: "Rollback REQUESTED. Ghost does not perform it; record evidence when it completes." };
}

export async function escalateReleaseDecisionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { release } = target.bundle;

  const question = readField(formData, "question");
  if (!question) return failure("A question is required.");
  const deploymentId = readField(formData, "deploymentId");
  const inserted = await session.supabase
    .from("project_decisions")
    .insert({
      project_id: projectId,
      release_id: release.id,
      deployment_id: target.bundle.deployments.some((row) => row.id === deploymentId) ? deploymentId : null,
      title: readField(formData, "title") || question.slice(0, 120),
      question,
      context: "Escalated from Deployment.",
      options: [
        readField(formData, "optionA") ? { id: "a", label: readField(formData, "optionA") } : null,
        readField(formData, "optionB") ? { id: "b", label: readField(formData, "optionB") } : null,
      ].filter(Boolean),
      recommendation: readField(formData, "recommendation") || null,
      evidence: [{ type: "release", id: release.id, title: question.slice(0, 80) }],
      created_by: session.user.id,
      status: "OPEN",
    })
    .select("id")
    .single();
  if (inserted.error) return failure(inserted.error.message);
  revalidateDeployment(projectId);
  return { error: null, notice: "Deployment decision escalated to Needs Your Decision." };
}

export async function syncReleaseNextActionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await targetFor(session, projectId);
  if ("error" in target) return target.error;
  const { bundle } = target;

  const { readiness, production, latestDeployment } = evaluateReleaseBundle(bundle);
  const suggestion = suggestReleaseNextAction({
    status: bundle.release.status,
    readiness,
    production,
    latestDeployment,
  });
  if (!suggestion) {
    return { error: null, notice: "No justified next action from current deployment state." };
  }
  await createNextAction(session.supabase, {
    projectId,
    title: suggestion.title,
    description: suggestion.description,
    provenance: "FOUNDER_APPROVED_ACTION",
    sourceKind: suggestion.sourceKind,
    sourceRef: bundle.release.id,
    priority: "HIGH",
  });
  revalidateDeployment(projectId);
  return { error: null, notice: `Next action recorded: ${suggestion.title}` };
}
