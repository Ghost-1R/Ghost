import type { GhostClient } from "@/lib/auth/session";
import type { Database } from "@/lib/database.types";
import {
  loadBuildPlan,
  loadWorkPackageDependencies,
  loadWorkPackages,
} from "@/lib/build-plan/queries";
import type { BuildPlanStatus } from "@/lib/build-plan/types";
import { loadProductArchitecture, loadProductFeatures, loadProductRequirements } from "@/lib/product-architect/queries";
import { fromError, type QueryResult } from "@/lib/result";
import { loadSystemArchitecture } from "@/lib/system-architecture/queries";
import type {
  BuildExecution,
  BuildExecutionBundle,
  BuildExecutionStatus,
  BuildExecutionTransition,
  ExecutionBlocker,
  ExecutionBlockerStatus,
  ImplementationEvidence,
  ImplementationEvidenceKind,
  PackageExecutionStatus,
  UpstreamArtifactKind,
  UpstreamChange,
  UpstreamChangeStatus,
  WorkPackageExecution,
} from "./types";
import { canTransitionPackageExecution, rejectSecretEvidenceReference, refreshDerivedPackageStatuses } from "./workflow";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

function isMissing(message: string, table: string): boolean {
  return new RegExp(`${table}|does not exist|schema cache`, "i").test(message);
}

const now = () => new Date().toISOString();

function mapExecution(row: Row<"build_executions">): BuildExecution {
  return {
    id: row.id,
    projectId: row.project_id,
    buildPlanId: row.build_plan_id,
    productArchitectureId: row.product_architecture_id,
    systemArchitectureId: row.system_architecture_id,
    summary: row.summary,
    status: row.status,
    note: row.note,
    implementedAt: row.implemented_at,
    implementedBy: row.implemented_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPackageExecution(row: Row<"work_package_executions">): WorkPackageExecution {
  return {
    id: row.id,
    executionId: row.execution_id,
    projectId: row.project_id,
    workPackageId: row.work_package_id,
    status: row.status,
    implementationNotes: row.implementation_notes,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    startedBy: row.started_by,
    completedBy: row.completed_by,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvidence(row: Row<"implementation_evidence">): ImplementationEvidence {
  return {
    id: row.id,
    packageExecutionId: row.package_execution_id,
    executionId: row.execution_id,
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

function mapBlocker(row: Row<"execution_blockers">): ExecutionBlocker {
  return {
    id: row.id,
    packageExecutionId: row.package_execution_id,
    executionId: row.execution_id,
    projectId: row.project_id,
    description: row.description,
    status: row.status,
    resolution: row.resolution,
    createdAt: row.created_at,
    createdBy: row.created_by,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    source: row.source,
    provenance: row.provenance,
  };
}

function mapUpstream(row: Row<"execution_upstream_changes">): UpstreamChange {
  return {
    id: row.id,
    executionId: row.execution_id,
    projectId: row.project_id,
    packageExecutionId: row.package_execution_id,
    artifactKind: row.artifact_kind,
    artifactRef: row.artifact_ref,
    issue: row.issue,
    status: row.status,
    decisionId: row.decision_id,
    resolution: row.resolution,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    source: row.source,
    provenance: row.provenance,
  };
}

export async function loadBuildExecution(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<BuildExecution | null>> {
  const result = await supabase.from("build_executions").select("*").eq("project_id", projectId).maybeSingle();
  if (result.error) {
    if (isMissing(result.error.message, "build_executions")) return { status: "ok", data: null };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data ? mapExecution(result.data) : null };
}

export async function ensureBuildExecution(
  supabase: GhostClient,
  input: {
    projectId: string;
    buildPlanId: string;
    productArchitectureId: string;
    systemArchitectureId: string;
    summary?: string;
  },
): Promise<QueryResult<BuildExecution>> {
  const existing = await loadBuildExecution(supabase, input.projectId);
  if (existing.status === "error") return existing;
  if (existing.data) return { status: "ok", data: existing.data };

  const inserted = await supabase
    .from("build_executions")
    .insert({
      project_id: input.projectId,
      build_plan_id: input.buildPlanId,
      product_architecture_id: input.productArchitectureId,
      system_architecture_id: input.systemArchitectureId,
      summary: input.summary ?? "",
      status: "NOT_STARTED",
      note: "Initialized from a BUILD_PLAN_READY Build Plan. Implementation evidence only — not verified or deployed.",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);

  await supabase.from("build_execution_transitions").insert({
    execution_id: inserted.data.id,
    from_status: null,
    to_status: "NOT_STARTED",
    changed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    actor: "FOUNDER",
    reason: "Build Execution created for project.",
  });

  return { status: "ok", data: mapExecution(inserted.data) };
}

export async function updateBuildExecutionOverview(
  supabase: GhostClient,
  executionId: string,
  patch: Partial<Pick<BuildExecution, "summary" | "note">>,
): Promise<QueryResult<BuildExecution>> {
  const payload: Database["public"]["Tables"]["build_executions"]["Update"] = { updated_at: now() };
  if (patch.summary !== undefined) payload.summary = patch.summary;
  if (patch.note !== undefined) payload.note = patch.note;
  const updated = await supabase.from("build_executions").update(payload).eq("id", executionId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapExecution(updated.data) };
}

export async function recordBuildExecutionTransition(
  supabase: GhostClient,
  executionId: string,
  toStatus: BuildExecutionStatus,
  reason: string,
): Promise<QueryResult<BuildExecutionTransition>> {
  const result = await supabase.rpc("record_build_execution_transition", {
    target_execution_id: executionId,
    next_status: toStatus,
    transition_reason: reason,
    transition_actor: "FOUNDER",
  });
  if (result.error) return fromError(result.error);
  const row = result.data;
  return {
    status: "ok",
    data: {
      id: row.id,
      executionId: row.execution_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      actor: row.actor,
      reason: row.reason,
    },
  };
}

export async function loadBuildExecutionHistory(
  supabase: GhostClient,
  executionId: string,
): Promise<QueryResult<BuildExecutionTransition[]>> {
  const result = await supabase
    .from("build_execution_transitions")
    .select("*")
    .eq("execution_id", executionId)
    .order("changed_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "build_execution_transitions")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      executionId: row.execution_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      actor: row.actor,
      reason: row.reason,
    })),
  };
}

export async function loadPackageExecutions(
  supabase: GhostClient,
  executionId: string,
): Promise<QueryResult<WorkPackageExecution[]>> {
  const result = await supabase
    .from("work_package_executions")
    .select("*")
    .eq("execution_id", executionId)
    .order("created_at", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "work_package_executions")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapPackageExecution) };
}

export async function createPackageExecution(
  supabase: GhostClient,
  input: {
    executionId: string;
    projectId: string;
    workPackageId: string;
    status?: PackageExecutionStatus;
  },
): Promise<QueryResult<WorkPackageExecution>> {
  const inserted = await supabase
    .from("work_package_executions")
    .insert({
      execution_id: input.executionId,
      project_id: input.projectId,
      work_package_id: input.workPackageId,
      status: input.status ?? "QUEUED",
      source: "founder",
      provenance: "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapPackageExecution(inserted.data) };
}

export async function updatePackageExecution(
  supabase: GhostClient,
  packageExecutionId: string,
  patch: Partial<{
    status: PackageExecutionStatus;
    implementationNotes: string;
    startedAt: string | null;
    completedAt: string | null;
    startedBy: string | null;
    completedBy: string | null;
  }>,
  options?: { evidenceCount?: number; openBlockerCount?: number; reopenReason?: string },
): Promise<QueryResult<WorkPackageExecution>> {
  if (patch.status !== undefined) {
    const current = await supabase
      .from("work_package_executions")
      .select("*")
      .eq("id", packageExecutionId)
      .single();
    if (current.error) return fromError(current.error);
    const from = current.data.status as PackageExecutionStatus;
    if (!canTransitionPackageExecution(from, patch.status)) {
      return { status: "error", message: `Cannot move package execution from ${from} to ${patch.status}.` };
    }
    if (from === "IMPLEMENTED" && patch.status === "IN_PROGRESS" && !options?.reopenReason?.trim()) {
      return { status: "error", message: "Reopening an IMPLEMENTED package requires a reason." };
    }
    if (patch.status === "IMPLEMENTED") {
      const evidenceCount =
        options?.evidenceCount ??
        (
          await supabase
            .from("implementation_evidence")
            .select("id", { count: "exact", head: true })
            .eq("package_execution_id", packageExecutionId)
        ).count ??
        0;
      if (evidenceCount < 1) {
        return {
          status: "error",
          message: "Marking a package IMPLEMENTED requires at least one implementation evidence row.",
        };
      }
      const openBlockers =
        options?.openBlockerCount ??
        (
          await supabase
            .from("execution_blockers")
            .select("id", { count: "exact", head: true })
            .eq("package_execution_id", packageExecutionId)
            .eq("status", "OPEN")
        ).count ??
        0;
      if (openBlockers > 0) {
        return { status: "error", message: "Open blockers prevent marking a package IMPLEMENTED." };
      }
    }
  }

  const payload: Database["public"]["Tables"]["work_package_executions"]["Update"] = { updated_at: now() };
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.implementationNotes !== undefined) payload.implementation_notes = patch.implementationNotes;
  if (patch.startedAt !== undefined) payload.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt;
  if (patch.startedBy !== undefined) payload.started_by = patch.startedBy;
  if (patch.completedBy !== undefined) payload.completed_by = patch.completedBy;

  const updated = await supabase
    .from("work_package_executions")
    .update(payload)
    .eq("id", packageExecutionId)
    .select("*")
    .single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapPackageExecution(updated.data) };
}

export async function loadEvidence(
  supabase: GhostClient,
  executionId: string,
): Promise<QueryResult<ImplementationEvidence[]>> {
  const result = await supabase
    .from("implementation_evidence")
    .select("*")
    .eq("execution_id", executionId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "implementation_evidence")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapEvidence) };
}

export async function addEvidence(
  supabase: GhostClient,
  input: {
    packageExecutionId: string;
    executionId: string;
    projectId: string;
    kind: ImplementationEvidenceKind;
    reference: string;
    summary?: string;
  },
): Promise<QueryResult<ImplementationEvidence>> {
  const secretCheck = rejectSecretEvidenceReference(input.reference);
  if (!secretCheck.ok) return { status: "error", message: secretCheck.reason ?? "Invalid evidence reference." };

  const inserted = await supabase
    .from("implementation_evidence")
    .insert({
      package_execution_id: input.packageExecutionId,
      execution_id: input.executionId,
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

export async function loadBlockers(
  supabase: GhostClient,
  executionId: string,
): Promise<QueryResult<ExecutionBlocker[]>> {
  const result = await supabase
    .from("execution_blockers")
    .select("*")
    .eq("execution_id", executionId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "execution_blockers")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapBlocker) };
}

export async function createBlocker(
  supabase: GhostClient,
  input: {
    packageExecutionId: string;
    executionId: string;
    projectId: string;
    description: string;
  },
): Promise<QueryResult<ExecutionBlocker>> {
  const inserted = await supabase
    .from("execution_blockers")
    .insert({
      package_execution_id: input.packageExecutionId,
      execution_id: input.executionId,
      project_id: input.projectId,
      description: input.description.trim(),
      status: "OPEN",
      source: "founder",
      provenance: "founder",
      created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapBlocker(inserted.data) };
}

export async function resolveBlocker(
  supabase: GhostClient,
  blockerId: string,
  resolution: string,
): Promise<QueryResult<ExecutionBlocker>> {
  const updated = await supabase
    .from("execution_blockers")
    .update({
      status: "RESOLVED" satisfies ExecutionBlockerStatus,
      resolution: resolution.trim(),
      resolved_at: now(),
      resolved_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .eq("id", blockerId)
    .select("*")
    .single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapBlocker(updated.data) };
}

export async function loadUpstreamChanges(
  supabase: GhostClient,
  executionId: string,
): Promise<QueryResult<UpstreamChange[]>> {
  const result = await supabase
    .from("execution_upstream_changes")
    .select("*")
    .eq("execution_id", executionId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "execution_upstream_changes")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapUpstream) };
}

export async function createUpstreamChange(
  supabase: GhostClient,
  input: {
    executionId: string;
    projectId: string;
    packageExecutionId?: string | null;
    artifactKind: UpstreamArtifactKind;
    artifactRef?: string;
    issue: string;
  },
): Promise<QueryResult<UpstreamChange>> {
  const inserted = await supabase
    .from("execution_upstream_changes")
    .insert({
      execution_id: input.executionId,
      project_id: input.projectId,
      package_execution_id: input.packageExecutionId ?? null,
      artifact_kind: input.artifactKind,
      artifact_ref: input.artifactRef?.trim() ?? "",
      issue: input.issue.trim(),
      status: "OPEN",
      source: "founder",
      provenance: "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapUpstream(inserted.data) };
}

export async function resolveUpstreamChange(
  supabase: GhostClient,
  changeId: string,
  resolution: string,
  status: UpstreamChangeStatus = "RESOLVED",
): Promise<QueryResult<UpstreamChange>> {
  const updated = await supabase
    .from("execution_upstream_changes")
    .update({
      status,
      resolution: resolution.trim(),
      resolved_at: now(),
    })
    .eq("id", changeId)
    .select("*")
    .single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapUpstream(updated.data) };
}

/**
 * Loads V8 deps + open blockers/upstream and applies QUEUED↔READY suggestions.
 * Never auto-marks IMPLEMENTED.
 */
export async function recomputeAndApplyPackageReadiness(
  supabase: GhostClient,
  execution: BuildExecution,
): Promise<QueryResult<WorkPackageExecution[]>> {
  const plan = await loadBuildPlan(supabase, execution.projectId);
  if (plan.status === "error") return plan;
  if (!plan.data) return { status: "error", message: "Build Plan is missing for readiness recompute." };

  const [packages, packageExecutions, blockers, upstream] = await Promise.all([
    loadWorkPackages(supabase, plan.data.id),
    loadPackageExecutions(supabase, execution.id),
    loadBlockers(supabase, execution.id),
    loadUpstreamChanges(supabase, execution.id),
  ]);
  for (const result of [packages, packageExecutions, blockers, upstream]) {
    if (result.status === "error") return { status: "error", message: result.message };
  }
  if (
    packages.status !== "ok" ||
    packageExecutions.status !== "ok" ||
    blockers.status !== "ok" ||
    upstream.status !== "ok"
  ) {
    return { status: "error", message: "Could not load records for readiness recompute." };
  }

  const deps = await loadWorkPackageDependencies(supabase, plan.data.id);
  if (deps.status === "error") return deps;

  const suggested = refreshDerivedPackageStatuses(
    packageExecutions.data,
    deps.data,
    blockers.data,
    upstream.data,
  );

  for (const [id, status] of suggested) {
    const updated = await supabase
      .from("work_package_executions")
      .update({ status, updated_at: now() })
      .eq("id", id)
      .select("*")
      .single();
    if (updated.error) return fromError(updated.error);
  }

  return loadPackageExecutions(supabase, execution.id);
}

export async function loadBuildExecutionBundle(
  supabase: GhostClient,
  execution: BuildExecution,
): Promise<QueryResult<BuildExecutionBundle>> {
  const plan = await loadBuildPlan(supabase, execution.projectId);
  if (plan.status === "error") return plan;

  const planId = plan.data?.id ?? execution.buildPlanId;
  const productId = execution.productArchitectureId;

  const [
    packages,
    packageExecutions,
    dependencies,
    evidence,
    blockers,
    upstreamChanges,
    requirements,
    features,
    product,
    system,
    openDecisions,
  ] = await Promise.all([
    plan.data ? loadWorkPackages(supabase, planId) : Promise.resolve({ status: "ok" as const, data: [] }),
    loadPackageExecutions(supabase, execution.id),
    plan.data
      ? loadWorkPackageDependencies(supabase, planId)
      : Promise.resolve({ status: "ok" as const, data: [] }),
    loadEvidence(supabase, execution.id),
    loadBlockers(supabase, execution.id),
    loadUpstreamChanges(supabase, execution.id),
    loadProductRequirements(supabase, productId),
    loadProductFeatures(supabase, productId),
    loadProductArchitecture(supabase, execution.projectId),
    loadSystemArchitecture(supabase, execution.projectId),
    supabase
      .from("project_decisions")
      .select("id, title, question")
      .eq("project_id", execution.projectId)
      .eq("status", "OPEN"),
  ]);

  for (const result of [
    packages,
    packageExecutions,
    dependencies,
    evidence,
    blockers,
    upstreamChanges,
    requirements,
    features,
    product,
    system,
  ]) {
    if (result.status === "error") return { status: "error", message: result.message };
  }
  if (
    packages.status !== "ok" ||
    packageExecutions.status !== "ok" ||
    dependencies.status !== "ok" ||
    evidence.status !== "ok" ||
    blockers.status !== "ok" ||
    upstreamChanges.status !== "ok" ||
    requirements.status !== "ok" ||
    features.status !== "ok"
  ) {
    return { status: "error", message: "Build execution records could not be loaded." };
  }

  let requirementLinks: BuildExecutionBundle["requirementLinks"] = [];
  let featureLinks: BuildExecutionBundle["featureLinks"] = [];
  if (packages.data.length > 0) {
    const packageIds = packages.data.map((row) => row.id);
    const [reqLinks, featLinks] = await Promise.all([
      supabase.from("work_package_requirement_links").select("*").in("work_package_id", packageIds),
      supabase.from("work_package_feature_links").select("*").in("work_package_id", packageIds),
    ]);
    if (reqLinks.error && !isMissing(reqLinks.error.message, "work_package_requirement_links")) {
      return fromError(reqLinks.error);
    }
    if (featLinks.error && !isMissing(featLinks.error.message, "work_package_feature_links")) {
      return fromError(featLinks.error);
    }
    requirementLinks = (reqLinks.data ?? []).map((row) => ({
      workPackageId: row.work_package_id,
      requirementId: row.requirement_id,
      createdAt: row.created_at,
    }));
    featureLinks = (featLinks.data ?? []).map((row) => ({
      workPackageId: row.work_package_id,
      featureId: row.feature_id,
      createdAt: row.created_at,
    }));
  }

  return {
    status: "ok",
    data: {
      execution,
      planStatus: (plan.data?.status ?? null) as BuildPlanStatus | null,
      plan: plan.data,
      packages: packages.data,
      packageExecutions: packageExecutions.data,
      dependencies: dependencies.data,
      requirementLinks,
      featureLinks,
      evidence: evidence.data,
      blockers: blockers.data,
      upstreamChanges: upstreamChanges.data,
      requirements: requirements.data,
      features: features.data,
      openDecisionCount: openDecisions.data?.length ?? 0,
      openDecisions: (openDecisions.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        question: row.question,
      })),
    },
  };
}
