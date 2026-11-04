import type { GhostClient } from "@/lib/auth/session";
import type { Database } from "@/lib/database.types";
import { fromError, type QueryResult } from "@/lib/result";
import type {
  ConfigPresenceStatus,
  Deployment,
  DeploymentAttemptStatus,
  DeploymentEnvironment,
  DeploymentEnvironmentType,
  DeploymentEvidence,
  DeploymentEvidenceKind,
  DeploymentHealthCheck,
  DeploymentHealthStatus,
  DeploymentManualAction,
  DeploymentManualActionStatus,
  Release,
  ReleaseBundle,
  ReleaseConfigRequirement,
  ReleaseMigration,
  ReleaseMigrationStatus,
  ReleaseRollback,
  ReleaseStatus,
  ReleaseTransition,
  RollbackStatus,
} from "./types";
import {
  canTransitionDeployment,
  containsSecretLikeText,
  nextHumanId,
  rejectSecretConfigValue,
  rejectSecretEvidenceReference,
} from "./workflow";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

function isMissing(message: string, table: string): boolean {
  return new RegExp(`${table}|does not exist|schema cache`, "i").test(message);
}

const now = () => new Date().toISOString();

function rejectSecretText(label: string, value: string | undefined): string | null {
  if (value && containsSecretLikeText(value)) {
    return `${label} looks like a secret value. Record a reference or presence only, never secret values.`;
  }
  return null;
}

function mapEnvironment(row: Row<"deployment_environments">): DeploymentEnvironment {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    environmentType: row.environment_type,
    provider: row.provider,
    applicationUrl: row.application_url,
    healthEndpoint: row.health_endpoint,
    serviceIdentity: row.service_identity,
    isActive: row.is_active,
    note: row.note,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelease(row: Row<"releases">): Release {
  return {
    id: row.id,
    projectId: row.project_id,
    verificationProgramId: row.verification_program_id,
    buildExecutionId: row.build_execution_id,
    buildPlanId: row.build_plan_id,
    productArchitectureId: row.product_architecture_id,
    systemArchitectureId: row.system_architecture_id,
    environmentId: row.environment_id,
    humanId: row.human_id,
    summary: row.summary,
    status: row.status,
    sourceBranch: row.source_branch,
    sourceCommitSha: row.source_commit_sha,
    releaseVersion: row.release_version,
    deploymentSequence: row.deployment_sequence ?? [],
    rollbackStrategy: row.rollback_strategy,
    rollbackTargetReleaseId: row.rollback_target_release_id,
    rollbackTargetCommitSha: row.rollback_target_commit_sha,
    note: row.note,
    deployedAt: row.deployed_at,
    productionVerifiedAt: row.production_verified_at,
    productionVerifiedBy: row.production_verified_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function mapTransition(row: Row<"release_transitions">): ReleaseTransition {
  return {
    id: row.id,
    releaseId: row.release_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    actor: row.actor,
    reason: row.reason,
  };
}

function mapConfig(row: Row<"release_config_requirements">): ReleaseConfigRequirement {
  return {
    id: row.id,
    releaseId: row.release_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    variableName: row.variable_name,
    isRequired: row.is_required,
    isSecret: row.is_secret,
    presence: row.presence,
    verifiedAt: row.verified_at,
    note: row.note,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMigration(row: Row<"release_migrations">): ReleaseMigration {
  return {
    id: row.id,
    releaseId: row.release_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    migrationPath: row.migration_path,
    isRequired: row.is_required,
    status: row.status,
    appliedAt: row.applied_at,
    evidenceRef: row.evidence_ref,
    note: row.note,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDeployment(row: Row<"deployments">): Deployment {
  return {
    id: row.id,
    releaseId: row.release_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    humanId: row.human_id,
    status: row.status,
    provider: row.provider,
    providerDeploymentId: row.provider_deployment_id,
    expectedCommitSha: row.expected_commit_sha,
    liveCommitSha: row.live_commit_sha,
    deploymentUrl: row.deployment_url,
    failureReason: row.failure_reason,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    inspectorResult: row.inspector_result,
    presentationResult: row.presentation_result,
    note: row.note,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function mapEvidence(row: Row<"deployment_evidence">): DeploymentEvidence {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    releaseId: row.release_id,
    projectId: row.project_id,
    kind: row.kind,
    reference: row.reference,
    summary: row.summary,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mapHealth(row: Row<"deployment_health_checks">): DeploymentHealthCheck {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    releaseId: row.release_id,
    projectId: row.project_id,
    checkName: row.check_name,
    status: row.status,
    expectedValue: row.expected_value,
    observedValue: row.observed_value,
    evidenceRef: row.evidence_ref,
    checkedAt: row.checked_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapManualAction(row: Row<"deployment_manual_actions">): DeploymentManualAction {
  return {
    id: row.id,
    releaseId: row.release_id,
    projectId: row.project_id,
    deploymentId: row.deployment_id,
    title: row.title,
    instruction: row.instruction,
    isRequired: row.is_required,
    status: row.status,
    evidenceRef: row.evidence_ref,
    completedAt: row.completed_at,
    note: row.note,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRollback(row: Row<"release_rollbacks">): ReleaseRollback {
  return {
    id: row.id,
    releaseId: row.release_id,
    projectId: row.project_id,
    targetReleaseId: row.target_release_id,
    targetCommitSha: row.target_commit_sha,
    status: row.status,
    reason: row.reason,
    evidenceRef: row.evidence_ref,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    note: row.note,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

export async function loadDeploymentEnvironments(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<DeploymentEnvironment[]>> {
  const result = await supabase
    .from("deployment_environments")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "deployment_environments")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapEnvironment) };
}

export type EnvironmentDefaults = {
  name: string;
  environmentType: DeploymentEnvironmentType;
  provider: string;
  applicationUrl: string;
  healthEndpoint: string;
  note?: string;
};

/** Creates the supplied defaults only when the project has no environment yet. Defaults come from the caller. */
export async function ensureDefaultEnvironments(
  supabase: GhostClient,
  projectId: string,
  defaults: EnvironmentDefaults[],
): Promise<QueryResult<DeploymentEnvironment[]>> {
  const existing = await loadDeploymentEnvironments(supabase, projectId);
  if (existing.status === "error") return existing;
  if (existing.data.length > 0 || defaults.length === 0) return existing;

  const inserted = await supabase
    .from("deployment_environments")
    .insert(
      defaults.map((row) => ({
        project_id: projectId,
        name: row.name.trim(),
        environment_type: row.environmentType,
        provider: row.provider.trim(),
        application_url: row.applicationUrl.trim(),
        health_endpoint: row.healthEndpoint.trim(),
        note: row.note?.trim() ?? "",
        source: "founder",
        provenance: "founder",
      })),
    )
    .select("*");
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: inserted.data.map(mapEnvironment) };
}

export async function saveDeploymentEnvironment(
  supabase: GhostClient,
  input: EnvironmentDefaults & {
    projectId: string;
    serviceIdentity?: string;
    isActive?: boolean;
  },
): Promise<QueryResult<DeploymentEnvironment>> {
  const secret = rejectSecretText("Environment URL", input.applicationUrl) ?? rejectSecretText("Environment note", input.note);
  if (secret) return { status: "error", message: secret };

  const payload = {
    project_id: input.projectId,
    name: input.name.trim(),
    environment_type: input.environmentType,
    provider: input.provider.trim(),
    application_url: input.applicationUrl.trim(),
    health_endpoint: input.healthEndpoint.trim(),
    service_identity: input.serviceIdentity?.trim() ?? "",
    is_active: input.isActive ?? true,
    note: input.note?.trim() ?? "",
    updated_at: now(),
  };
  const saved = await supabase
    .from("deployment_environments")
    .upsert(payload, { onConflict: "project_id,name" })
    .select("*")
    .single();
  if (saved.error) return fromError(saved.error);
  return { status: "ok", data: mapEnvironment(saved.data) };
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

export async function loadReleases(supabase: GhostClient, projectId: string): Promise<QueryResult<Release[]>> {
  const result = await supabase
    .from("releases")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "releases")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapRelease) };
}

export async function loadLatestRelease(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<Release | null>> {
  const result = await supabase
    .from("releases")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    if (isMissing(result.error.message, "releases")) return { status: "ok", data: null };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data ? mapRelease(result.data) : null };
}

export async function loadRelease(supabase: GhostClient, releaseId: string): Promise<QueryResult<Release | null>> {
  const result = await supabase.from("releases").select("*").eq("id", releaseId).maybeSingle();
  if (result.error) {
    if (isMissing(result.error.message, "releases")) return { status: "ok", data: null };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data ? mapRelease(result.data) : null };
}

export async function createRelease(
  supabase: GhostClient,
  input: {
    projectId: string;
    verificationProgramId: string;
    buildExecutionId: string;
    buildPlanId: string;
    productArchitectureId: string;
    systemArchitectureId: string;
    environmentId?: string | null;
    summary?: string;
    sourceBranch?: string;
    sourceCommitSha: string;
    releaseVersion?: string;
    deploymentSequence?: string[];
    rollbackStrategy?: string;
    rollbackTargetReleaseId?: string | null;
    rollbackTargetCommitSha?: string;
  },
): Promise<QueryResult<Release>> {
  const existing = await loadReleases(supabase, input.projectId);
  if (existing.status === "error") return existing;
  const humanId = nextHumanId(
    "REL",
    existing.data.map((row) => row.humanId),
  );

  const inserted = await supabase
    .from("releases")
    .insert({
      project_id: input.projectId,
      verification_program_id: input.verificationProgramId,
      build_execution_id: input.buildExecutionId,
      build_plan_id: input.buildPlanId,
      product_architecture_id: input.productArchitectureId,
      system_architecture_id: input.systemArchitectureId,
      environment_id: input.environmentId ?? null,
      human_id: humanId,
      summary: input.summary?.trim() ?? "",
      status: "DRAFT",
      source_branch: input.sourceBranch?.trim() ?? "",
      source_commit_sha: input.sourceCommitSha.trim(),
      release_version: input.releaseVersion?.trim() ?? "",
      deployment_sequence: input.deploymentSequence ?? [],
      rollback_strategy: input.rollbackStrategy?.trim() ?? "",
      rollback_target_release_id: input.rollbackTargetReleaseId ?? null,
      rollback_target_commit_sha: input.rollbackTargetCommitSha?.trim() ?? "",
      note: "Created from a VERIFIED Verification Program. VERIFIED ≠ DEPLOYED ≠ PRODUCTION_VERIFIED.",
      created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);

  await supabase.from("release_transitions").insert({
    release_id: inserted.data.id,
    from_status: null,
    to_status: "DRAFT",
    changed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    actor: "FOUNDER",
    reason: "Release created for project.",
  });

  return { status: "ok", data: mapRelease(inserted.data) };
}

export async function updateReleaseOverview(
  supabase: GhostClient,
  releaseId: string,
  patch: Partial<
    Pick<
      Release,
      | "summary"
      | "note"
      | "sourceBranch"
      | "sourceCommitSha"
      | "releaseVersion"
      | "deploymentSequence"
      | "rollbackStrategy"
      | "rollbackTargetReleaseId"
      | "rollbackTargetCommitSha"
      | "environmentId"
    >
  >,
): Promise<QueryResult<Release>> {
  const secret = rejectSecretText("Release note", patch.note) ?? rejectSecretText("Rollback strategy", patch.rollbackStrategy);
  if (secret) return { status: "error", message: secret };

  const payload: Database["public"]["Tables"]["releases"]["Update"] = { updated_at: now() };
  if (patch.summary !== undefined) payload.summary = patch.summary;
  if (patch.note !== undefined) payload.note = patch.note;
  if (patch.sourceBranch !== undefined) payload.source_branch = patch.sourceBranch;
  if (patch.sourceCommitSha !== undefined) payload.source_commit_sha = patch.sourceCommitSha.trim();
  if (patch.releaseVersion !== undefined) payload.release_version = patch.releaseVersion;
  if (patch.deploymentSequence !== undefined) payload.deployment_sequence = patch.deploymentSequence;
  if (patch.rollbackStrategy !== undefined) payload.rollback_strategy = patch.rollbackStrategy;
  if (patch.rollbackTargetReleaseId !== undefined) payload.rollback_target_release_id = patch.rollbackTargetReleaseId;
  if (patch.rollbackTargetCommitSha !== undefined) payload.rollback_target_commit_sha = patch.rollbackTargetCommitSha.trim();
  if (patch.environmentId !== undefined) payload.environment_id = patch.environmentId;

  const updated = await supabase.from("releases").update(payload).eq("id", releaseId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapRelease(updated.data) };
}

export async function recordReleaseTransition(
  supabase: GhostClient,
  releaseId: string,
  toStatus: ReleaseStatus,
  reason: string,
): Promise<QueryResult<ReleaseTransition>> {
  const result = await supabase.rpc("record_release_transition", {
    target_release_id: releaseId,
    next_status: toStatus,
    transition_reason: reason,
    transition_actor: "FOUNDER",
  });
  if (result.error) return fromError(result.error);
  return { status: "ok", data: mapTransition(result.data) };
}

export async function loadReleaseHistory(
  supabase: GhostClient,
  releaseId: string,
): Promise<QueryResult<ReleaseTransition[]>> {
  const result = await supabase
    .from("release_transitions")
    .select("*")
    .eq("release_id", releaseId)
    .order("changed_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "release_transitions")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapTransition) };
}

// ---------------------------------------------------------------------------
// Configuration presence (never values)
// ---------------------------------------------------------------------------

export async function loadConfigRequirements(
  supabase: GhostClient,
  releaseId: string,
): Promise<QueryResult<ReleaseConfigRequirement[]>> {
  const result = await supabase
    .from("release_config_requirements")
    .select("*")
    .eq("release_id", releaseId)
    .order("variable_name", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "release_config_requirements")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapConfig) };
}

export async function upsertConfigRequirement(
  supabase: GhostClient,
  input: {
    releaseId: string;
    projectId: string;
    environmentId?: string | null;
    variableName: string;
    isRequired?: boolean;
    isSecret?: boolean;
    presence?: ConfigPresenceStatus;
    note?: string;
  },
): Promise<QueryResult<ReleaseConfigRequirement>> {
  const check = rejectSecretConfigValue({ variableName: input.variableName, note: input.note });
  if (!check.ok) return { status: "error", message: check.reason ?? "Invalid configuration name." };

  const presence = input.presence ?? "UNKNOWN";
  const payload: Database["public"]["Tables"]["release_config_requirements"]["Insert"] = {
    release_id: input.releaseId,
    project_id: input.projectId,
    environment_id: input.environmentId ?? null,
    variable_name: input.variableName.trim(),
    presence,
    verified_at: presence === "UNKNOWN" ? null : now(),
    updated_at: now(),
  };
  if (input.isRequired !== undefined) payload.is_required = input.isRequired;
  if (input.isSecret !== undefined) payload.is_secret = input.isSecret;
  if (input.note !== undefined) payload.note = input.note.trim();

  const saved = await supabase
    .from("release_config_requirements")
    .upsert(payload, { onConflict: "release_id,variable_name" })
    .select("*")
    .single();
  if (saved.error) return fromError(saved.error);
  return { status: "ok", data: mapConfig(saved.data) };
}

export async function updateConfigPresence(
  supabase: GhostClient,
  configId: string,
  patch: { presence: ConfigPresenceStatus; note?: string },
): Promise<QueryResult<ReleaseConfigRequirement>> {
  const secret = rejectSecretText("Configuration note", patch.note);
  if (secret) return { status: "error", message: secret };

  const payload: Database["public"]["Tables"]["release_config_requirements"]["Update"] = {
    presence: patch.presence,
    verified_at: patch.presence === "UNKNOWN" ? null : now(),
    updated_at: now(),
  };
  if (patch.note !== undefined) payload.note = patch.note.trim();
  const updated = await supabase
    .from("release_config_requirements")
    .update(payload)
    .eq("id", configId)
    .select("*")
    .single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapConfig(updated.data) };
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export async function loadReleaseMigrations(
  supabase: GhostClient,
  releaseId: string,
): Promise<QueryResult<ReleaseMigration[]>> {
  const result = await supabase
    .from("release_migrations")
    .select("*")
    .eq("release_id", releaseId)
    .order("migration_path", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "release_migrations")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapMigration) };
}

export async function createReleaseMigration(
  supabase: GhostClient,
  input: {
    releaseId: string;
    projectId: string;
    environmentId?: string | null;
    migrationPath: string;
    isRequired?: boolean;
    status?: ReleaseMigrationStatus;
    evidenceRef?: string;
    note?: string;
  },
): Promise<QueryResult<ReleaseMigration>> {
  const secret = rejectSecretText("Evidence reference", input.evidenceRef) ?? rejectSecretText("Note", input.note);
  if (secret) return { status: "error", message: secret };
  const status = input.status ?? "PENDING";

  const saved = await supabase
    .from("release_migrations")
    .upsert(
      {
        release_id: input.releaseId,
        project_id: input.projectId,
        environment_id: input.environmentId ?? null,
        migration_path: input.migrationPath.trim(),
        is_required: input.isRequired ?? true,
        status,
        applied_at: status === "APPLIED" ? now() : null,
        evidence_ref: input.evidenceRef?.trim() ?? "",
        note: input.note?.trim() ?? "",
        updated_at: now(),
      },
      { onConflict: "release_id,migration_path" },
    )
    .select("*")
    .single();
  if (saved.error) return fromError(saved.error);
  return { status: "ok", data: mapMigration(saved.data) };
}

export async function updateReleaseMigration(
  supabase: GhostClient,
  migrationId: string,
  patch: { status?: ReleaseMigrationStatus; isRequired?: boolean; evidenceRef?: string; note?: string },
): Promise<QueryResult<ReleaseMigration>> {
  const secret = rejectSecretText("Evidence reference", patch.evidenceRef) ?? rejectSecretText("Note", patch.note);
  if (secret) return { status: "error", message: secret };

  const payload: Database["public"]["Tables"]["release_migrations"]["Update"] = { updated_at: now() };
  if (patch.status !== undefined) {
    payload.status = patch.status;
    payload.applied_at = patch.status === "APPLIED" ? now() : null;
  }
  if (patch.isRequired !== undefined) payload.is_required = patch.isRequired;
  if (patch.evidenceRef !== undefined) payload.evidence_ref = patch.evidenceRef.trim();
  if (patch.note !== undefined) payload.note = patch.note.trim();
  const updated = await supabase.from("release_migrations").update(payload).eq("id", migrationId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapMigration(updated.data) };
}

// ---------------------------------------------------------------------------
// Deployments + evidence
// ---------------------------------------------------------------------------

export async function loadDeployments(supabase: GhostClient, releaseId: string): Promise<QueryResult<Deployment[]>> {
  const result = await supabase
    .from("deployments")
    .select("*")
    .eq("release_id", releaseId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "deployments")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapDeployment) };
}

export async function createDeployment(
  supabase: GhostClient,
  input: {
    releaseId: string;
    projectId: string;
    environmentId: string;
    provider?: string;
    providerDeploymentId?: string;
    expectedCommitSha: string;
    deploymentUrl?: string;
    note?: string;
  },
): Promise<QueryResult<Deployment>> {
  const secret = rejectSecretText("Deployment URL", input.deploymentUrl) ?? rejectSecretText("Note", input.note);
  if (secret) return { status: "error", message: secret };

  const existing = await loadDeployments(supabase, input.releaseId);
  if (existing.status === "error") return existing;
  const humanId = nextHumanId(
    "DEP",
    existing.data.map((row) => row.humanId),
  );

  const inserted = await supabase
    .from("deployments")
    .insert({
      release_id: input.releaseId,
      project_id: input.projectId,
      environment_id: input.environmentId,
      human_id: humanId,
      status: "QUEUED",
      provider: input.provider?.trim() ?? "",
      provider_deployment_id: input.providerDeploymentId?.trim() ?? "",
      expected_commit_sha: input.expectedCommitSha.trim(),
      deployment_url: input.deploymentUrl?.trim() ?? "",
      note: input.note?.trim() ?? "",
      source: "founder",
      provenance: "founder",
      created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapDeployment(inserted.data) };
}

export async function updateDeployment(
  supabase: GhostClient,
  deploymentId: string,
  patch: Partial<{
    status: DeploymentAttemptStatus;
    provider: string;
    providerDeploymentId: string;
    expectedCommitSha: string;
    liveCommitSha: string;
    deploymentUrl: string;
    failureReason: string;
    startedAt: string | null;
    completedAt: string | null;
    inspectorResult: string;
    presentationResult: string;
    note: string;
  }>,
  options?: { evidenceCount?: number },
): Promise<QueryResult<Deployment>> {
  const secret =
    rejectSecretText("Deployment URL", patch.deploymentUrl) ??
    rejectSecretText("Failure reason", patch.failureReason) ??
    rejectSecretText("Note", patch.note);
  if (secret) return { status: "error", message: secret };

  if (patch.status !== undefined) {
    const current = await supabase.from("deployments").select("*").eq("id", deploymentId).single();
    if (current.error) return fromError(current.error);
    const from = current.data.status as DeploymentAttemptStatus;
    if (from !== patch.status && !canTransitionDeployment(from, patch.status)) {
      return { status: "error", message: `Cannot move deployment from ${from} to ${patch.status}.` };
    }
    if (patch.status === "SUCCEEDED") {
      const evidenceCount =
        options?.evidenceCount ??
        (
          await supabase
            .from("deployment_evidence")
            .select("id", { count: "exact", head: true })
            .eq("deployment_id", deploymentId)
        ).count ??
        0;
      if (evidenceCount < 1) {
        return {
          status: "error",
          message: "Marking a deployment SUCCEEDED requires at least one deployment evidence row.",
        };
      }
    }
  }

  const payload: Database["public"]["Tables"]["deployments"]["Update"] = { updated_at: now() };
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.provider !== undefined) payload.provider = patch.provider;
  if (patch.providerDeploymentId !== undefined) payload.provider_deployment_id = patch.providerDeploymentId;
  if (patch.expectedCommitSha !== undefined) payload.expected_commit_sha = patch.expectedCommitSha.trim();
  if (patch.liveCommitSha !== undefined) payload.live_commit_sha = patch.liveCommitSha.trim();
  if (patch.deploymentUrl !== undefined) payload.deployment_url = patch.deploymentUrl;
  if (patch.failureReason !== undefined) payload.failure_reason = patch.failureReason;
  if (patch.startedAt !== undefined) payload.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt;
  if (patch.inspectorResult !== undefined) payload.inspector_result = patch.inspectorResult;
  if (patch.presentationResult !== undefined) payload.presentation_result = patch.presentationResult;
  if (patch.note !== undefined) payload.note = patch.note;

  const updated = await supabase.from("deployments").update(payload).eq("id", deploymentId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapDeployment(updated.data) };
}

export async function loadDeploymentEvidence(
  supabase: GhostClient,
  releaseId: string,
): Promise<QueryResult<DeploymentEvidence[]>> {
  const result = await supabase
    .from("deployment_evidence")
    .select("*")
    .eq("release_id", releaseId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "deployment_evidence")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapEvidence) };
}

export async function addDeploymentEvidence(
  supabase: GhostClient,
  input: {
    deploymentId: string;
    releaseId: string;
    projectId: string;
    kind: DeploymentEvidenceKind;
    reference: string;
    summary?: string;
  },
): Promise<QueryResult<DeploymentEvidence>> {
  const secretCheck = rejectSecretEvidenceReference(input.reference);
  if (!secretCheck.ok) return { status: "error", message: secretCheck.reason ?? "Invalid evidence reference." };
  const summarySecret = rejectSecretText("Evidence summary", input.summary);
  if (summarySecret) return { status: "error", message: summarySecret };

  const inserted = await supabase
    .from("deployment_evidence")
    .insert({
      deployment_id: input.deploymentId,
      release_id: input.releaseId,
      project_id: input.projectId,
      kind: input.kind,
      reference: input.reference.trim(),
      summary: input.summary?.trim() ?? "",
      source: "founder",
      provenance: "founder",
      created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapEvidence(inserted.data) };
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

export async function loadHealthChecks(
  supabase: GhostClient,
  releaseId: string,
): Promise<QueryResult<DeploymentHealthCheck[]>> {
  const result = await supabase
    .from("deployment_health_checks")
    .select("*")
    .eq("release_id", releaseId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "deployment_health_checks")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapHealth) };
}

export async function createHealthCheck(
  supabase: GhostClient,
  input: {
    deploymentId: string;
    releaseId: string;
    projectId: string;
    checkName: string;
    status?: DeploymentHealthStatus;
    expectedValue?: string;
    observedValue?: string;
    evidenceRef?: string;
    note?: string;
  },
): Promise<QueryResult<DeploymentHealthCheck>> {
  const secret =
    rejectSecretText("Expected value", input.expectedValue) ??
    rejectSecretText("Observed value", input.observedValue) ??
    rejectSecretText("Evidence reference", input.evidenceRef) ??
    rejectSecretText("Note", input.note);
  if (secret) return { status: "error", message: secret };
  const status = input.status ?? "PENDING";

  const inserted = await supabase
    .from("deployment_health_checks")
    .insert({
      deployment_id: input.deploymentId,
      release_id: input.releaseId,
      project_id: input.projectId,
      check_name: input.checkName.trim(),
      status,
      expected_value: input.expectedValue?.trim() ?? "",
      observed_value: input.observedValue?.trim() ?? "",
      evidence_ref: input.evidenceRef?.trim() ?? "",
      checked_at: status === "PENDING" ? null : now(),
      note: input.note?.trim() ?? "",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapHealth(inserted.data) };
}

export async function updateHealthCheck(
  supabase: GhostClient,
  healthCheckId: string,
  patch: {
    status?: DeploymentHealthStatus;
    expectedValue?: string;
    observedValue?: string;
    evidenceRef?: string;
    note?: string;
  },
): Promise<QueryResult<DeploymentHealthCheck>> {
  const secret =
    rejectSecretText("Expected value", patch.expectedValue) ??
    rejectSecretText("Observed value", patch.observedValue) ??
    rejectSecretText("Evidence reference", patch.evidenceRef) ??
    rejectSecretText("Note", patch.note);
  if (secret) return { status: "error", message: secret };

  const payload: Database["public"]["Tables"]["deployment_health_checks"]["Update"] = { updated_at: now() };
  if (patch.status !== undefined) {
    payload.status = patch.status;
    payload.checked_at = patch.status === "PENDING" ? null : now();
  }
  if (patch.expectedValue !== undefined) payload.expected_value = patch.expectedValue.trim();
  if (patch.observedValue !== undefined) payload.observed_value = patch.observedValue.trim();
  if (patch.evidenceRef !== undefined) payload.evidence_ref = patch.evidenceRef.trim();
  if (patch.note !== undefined) payload.note = patch.note.trim();
  const updated = await supabase
    .from("deployment_health_checks")
    .update(payload)
    .eq("id", healthCheckId)
    .select("*")
    .single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapHealth(updated.data) };
}

// ---------------------------------------------------------------------------
// Manual actions
// ---------------------------------------------------------------------------

export async function loadManualActions(
  supabase: GhostClient,
  releaseId: string,
): Promise<QueryResult<DeploymentManualAction[]>> {
  const result = await supabase
    .from("deployment_manual_actions")
    .select("*")
    .eq("release_id", releaseId)
    .order("created_at", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "deployment_manual_actions")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapManualAction) };
}

export async function createManualAction(
  supabase: GhostClient,
  input: {
    releaseId: string;
    projectId: string;
    deploymentId?: string | null;
    title: string;
    instruction?: string;
    isRequired?: boolean;
  },
): Promise<QueryResult<DeploymentManualAction>> {
  const secret = rejectSecretText("Instruction", input.instruction);
  if (secret) return { status: "error", message: secret };

  const inserted = await supabase
    .from("deployment_manual_actions")
    .insert({
      release_id: input.releaseId,
      project_id: input.projectId,
      deployment_id: input.deploymentId ?? null,
      title: input.title.trim(),
      instruction: input.instruction?.trim() ?? "",
      is_required: input.isRequired ?? true,
      source: "founder",
      provenance: "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapManualAction(inserted.data) };
}

export async function updateManualAction(
  supabase: GhostClient,
  actionId: string,
  patch: { status?: DeploymentManualActionStatus; evidenceRef?: string; note?: string },
): Promise<QueryResult<DeploymentManualAction>> {
  const secret = rejectSecretText("Evidence reference", patch.evidenceRef) ?? rejectSecretText("Note", patch.note);
  if (secret) return { status: "error", message: secret };

  const payload: Database["public"]["Tables"]["deployment_manual_actions"]["Update"] = { updated_at: now() };
  if (patch.status !== undefined) {
    payload.status = patch.status;
    payload.completed_at = patch.status === "COMPLETED" ? now() : null;
  }
  if (patch.evidenceRef !== undefined) payload.evidence_ref = patch.evidenceRef.trim();
  if (patch.note !== undefined) payload.note = patch.note.trim();
  const updated = await supabase
    .from("deployment_manual_actions")
    .update(payload)
    .eq("id", actionId)
    .select("*")
    .single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapManualAction(updated.data) };
}

// ---------------------------------------------------------------------------
// Rollbacks
// ---------------------------------------------------------------------------

export async function loadRollbacks(supabase: GhostClient, releaseId: string): Promise<QueryResult<ReleaseRollback[]>> {
  const result = await supabase
    .from("release_rollbacks")
    .select("*")
    .eq("release_id", releaseId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "release_rollbacks")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapRollback) };
}

export async function createRollback(
  supabase: GhostClient,
  input: {
    releaseId: string;
    projectId: string;
    targetReleaseId?: string | null;
    targetCommitSha?: string;
    status?: RollbackStatus;
    reason?: string;
    note?: string;
  },
): Promise<QueryResult<ReleaseRollback>> {
  const secret = rejectSecretText("Reason", input.reason) ?? rejectSecretText("Note", input.note);
  if (secret) return { status: "error", message: secret };
  const status = input.status ?? "AVAILABLE";

  const inserted = await supabase
    .from("release_rollbacks")
    .insert({
      release_id: input.releaseId,
      project_id: input.projectId,
      target_release_id: input.targetReleaseId ?? null,
      target_commit_sha: input.targetCommitSha?.trim() ?? "",
      status,
      reason: input.reason?.trim() ?? "",
      requested_at: status === "REQUESTED" ? now() : null,
      note: input.note?.trim() ?? "",
      source: "founder",
      provenance: "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapRollback(inserted.data) };
}

export async function updateRollback(
  supabase: GhostClient,
  rollbackId: string,
  patch: { status?: RollbackStatus; reason?: string; evidenceRef?: string; note?: string },
): Promise<QueryResult<ReleaseRollback>> {
  const secret =
    rejectSecretText("Reason", patch.reason) ??
    rejectSecretText("Evidence reference", patch.evidenceRef) ??
    rejectSecretText("Note", patch.note);
  if (secret) return { status: "error", message: secret };

  const payload: Database["public"]["Tables"]["release_rollbacks"]["Update"] = { updated_at: now() };
  if (patch.status !== undefined) {
    payload.status = patch.status;
    if (patch.status === "REQUESTED") payload.requested_at = now();
    if (patch.status === "COMPLETED") payload.completed_at = now();
  }
  if (patch.reason !== undefined) payload.reason = patch.reason.trim();
  if (patch.evidenceRef !== undefined) payload.evidence_ref = patch.evidenceRef.trim();
  if (patch.note !== undefined) payload.note = patch.note.trim();
  const updated = await supabase.from("release_rollbacks").update(payload).eq("id", rollbackId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapRollback(updated.data) };
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

export async function loadReleaseBundle(
  supabase: GhostClient,
  release: Release,
): Promise<QueryResult<ReleaseBundle>> {
  const [
    verification,
    environments,
    configRequirements,
    migrations,
    deployments,
    evidence,
    healthChecks,
    manualActions,
    rollbacks,
    history,
    openDecisions,
  ] = await Promise.all([
    supabase.from("verification_programs").select("status").eq("id", release.verificationProgramId).maybeSingle(),
    loadDeploymentEnvironments(supabase, release.projectId),
    loadConfigRequirements(supabase, release.id),
    loadReleaseMigrations(supabase, release.id),
    loadDeployments(supabase, release.id),
    loadDeploymentEvidence(supabase, release.id),
    loadHealthChecks(supabase, release.id),
    loadManualActions(supabase, release.id),
    loadRollbacks(supabase, release.id),
    loadReleaseHistory(supabase, release.id),
    supabase.from("project_decisions").select("id, title, question").eq("project_id", release.projectId).eq("status", "OPEN"),
  ]);

  if (verification.error) return fromError(verification.error);
  for (const result of [
    environments,
    configRequirements,
    migrations,
    deployments,
    evidence,
    healthChecks,
    manualActions,
    rollbacks,
    history,
  ]) {
    if (result.status === "error") return { status: "error", message: result.message };
  }
  if (
    environments.status !== "ok" ||
    configRequirements.status !== "ok" ||
    migrations.status !== "ok" ||
    deployments.status !== "ok" ||
    evidence.status !== "ok" ||
    healthChecks.status !== "ok" ||
    manualActions.status !== "ok" ||
    rollbacks.status !== "ok" ||
    history.status !== "ok"
  ) {
    return { status: "error", message: "Release records could not be loaded." };
  }

  return {
    status: "ok",
    data: {
      release,
      verificationStatus: verification.data?.status ?? null,
      environments: environments.data,
      configRequirements: configRequirements.data,
      migrations: migrations.data,
      deployments: deployments.data,
      evidence: evidence.data,
      healthChecks: healthChecks.data,
      manualActions: manualActions.data,
      rollbacks: rollbacks.data,
      openDecisionCount: openDecisions.error ? 0 : (openDecisions.data?.length ?? 0),
      openDecisions: openDecisions.error
        ? []
        : (openDecisions.data ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            question: row.question,
          })),
      history: history.data,
    },
  };
}
