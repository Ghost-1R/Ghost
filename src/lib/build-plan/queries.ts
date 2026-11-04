import type { GhostClient } from "@/lib/auth/session";
import type { Database } from "@/lib/database.types";
import { loadProductArchitecture, loadProductFeatures, loadProductRequirements } from "@/lib/product-architect/queries";
import { fromError, type QueryResult } from "@/lib/result";
import {
  loadSystemArchitecture,
  loadSystemComponents,
  loadSystemEntities,
  loadSystemInterfaces,
} from "@/lib/system-architecture/queries";
import type { ConfigClassification } from "@/lib/system-architecture/types";
import {
  asStringList,
  type ArchitectureLinkKind,
  type BuildConfigRequirement,
  type BuildManualAction,
  type BuildPhase,
  type BuildPlan,
  type BuildPlanBundle,
  type BuildPlanRisk,
  type BuildPlanStatus,
  type BuildPlanTransition,
  type BuildRiskSeverity,
  type DependencyEdgeKind,
  type ManualActionStatus,
  type PathCertainty,
  type VerificationKind,
  type WorkPackage,
  type WorkPackageArchitectureLink,
  type WorkPackageDependency,
  type WorkPackageFeatureLink,
  type WorkPackagePriority,
  type WorkPackageRequirementLink,
  type WorkPackageStatus,
  type WorkPackageVerification,
} from "./types";
import { isV8ManualStatus, isV8PackageStatus, nextHumanId } from "./workflow";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

function isMissing(message: string, table: string): boolean {
  return new RegExp(`${table}|does not exist|schema cache`, "i").test(message);
}

const now = () => new Date().toISOString();

function mapPlan(row: Row<"build_plans">): BuildPlan {
  return {
    id: row.id,
    projectId: row.project_id,
    productArchitectureId: row.product_architecture_id,
    systemArchitectureId: row.system_architecture_id,
    summary: row.summary,
    deploymentSequence: asStringList(row.deployment_sequence),
    rollbackSummary: row.rollback_summary,
    status: row.status,
    note: row.note,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadBuildPlan(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<BuildPlan | null>> {
  const result = await supabase.from("build_plans").select("*").eq("project_id", projectId).maybeSingle();
  if (result.error) {
    if (isMissing(result.error.message, "build_plans")) return { status: "ok", data: null };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data ? mapPlan(result.data) : null };
}

export async function ensureBuildPlan(
  supabase: GhostClient,
  input: {
    projectId: string;
    productArchitectureId: string;
    systemArchitectureId: string;
    summary?: string;
  },
): Promise<QueryResult<BuildPlan>> {
  const existing = await loadBuildPlan(supabase, input.projectId);
  if (existing.status === "error") return existing;
  if (existing.data) return { status: "ok", data: existing.data };

  const inserted = await supabase
    .from("build_plans")
    .insert({
      project_id: input.projectId,
      product_architecture_id: input.productArchitectureId,
      system_architecture_id: input.systemArchitectureId,
      summary: input.summary ?? "",
      status: "DRAFT",
      note: "Initialized from an ARCHITECTURE_READY System Architecture. Planning only; nothing is implemented or deployed.",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);

  await supabase.from("build_plan_transitions").insert({
    plan_id: inserted.data.id,
    from_status: null,
    to_status: "DRAFT",
    changed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    actor: "FOUNDER",
    reason: "Build Plan created for project.",
  });

  return { status: "ok", data: mapPlan(inserted.data) };
}

export async function updateBuildPlanOverview(
  supabase: GhostClient,
  planId: string,
  patch: Partial<Pick<BuildPlan, "summary" | "deploymentSequence" | "rollbackSummary" | "note">>,
): Promise<QueryResult<BuildPlan>> {
  const payload: Database["public"]["Tables"]["build_plans"]["Update"] = { updated_at: now() };
  if (patch.summary !== undefined) payload.summary = patch.summary;
  if (patch.deploymentSequence !== undefined) payload.deployment_sequence = patch.deploymentSequence;
  if (patch.rollbackSummary !== undefined) payload.rollback_summary = patch.rollbackSummary;
  if (patch.note !== undefined) payload.note = patch.note;
  const updated = await supabase.from("build_plans").update(payload).eq("id", planId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapPlan(updated.data) };
}

export async function recordBuildPlanTransition(
  supabase: GhostClient,
  planId: string,
  toStatus: BuildPlanStatus,
  reason: string,
): Promise<QueryResult<BuildPlanTransition>> {
  const result = await supabase.rpc("record_build_plan_transition", {
    target_plan_id: planId,
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
      planId: row.plan_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      actor: row.actor,
      reason: row.reason,
    },
  };
}

export async function loadBuildPlanHistory(
  supabase: GhostClient,
  planId: string,
): Promise<QueryResult<BuildPlanTransition[]>> {
  const result = await supabase
    .from("build_plan_transitions")
    .select("*")
    .eq("plan_id", planId)
    .order("changed_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "build_plan_transitions")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      actor: row.actor,
      reason: row.reason,
    })),
  };
}

function mapPhase(row: Row<"build_phases">): BuildPhase {
  return {
    id: row.id,
    planId: row.plan_id,
    projectId: row.project_id,
    humanId: row.human_id,
    name: row.name,
    objective: row.objective,
    position: row.position,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadBuildPhases(
  supabase: GhostClient,
  planId: string,
): Promise<QueryResult<BuildPhase[]>> {
  const result = await supabase
    .from("build_phases")
    .select("*")
    .eq("plan_id", planId)
    .order("position", { ascending: true })
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "build_phases")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapPhase) };
}

export async function createBuildPhase(
  supabase: GhostClient,
  input: { planId: string; projectId: string; name: string; objective?: string; note?: string; position?: number },
): Promise<QueryResult<BuildPhase>> {
  const existing = await loadBuildPhases(supabase, input.planId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("build_phases")
    .insert({
      plan_id: input.planId,
      project_id: input.projectId,
      human_id: nextHumanId(
        "PHASE",
        existing.data.map((row) => row.humanId),
      ),
      name: input.name.trim(),
      objective: input.objective?.trim() ?? "",
      note: input.note?.trim() ?? "",
      position: input.position ?? existing.data.length,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapPhase(inserted.data) };
}

export async function updateBuildPhase(
  supabase: GhostClient,
  phaseId: string,
  patch: Partial<Pick<BuildPhase, "name" | "objective" | "note" | "position">>,
): Promise<QueryResult<BuildPhase>> {
  const payload: Database["public"]["Tables"]["build_phases"]["Update"] = { updated_at: now() };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.objective !== undefined) payload.objective = patch.objective;
  if (patch.note !== undefined) payload.note = patch.note;
  if (patch.position !== undefined) payload.position = patch.position;
  const updated = await supabase.from("build_phases").update(payload).eq("id", phaseId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapPhase(updated.data) };
}

function mapPackage(row: Row<"work_packages">): WorkPackage {
  return {
    id: row.id,
    planId: row.plan_id,
    projectId: row.project_id,
    phaseId: row.phase_id,
    humanId: row.human_id,
    title: row.title,
    objective: row.objective,
    description: row.description,
    status: row.status,
    priority: row.priority,
    likelyCodeAreas: asStringList(row.likely_code_areas),
    pathCertainty: row.path_certainty,
    databaseImpact: row.database_impact,
    integrationImpact: row.integration_impact,
    securityImpact: row.security_impact,
    definitionOfDone: asStringList(row.definition_of_done),
    acceptanceCriteria: asStringList(row.acceptance_criteria),
    rollbackConsideration: row.rollback_consideration,
    irreversible: row.irreversible,
    riskNote: row.risk_note,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadWorkPackages(
  supabase: GhostClient,
  planId: string,
): Promise<QueryResult<WorkPackage[]>> {
  const result = await supabase
    .from("work_packages")
    .select("*")
    .eq("plan_id", planId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "work_packages")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapPackage) };
}

export async function createWorkPackage(
  supabase: GhostClient,
  input: {
    planId: string;
    projectId: string;
    phaseId?: string | null;
    title: string;
    objective?: string;
    description?: string;
    status?: WorkPackageStatus;
    priority?: WorkPackagePriority;
    likelyCodeAreas?: string[];
    pathCertainty?: PathCertainty;
    databaseImpact?: string;
    integrationImpact?: string;
    securityImpact?: string;
    definitionOfDone?: string[];
    acceptanceCriteria?: string[];
    rollbackConsideration?: string;
    irreversible?: boolean;
    riskNote?: string;
  },
): Promise<QueryResult<WorkPackage>> {
  const status = input.status ?? "PLANNED";
  if (!isV8PackageStatus(status)) {
    return { status: "error", message: `V8 Build Plan cannot set work package status ${status}. Use PLANNED, READY, or BLOCKED.` };
  }
  const existing = await loadWorkPackages(supabase, input.planId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("work_packages")
    .insert({
      plan_id: input.planId,
      project_id: input.projectId,
      phase_id: input.phaseId ?? null,
      human_id: nextHumanId(
        "WP",
        existing.data.map((row) => row.humanId),
      ),
      title: input.title.trim(),
      objective: input.objective?.trim() ?? "",
      description: input.description?.trim() ?? "",
      status,
      priority: input.priority ?? "MEDIUM",
      likely_code_areas: input.likelyCodeAreas ?? [],
      path_certainty: input.pathCertainty ?? "UNKNOWN",
      database_impact: input.databaseImpact?.trim() ?? "",
      integration_impact: input.integrationImpact?.trim() ?? "",
      security_impact: input.securityImpact?.trim() ?? "",
      definition_of_done: input.definitionOfDone ?? [],
      acceptance_criteria: input.acceptanceCriteria ?? [],
      rollback_consideration: input.rollbackConsideration?.trim() ?? "",
      irreversible: input.irreversible ?? false,
      risk_note: input.riskNote?.trim() ?? "",
      source: "founder",
      provenance: "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapPackage(inserted.data) };
}

export async function updateWorkPackage(
  supabase: GhostClient,
  packageId: string,
  patch: Partial<{
    phaseId: string | null;
    title: string;
    objective: string;
    description: string;
    status: WorkPackageStatus;
    priority: WorkPackagePriority;
    likelyCodeAreas: string[];
    pathCertainty: PathCertainty;
    databaseImpact: string;
    integrationImpact: string;
    securityImpact: string;
    definitionOfDone: string[];
    acceptanceCriteria: string[];
    rollbackConsideration: string;
    irreversible: boolean;
    riskNote: string;
  }>,
): Promise<QueryResult<WorkPackage>> {
  if (patch.status !== undefined && !isV8PackageStatus(patch.status)) {
    return { status: "error", message: `V8 Build Plan cannot set work package status ${patch.status}. Use PLANNED, READY, or BLOCKED.` };
  }
  const payload: Database["public"]["Tables"]["work_packages"]["Update"] = { updated_at: now() };
  if (patch.phaseId !== undefined) payload.phase_id = patch.phaseId;
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.objective !== undefined) payload.objective = patch.objective;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.likelyCodeAreas !== undefined) payload.likely_code_areas = patch.likelyCodeAreas;
  if (patch.pathCertainty !== undefined) payload.path_certainty = patch.pathCertainty;
  if (patch.databaseImpact !== undefined) payload.database_impact = patch.databaseImpact;
  if (patch.integrationImpact !== undefined) payload.integration_impact = patch.integrationImpact;
  if (patch.securityImpact !== undefined) payload.security_impact = patch.securityImpact;
  if (patch.definitionOfDone !== undefined) payload.definition_of_done = patch.definitionOfDone;
  if (patch.acceptanceCriteria !== undefined) payload.acceptance_criteria = patch.acceptanceCriteria;
  if (patch.rollbackConsideration !== undefined) payload.rollback_consideration = patch.rollbackConsideration;
  if (patch.irreversible !== undefined) payload.irreversible = patch.irreversible;
  if (patch.riskNote !== undefined) payload.risk_note = patch.riskNote;
  const updated = await supabase.from("work_packages").update(payload).eq("id", packageId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapPackage(updated.data) };
}

function mapDependency(row: Row<"work_package_dependencies">): WorkPackageDependency {
  return {
    id: row.id,
    planId: row.plan_id,
    projectId: row.project_id,
    fromPackageId: row.from_package_id,
    toPackageId: row.to_package_id,
    edgeKind: row.edge_kind,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function loadWorkPackageDependencies(
  supabase: GhostClient,
  planId: string,
): Promise<QueryResult<WorkPackageDependency[]>> {
  const result = await supabase.from("work_package_dependencies").select("*").eq("plan_id", planId);
  if (result.error) {
    if (isMissing(result.error.message, "work_package_dependencies")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapDependency) };
}

export async function createWorkPackageDependency(
  supabase: GhostClient,
  input: {
    planId: string;
    projectId: string;
    fromPackageId: string;
    toPackageId: string;
    edgeKind?: DependencyEdgeKind;
    note?: string;
  },
): Promise<QueryResult<WorkPackageDependency>> {
  if (input.fromPackageId === input.toPackageId) {
    return { status: "error", message: "A work package cannot depend on itself." };
  }
  const inserted = await supabase
    .from("work_package_dependencies")
    .insert({
      plan_id: input.planId,
      project_id: input.projectId,
      from_package_id: input.fromPackageId,
      to_package_id: input.toPackageId,
      edge_kind: input.edgeKind ?? "DEPENDS_ON",
      note: input.note?.trim() ?? "",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapDependency(inserted.data) };
}

export async function deleteWorkPackageDependency(
  supabase: GhostClient,
  dependencyId: string,
): Promise<QueryResult<{ id: string }>> {
  const deleted = await supabase.from("work_package_dependencies").delete().eq("id", dependencyId).select("id").single();
  if (deleted.error) return fromError(deleted.error);
  return { status: "ok", data: { id: deleted.data.id } };
}

export async function loadRequirementLinks(
  supabase: GhostClient,
  packageIds: string[],
): Promise<QueryResult<WorkPackageRequirementLink[]>> {
  if (packageIds.length === 0) return { status: "ok", data: [] };
  const result = await supabase.from("work_package_requirement_links").select("*").in("work_package_id", packageIds);
  if (result.error) {
    if (isMissing(result.error.message, "work_package_requirement_links")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      workPackageId: row.work_package_id,
      requirementId: row.requirement_id,
      createdAt: row.created_at,
    })),
  };
}

export async function linkRequirement(
  supabase: GhostClient,
  workPackageId: string,
  requirementId: string,
): Promise<QueryResult<WorkPackageRequirementLink>> {
  const inserted = await supabase
    .from("work_package_requirement_links")
    .upsert({ work_package_id: workPackageId, requirement_id: requirementId }, { onConflict: "work_package_id,requirement_id" })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return {
    status: "ok",
    data: {
      workPackageId: inserted.data.work_package_id,
      requirementId: inserted.data.requirement_id,
      createdAt: inserted.data.created_at,
    },
  };
}

export async function unlinkRequirement(
  supabase: GhostClient,
  workPackageId: string,
  requirementId: string,
): Promise<QueryResult<{ ok: true }>> {
  const deleted = await supabase
    .from("work_package_requirement_links")
    .delete()
    .eq("work_package_id", workPackageId)
    .eq("requirement_id", requirementId);
  if (deleted.error) return fromError(deleted.error);
  return { status: "ok", data: { ok: true } };
}

export async function loadFeatureLinks(
  supabase: GhostClient,
  packageIds: string[],
): Promise<QueryResult<WorkPackageFeatureLink[]>> {
  if (packageIds.length === 0) return { status: "ok", data: [] };
  const result = await supabase.from("work_package_feature_links").select("*").in("work_package_id", packageIds);
  if (result.error) {
    if (isMissing(result.error.message, "work_package_feature_links")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      workPackageId: row.work_package_id,
      featureId: row.feature_id,
      createdAt: row.created_at,
    })),
  };
}

export async function linkFeature(
  supabase: GhostClient,
  workPackageId: string,
  featureId: string,
): Promise<QueryResult<WorkPackageFeatureLink>> {
  const inserted = await supabase
    .from("work_package_feature_links")
    .upsert({ work_package_id: workPackageId, feature_id: featureId }, { onConflict: "work_package_id,feature_id" })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return {
    status: "ok",
    data: {
      workPackageId: inserted.data.work_package_id,
      featureId: inserted.data.feature_id,
      createdAt: inserted.data.created_at,
    },
  };
}

export async function unlinkFeature(
  supabase: GhostClient,
  workPackageId: string,
  featureId: string,
): Promise<QueryResult<{ ok: true }>> {
  const deleted = await supabase
    .from("work_package_feature_links")
    .delete()
    .eq("work_package_id", workPackageId)
    .eq("feature_id", featureId);
  if (deleted.error) return fromError(deleted.error);
  return { status: "ok", data: { ok: true } };
}

function mapArchLink(row: Row<"work_package_architecture_links">): WorkPackageArchitectureLink {
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    planId: row.plan_id,
    projectId: row.project_id,
    linkKind: row.link_kind,
    recordRef: row.record_ref,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function loadArchitectureLinks(
  supabase: GhostClient,
  planId: string,
): Promise<QueryResult<WorkPackageArchitectureLink[]>> {
  const result = await supabase.from("work_package_architecture_links").select("*").eq("plan_id", planId);
  if (result.error) {
    if (isMissing(result.error.message, "work_package_architecture_links")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapArchLink) };
}

export async function linkArchitecture(
  supabase: GhostClient,
  input: {
    workPackageId: string;
    planId: string;
    projectId: string;
    linkKind: ArchitectureLinkKind;
    recordRef: string;
    note?: string;
  },
): Promise<QueryResult<WorkPackageArchitectureLink>> {
  const inserted = await supabase
    .from("work_package_architecture_links")
    .insert({
      work_package_id: input.workPackageId,
      plan_id: input.planId,
      project_id: input.projectId,
      link_kind: input.linkKind,
      record_ref: input.recordRef.trim(),
      note: input.note?.trim() ?? "",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapArchLink(inserted.data) };
}

export async function unlinkArchitecture(
  supabase: GhostClient,
  linkId: string,
): Promise<QueryResult<{ id: string }>> {
  const deleted = await supabase.from("work_package_architecture_links").delete().eq("id", linkId).select("id").single();
  if (deleted.error) return fromError(deleted.error);
  return { status: "ok", data: { id: deleted.data.id } };
}

function mapVerification(row: Row<"work_package_verifications">): WorkPackageVerification {
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    planId: row.plan_id,
    projectId: row.project_id,
    kind: row.kind,
    description: row.description,
    observableSignal: row.observable_signal,
    position: row.position,
    createdAt: row.created_at,
  };
}

export async function loadVerifications(
  supabase: GhostClient,
  planId: string,
): Promise<QueryResult<WorkPackageVerification[]>> {
  const result = await supabase
    .from("work_package_verifications")
    .select("*")
    .eq("plan_id", planId)
    .order("position", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "work_package_verifications")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapVerification) };
}

export async function createVerification(
  supabase: GhostClient,
  input: {
    workPackageId: string;
    planId: string;
    projectId: string;
    kind: VerificationKind;
    description: string;
    observableSignal?: string;
    position?: number;
  },
): Promise<QueryResult<WorkPackageVerification>> {
  const inserted = await supabase
    .from("work_package_verifications")
    .insert({
      work_package_id: input.workPackageId,
      plan_id: input.planId,
      project_id: input.projectId,
      kind: input.kind,
      description: input.description.trim(),
      observable_signal: input.observableSignal?.trim() ?? "",
      position: input.position ?? 0,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapVerification(inserted.data) };
}

export async function updateVerification(
  supabase: GhostClient,
  verificationId: string,
  patch: Partial<{ kind: VerificationKind; description: string; observableSignal: string; position: number }>,
): Promise<QueryResult<WorkPackageVerification>> {
  const payload: Database["public"]["Tables"]["work_package_verifications"]["Update"] = {};
  if (patch.kind !== undefined) payload.kind = patch.kind;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.observableSignal !== undefined) payload.observable_signal = patch.observableSignal;
  if (patch.position !== undefined) payload.position = patch.position;
  const updated = await supabase
    .from("work_package_verifications")
    .update(payload)
    .eq("id", verificationId)
    .select("*")
    .single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapVerification(updated.data) };
}

function mapManual(row: Row<"build_manual_actions">): BuildManualAction {
  return {
    id: row.id,
    planId: row.plan_id,
    projectId: row.project_id,
    workPackageId: row.work_package_id,
    humanId: row.human_id,
    title: row.title,
    description: row.description,
    status: row.status,
    evidenceNote: row.evidence_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadManualActions(
  supabase: GhostClient,
  planId: string,
): Promise<QueryResult<BuildManualAction[]>> {
  const result = await supabase
    .from("build_manual_actions")
    .select("*")
    .eq("plan_id", planId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "build_manual_actions")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapManual) };
}

export async function createManualAction(
  supabase: GhostClient,
  input: {
    planId: string;
    projectId: string;
    workPackageId?: string | null;
    title: string;
    description?: string;
    status?: ManualActionStatus;
  },
): Promise<QueryResult<BuildManualAction>> {
  const status = input.status ?? "REQUIRED";
  if (!isV8ManualStatus(status)) {
    return { status: "error", message: "V8 Build Plan cannot mark manual actions DONE. Use REQUIRED, NOT_REQUIRED, or PENDING." };
  }
  const existing = await loadManualActions(supabase, input.planId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("build_manual_actions")
    .insert({
      plan_id: input.planId,
      project_id: input.projectId,
      work_package_id: input.workPackageId ?? null,
      human_id: nextHumanId(
        "MAN",
        existing.data.map((row) => row.humanId),
      ),
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      status,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapManual(inserted.data) };
}

export async function updateManualAction(
  supabase: GhostClient,
  actionId: string,
  patch: Partial<{
    workPackageId: string | null;
    title: string;
    description: string;
    status: ManualActionStatus;
    evidenceNote: string;
  }>,
): Promise<QueryResult<BuildManualAction>> {
  if (patch.status !== undefined && !isV8ManualStatus(patch.status)) {
    return { status: "error", message: "V8 Build Plan cannot mark manual actions DONE. Use REQUIRED, NOT_REQUIRED, or PENDING." };
  }
  const payload: Database["public"]["Tables"]["build_manual_actions"]["Update"] = { updated_at: now() };
  if (patch.workPackageId !== undefined) payload.work_package_id = patch.workPackageId;
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.evidenceNote !== undefined) payload.evidence_note = patch.evidenceNote;
  const updated = await supabase.from("build_manual_actions").update(payload).eq("id", actionId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapManual(updated.data) };
}

function mapConfig(row: Row<"build_config_requirements">): BuildConfigRequirement {
  return {
    id: row.id,
    planId: row.plan_id,
    projectId: row.project_id,
    workPackageId: row.work_package_id,
    variableName: row.variable_name,
    purpose: row.purpose,
    environment: row.environment,
    classification: row.classification,
    founderActionRequired: row.founder_action_required,
    createdAt: row.created_at,
  };
}

export async function loadConfigRequirements(
  supabase: GhostClient,
  planId: string,
): Promise<QueryResult<BuildConfigRequirement[]>> {
  const result = await supabase.from("build_config_requirements").select("*").eq("plan_id", planId);
  if (result.error) {
    if (isMissing(result.error.message, "build_config_requirements")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapConfig) };
}

export async function createConfigRequirement(
  supabase: GhostClient,
  input: {
    planId: string;
    projectId: string;
    workPackageId?: string | null;
    variableName: string;
    purpose?: string;
    environment?: string;
    classification?: ConfigClassification;
    founderActionRequired?: boolean;
  },
): Promise<QueryResult<BuildConfigRequirement>> {
  const inserted = await supabase
    .from("build_config_requirements")
    .insert({
      plan_id: input.planId,
      project_id: input.projectId,
      work_package_id: input.workPackageId ?? null,
      variable_name: input.variableName.trim(),
      purpose: input.purpose?.trim() ?? "",
      environment: input.environment?.trim() || "production",
      classification: input.classification ?? "SERVER_SECRET",
      founder_action_required: input.founderActionRequired ?? true,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapConfig(inserted.data) };
}

export async function updateConfigRequirement(
  supabase: GhostClient,
  configId: string,
  patch: Partial<{
    workPackageId: string | null;
    purpose: string;
    environment: string;
    classification: ConfigClassification;
    founderActionRequired: boolean;
  }>,
): Promise<QueryResult<BuildConfigRequirement>> {
  const payload: Database["public"]["Tables"]["build_config_requirements"]["Update"] = {};
  if (patch.workPackageId !== undefined) payload.work_package_id = patch.workPackageId;
  if (patch.purpose !== undefined) payload.purpose = patch.purpose;
  if (patch.environment !== undefined) payload.environment = patch.environment;
  if (patch.classification !== undefined) payload.classification = patch.classification;
  if (patch.founderActionRequired !== undefined) payload.founder_action_required = patch.founderActionRequired;
  const updated = await supabase.from("build_config_requirements").update(payload).eq("id", configId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapConfig(updated.data) };
}

function mapRisk(row: Row<"build_plan_risks">): BuildPlanRisk {
  return {
    id: row.id,
    planId: row.plan_id,
    projectId: row.project_id,
    workPackageId: row.work_package_id,
    humanId: row.human_id,
    description: row.description,
    severity: row.severity,
    mitigation: row.mitigation,
    createdAt: row.created_at,
  };
}

export async function loadBuildRisks(
  supabase: GhostClient,
  planId: string,
): Promise<QueryResult<BuildPlanRisk[]>> {
  const result = await supabase
    .from("build_plan_risks")
    .select("*")
    .eq("plan_id", planId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "build_plan_risks")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapRisk) };
}

export async function createBuildRisk(
  supabase: GhostClient,
  input: {
    planId: string;
    projectId: string;
    workPackageId?: string | null;
    description: string;
    severity?: BuildRiskSeverity;
    mitigation?: string;
  },
): Promise<QueryResult<BuildPlanRisk>> {
  const existing = await loadBuildRisks(supabase, input.planId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("build_plan_risks")
    .insert({
      plan_id: input.planId,
      project_id: input.projectId,
      work_package_id: input.workPackageId ?? null,
      human_id: nextHumanId(
        "BRISK",
        existing.data.map((row) => row.humanId),
      ),
      description: input.description.trim(),
      severity: input.severity ?? "MEDIUM",
      mitigation: input.mitigation?.trim() ?? "",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapRisk(inserted.data) };
}

export async function updateBuildRisk(
  supabase: GhostClient,
  riskId: string,
  patch: Partial<{
    workPackageId: string | null;
    description: string;
    severity: BuildRiskSeverity;
    mitigation: string;
  }>,
): Promise<QueryResult<BuildPlanRisk>> {
  const payload: Database["public"]["Tables"]["build_plan_risks"]["Update"] = {};
  if (patch.workPackageId !== undefined) payload.work_package_id = patch.workPackageId;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.severity !== undefined) payload.severity = patch.severity;
  if (patch.mitigation !== undefined) payload.mitigation = patch.mitigation;
  const updated = await supabase.from("build_plan_risks").update(payload).eq("id", riskId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapRisk(updated.data) };
}

/** Loads every record the page, readiness gate, and Ask Ghost context depend on. */
export async function loadBuildPlanBundle(
  supabase: GhostClient,
  plan: BuildPlan,
): Promise<QueryResult<BuildPlanBundle>> {
  const [
    phases,
    packages,
    dependencies,
    architectureLinks,
    verifications,
    manualActions,
    configRequirements,
    risks,
    requirements,
    features,
    product,
    system,
    components,
    entities,
    interfaces,
    openDecisions,
  ] = await Promise.all([
    loadBuildPhases(supabase, plan.id),
    loadWorkPackages(supabase, plan.id),
    loadWorkPackageDependencies(supabase, plan.id),
    loadArchitectureLinks(supabase, plan.id),
    loadVerifications(supabase, plan.id),
    loadManualActions(supabase, plan.id),
    loadConfigRequirements(supabase, plan.id),
    loadBuildRisks(supabase, plan.id),
    loadProductRequirements(supabase, plan.productArchitectureId),
    loadProductFeatures(supabase, plan.productArchitectureId),
    loadProductArchitecture(supabase, plan.projectId),
    loadSystemArchitecture(supabase, plan.projectId),
    loadSystemComponents(supabase, plan.systemArchitectureId),
    loadSystemEntities(supabase, plan.systemArchitectureId),
    loadSystemInterfaces(supabase, plan.systemArchitectureId),
    supabase.from("project_decisions").select("id").eq("project_id", plan.projectId).eq("status", "OPEN"),
  ]);

  for (const result of [
    phases,
    packages,
    dependencies,
    architectureLinks,
    verifications,
    manualActions,
    configRequirements,
    risks,
    requirements,
    features,
    product,
    system,
    components,
    entities,
    interfaces,
  ]) {
    if (result.status === "error") return { status: "error", message: result.message };
  }
  if (
    phases.status !== "ok" ||
    packages.status !== "ok" ||
    dependencies.status !== "ok" ||
    architectureLinks.status !== "ok" ||
    verifications.status !== "ok" ||
    manualActions.status !== "ok" ||
    configRequirements.status !== "ok" ||
    risks.status !== "ok" ||
    requirements.status !== "ok" ||
    features.status !== "ok" ||
    product.status !== "ok" ||
    system.status !== "ok" ||
    components.status !== "ok" ||
    entities.status !== "ok" ||
    interfaces.status !== "ok"
  ) {
    return { status: "error", message: "Build plan records could not be loaded." };
  }

  const requirementLinks = await loadRequirementLinks(
    supabase,
    packages.data.map((row) => row.id),
  );
  const featureLinks = await loadFeatureLinks(
    supabase,
    packages.data.map((row) => row.id),
  );
  if (requirementLinks.status === "error") return requirementLinks;
  if (featureLinks.status === "error") return featureLinks;

  return {
    status: "ok",
    data: {
      plan,
      phases: phases.data,
      packages: packages.data,
      dependencies: dependencies.data,
      requirementLinks: requirementLinks.data,
      featureLinks: featureLinks.data,
      architectureLinks: architectureLinks.data,
      verifications: verifications.data,
      manualActions: manualActions.data,
      configRequirements: configRequirements.data,
      risks: risks.data,
      requirements: requirements.data,
      features: features.data,
      architectureRecords: [
        ...components.data.map((row) => ({
          humanId: row.humanId,
          name: row.name,
          kind: "COMPONENT" as const,
          status: row.status,
        })),
        ...entities.data.map((row) => ({
          humanId: row.humanId,
          name: row.name,
          kind: "ENTITY" as const,
          status: row.status,
        })),
        ...interfaces.data.map((row) => ({
          humanId: row.humanId,
          name: row.name,
          kind: "INTERFACE" as const,
          status: row.status,
        })),
      ],
      productStatus: product.data?.status ?? null,
      systemStatus: system.data?.status ?? null,
      openDecisionCount: openDecisions.data?.length ?? 0,
    },
  };
}
