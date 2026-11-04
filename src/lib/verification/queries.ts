import type { GhostClient } from "@/lib/auth/session";
import type { Database } from "@/lib/database.types";
import { loadBuildExecution, loadPackageExecutions, createUpstreamChange } from "@/lib/build-execution/queries";
import { loadBuildPlan, loadWorkPackages } from "@/lib/build-plan/queries";
import { loadProductFeatures, loadProductRequirements } from "@/lib/product-architect/queries";
import { fromError, type QueryResult } from "@/lib/result";
import type {
  RetestEvent,
  VerificationBundle,
  VerificationCase,
  VerificationCaseKind,
  VerificationCaseStatus,
  VerificationDefect,
  VerificationDefectSeverity,
  VerificationDefectStatus,
  VerificationEvidence,
  VerificationEvidenceKind,
  VerificationProgram,
  VerificationProgramStatus,
  VerificationProgramTransition,
} from "./types";
import {
  canTransitionCase,
  nextHumanId,
  rejectSecretEvidenceReference,
} from "./workflow";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

function isMissing(message: string, table: string): boolean {
  return new RegExp(`${table}|does not exist|schema cache`, "i").test(message);
}

const now = () => new Date().toISOString();

function mapProgram(row: Row<"verification_programs">): VerificationProgram {
  return {
    id: row.id,
    projectId: row.project_id,
    buildExecutionId: row.build_execution_id,
    buildPlanId: row.build_plan_id,
    productArchitectureId: row.product_architecture_id,
    systemArchitectureId: row.system_architecture_id,
    summary: row.summary,
    status: row.status,
    note: row.note,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCase(row: Row<"verification_cases">): VerificationCase {
  return {
    id: row.id,
    programId: row.program_id,
    projectId: row.project_id,
    humanId: row.human_id,
    title: row.title,
    purpose: row.purpose,
    caseKind: row.case_kind,
    isAutomated: row.is_automated,
    isRequired: row.is_required,
    isRegression: row.is_regression,
    status: row.status,
    preconditions: row.preconditions,
    expectedResult: row.expected_result,
    actualResult: row.actual_result,
    workPackageId: row.work_package_id,
    packageExecutionId: row.package_execution_id,
    planVerificationId: row.plan_verification_id,
    requirementId: row.requirement_id,
    featureId: row.feature_id,
    source: row.source,
    provenance: row.provenance,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvidence(row: Row<"verification_evidence">): VerificationEvidence {
  return {
    id: row.id,
    caseId: row.case_id,
    programId: row.program_id,
    projectId: row.project_id,
    kind: row.kind,
    reference: row.reference,
    summary: row.summary,
    isAutomated: row.is_automated,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mapDefect(row: Row<"verification_defects">): VerificationDefect {
  return {
    id: row.id,
    programId: row.program_id,
    projectId: row.project_id,
    caseId: row.case_id,
    humanId: row.human_id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    blocking: row.blocking,
    status: row.status,
    resolution: row.resolution,
    packageExecutionId: row.package_execution_id,
    requirementId: row.requirement_id,
    featureId: row.feature_id,
    retestCaseId: row.retest_case_id,
    discoveredAt: row.discovered_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRetest(row: Row<"verification_retest_events">): RetestEvent {
  return {
    id: row.id,
    defectId: row.defect_id,
    programId: row.program_id,
    projectId: row.project_id,
    caseId: row.case_id,
    resultStatus: row.result_status,
    evidenceId: row.evidence_id,
    note: row.note,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function loadVerificationProgram(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<VerificationProgram | null>> {
  const result = await supabase.from("verification_programs").select("*").eq("project_id", projectId).maybeSingle();
  if (result.error) {
    if (isMissing(result.error.message, "verification_programs")) return { status: "ok", data: null };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data ? mapProgram(result.data) : null };
}

export async function ensureVerificationProgram(
  supabase: GhostClient,
  input: {
    projectId: string;
    buildExecutionId: string;
    buildPlanId: string;
    productArchitectureId: string;
    systemArchitectureId: string;
    summary?: string;
  },
): Promise<QueryResult<VerificationProgram>> {
  const existing = await loadVerificationProgram(supabase, input.projectId);
  if (existing.status === "error") return existing;
  if (existing.data) return { status: "ok", data: existing.data };

  const inserted = await supabase
    .from("verification_programs")
    .insert({
      project_id: input.projectId,
      build_execution_id: input.buildExecutionId,
      build_plan_id: input.buildPlanId,
      product_architecture_id: input.productArchitectureId,
      system_architecture_id: input.systemArchitectureId,
      summary: input.summary ?? "",
      status: "NOT_STARTED",
      note: "Initialized from an IMPLEMENTED Build Execution. VERIFIED ≠ DEPLOYED.",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);

  await supabase.from("verification_program_transitions").insert({
    program_id: inserted.data.id,
    from_status: null,
    to_status: "NOT_STARTED",
    changed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    actor: "FOUNDER",
    reason: "Verification program created for project.",
  });

  return { status: "ok", data: mapProgram(inserted.data) };
}

export async function updateVerificationProgramOverview(
  supabase: GhostClient,
  programId: string,
  patch: Partial<Pick<VerificationProgram, "summary" | "note">>,
): Promise<QueryResult<VerificationProgram>> {
  const payload: Database["public"]["Tables"]["verification_programs"]["Update"] = { updated_at: now() };
  if (patch.summary !== undefined) payload.summary = patch.summary;
  if (patch.note !== undefined) payload.note = patch.note;
  const updated = await supabase.from("verification_programs").update(payload).eq("id", programId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapProgram(updated.data) };
}

export async function recordVerificationProgramTransition(
  supabase: GhostClient,
  programId: string,
  toStatus: VerificationProgramStatus,
  reason: string,
): Promise<QueryResult<VerificationProgramTransition>> {
  const result = await supabase.rpc("record_verification_program_transition", {
    target_program_id: programId,
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
      programId: row.program_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      actor: row.actor,
      reason: row.reason,
    },
  };
}

export async function loadVerificationHistory(
  supabase: GhostClient,
  programId: string,
): Promise<QueryResult<VerificationProgramTransition[]>> {
  const result = await supabase
    .from("verification_program_transitions")
    .select("*")
    .eq("program_id", programId)
    .order("changed_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "verification_program_transitions")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      programId: row.program_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      actor: row.actor,
      reason: row.reason,
    })),
  };
}

export async function loadVerificationCases(
  supabase: GhostClient,
  programId: string,
): Promise<QueryResult<VerificationCase[]>> {
  const result = await supabase
    .from("verification_cases")
    .select("*")
    .eq("program_id", programId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "verification_cases")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapCase) };
}

export async function createVerificationCase(
  supabase: GhostClient,
  input: {
    programId: string;
    projectId: string;
    title: string;
    purpose?: string;
    caseKind: VerificationCaseKind;
    isAutomated?: boolean;
    isRequired?: boolean;
    isRegression?: boolean;
    status?: VerificationCaseStatus;
    preconditions?: string;
    expectedResult?: string;
    workPackageId?: string | null;
    packageExecutionId?: string | null;
    planVerificationId?: string | null;
    requirementId?: string | null;
    featureId?: string | null;
  },
): Promise<QueryResult<VerificationCase>> {
  const existing = await loadVerificationCases(supabase, input.programId);
  if (existing.status === "error") return existing;
  const humanId = nextHumanId(
    "TC",
    existing.data.map((row) => row.humanId),
  );

  const inserted = await supabase
    .from("verification_cases")
    .insert({
      program_id: input.programId,
      project_id: input.projectId,
      human_id: humanId,
      title: input.title.trim(),
      purpose: input.purpose?.trim() ?? "",
      case_kind: input.caseKind,
      is_automated: input.isAutomated ?? false,
      is_required: input.isRequired ?? true,
      is_regression: input.isRegression ?? false,
      status: input.status ?? "PLANNED",
      preconditions: input.preconditions?.trim() ?? "",
      expected_result: input.expectedResult?.trim() ?? "",
      work_package_id: input.workPackageId ?? null,
      package_execution_id: input.packageExecutionId ?? null,
      plan_verification_id: input.planVerificationId ?? null,
      requirement_id: input.requirementId ?? null,
      feature_id: input.featureId ?? null,
      source: "founder",
      provenance: "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapCase(inserted.data) };
}

export async function updateVerificationCase(
  supabase: GhostClient,
  caseId: string,
  patch: Partial<{
    status: VerificationCaseStatus;
    purpose: string;
    preconditions: string;
    expectedResult: string;
    actualResult: string;
    startedAt: string | null;
    completedAt: string | null;
  }>,
  options?: { evidenceCount?: number },
): Promise<QueryResult<VerificationCase>> {
  if (patch.status !== undefined) {
    const current = await supabase.from("verification_cases").select("*").eq("id", caseId).single();
    if (current.error) return fromError(current.error);
    const from = current.data.status as VerificationCaseStatus;
    if (!canTransitionCase(from, patch.status)) {
      return { status: "error", message: `Cannot move verification case from ${from} to ${patch.status}.` };
    }
    if (patch.status === "PASSED") {
      const evidenceCount =
        options?.evidenceCount ??
        (
          await supabase
            .from("verification_evidence")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId)
        ).count ??
        0;
      if (evidenceCount < 1) {
        return {
          status: "error",
          message: "Marking a case PASSED requires at least one verification evidence row.",
        };
      }
    }
  }

  const payload: Database["public"]["Tables"]["verification_cases"]["Update"] = { updated_at: now() };
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.purpose !== undefined) payload.purpose = patch.purpose;
  if (patch.preconditions !== undefined) payload.preconditions = patch.preconditions;
  if (patch.expectedResult !== undefined) payload.expected_result = patch.expectedResult;
  if (patch.actualResult !== undefined) payload.actual_result = patch.actualResult;
  if (patch.startedAt !== undefined) payload.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt;

  const updated = await supabase.from("verification_cases").update(payload).eq("id", caseId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapCase(updated.data) };
}

export async function loadVerificationEvidence(
  supabase: GhostClient,
  programId: string,
): Promise<QueryResult<VerificationEvidence[]>> {
  const result = await supabase
    .from("verification_evidence")
    .select("*")
    .eq("program_id", programId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "verification_evidence")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapEvidence) };
}

export async function addVerificationEvidence(
  supabase: GhostClient,
  input: {
    caseId: string;
    programId: string;
    projectId: string;
    kind: VerificationEvidenceKind;
    reference: string;
    summary?: string;
    isAutomated?: boolean;
  },
): Promise<QueryResult<VerificationEvidence>> {
  const secretCheck = rejectSecretEvidenceReference(input.reference);
  if (!secretCheck.ok) return { status: "error", message: secretCheck.reason ?? "Invalid evidence reference." };

  const inserted = await supabase
    .from("verification_evidence")
    .insert({
      case_id: input.caseId,
      program_id: input.programId,
      project_id: input.projectId,
      kind: input.kind,
      reference: input.reference.trim(),
      summary: input.summary?.trim() ?? "",
      is_automated: input.isAutomated ?? false,
      source: "founder",
      provenance: "founder",
      created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapEvidence(inserted.data) };
}

export async function loadVerificationDefects(
  supabase: GhostClient,
  programId: string,
): Promise<QueryResult<VerificationDefect[]>> {
  const result = await supabase
    .from("verification_defects")
    .select("*")
    .eq("program_id", programId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "verification_defects")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapDefect) };
}

export async function createVerificationDefect(
  supabase: GhostClient,
  input: {
    programId: string;
    projectId: string;
    caseId: string;
    title: string;
    description?: string;
    severity?: VerificationDefectSeverity;
    blocking?: boolean;
    packageExecutionId?: string | null;
    requirementId?: string | null;
    featureId?: string | null;
    createUpstreamChange?: boolean;
    buildExecutionId?: string;
  },
): Promise<QueryResult<VerificationDefect>> {
  const existing = await loadVerificationDefects(supabase, input.programId);
  if (existing.status === "error") return existing;
  const humanId = nextHumanId(
    "DEF",
    existing.data.map((row) => row.humanId),
  );
  const severity = input.severity ?? "HIGH";
  const blocking =
    severity === "CRITICAL" || severity === "HIGH" ? true : Boolean(input.blocking);

  const inserted = await supabase
    .from("verification_defects")
    .insert({
      program_id: input.programId,
      project_id: input.projectId,
      case_id: input.caseId,
      human_id: humanId,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      severity,
      blocking,
      status: "OPEN",
      package_execution_id: input.packageExecutionId ?? null,
      requirement_id: input.requirementId ?? null,
      feature_id: input.featureId ?? null,
      source: "founder",
      provenance: "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);

  if (input.createUpstreamChange && input.buildExecutionId) {
    await createUpstreamChange(supabase, {
      executionId: input.buildExecutionId,
      projectId: input.projectId,
      packageExecutionId: input.packageExecutionId ?? null,
      artifactKind: "OTHER",
      artifactRef: humanId,
      issue: `Verification defect ${humanId}: ${input.title.trim()}. Implementation correction may be required.`,
    });
  }

  return { status: "ok", data: mapDefect(inserted.data) };
}

export async function resolveVerificationDefect(
  supabase: GhostClient,
  defectId: string,
  resolution: string,
): Promise<QueryResult<VerificationDefect>> {
  const updated = await supabase
    .from("verification_defects")
    .update({
      status: "RETEST_REQUIRED" satisfies VerificationDefectStatus,
      resolution: resolution.trim(),
      resolved_at: now(),
      updated_at: now(),
    })
    .eq("id", defectId)
    .select("*")
    .single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapDefect(updated.data) };
}

export async function loadRetestEvents(
  supabase: GhostClient,
  programId: string,
): Promise<QueryResult<RetestEvent[]>> {
  const result = await supabase
    .from("verification_retest_events")
    .select("*")
    .eq("program_id", programId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "verification_retest_events")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapRetest) };
}

export async function recordRetestEvent(
  supabase: GhostClient,
  input: {
    defectId: string;
    programId: string;
    projectId: string;
    caseId: string;
    resultStatus: VerificationCaseStatus;
    evidenceId?: string | null;
    note?: string;
  },
): Promise<QueryResult<RetestEvent>> {
  if (input.resultStatus !== "PASSED" && input.resultStatus !== "FAILED" && input.resultStatus !== "BLOCKED") {
    return { status: "error", message: "Retest result must be PASSED, FAILED, or BLOCKED." };
  }

  const inserted = await supabase
    .from("verification_retest_events")
    .insert({
      defect_id: input.defectId,
      program_id: input.programId,
      project_id: input.projectId,
      case_id: input.caseId,
      result_status: input.resultStatus,
      evidence_id: input.evidenceId ?? null,
      note: input.note?.trim() ?? "",
      created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);

  if (input.resultStatus === "PASSED") {
    const closed = await supabase
      .from("verification_defects")
      .update({
        status: "CLOSED" satisfies VerificationDefectStatus,
        closed_at: now(),
        updated_at: now(),
        retest_case_id: input.caseId,
      })
      .eq("id", input.defectId)
      .select("*")
      .single();
    if (closed.error) return fromError(closed.error);
  } else if (input.resultStatus === "FAILED") {
    const reopened = await supabase
      .from("verification_defects")
      .update({
        status: "OPEN" satisfies VerificationDefectStatus,
        updated_at: now(),
      })
      .eq("id", input.defectId)
      .select("*")
      .single();
    if (reopened.error) return fromError(reopened.error);
  }

  return { status: "ok", data: mapRetest(inserted.data) };
}

/**
 * Closing a defect requires a PASSED retest event. Prefer recordRetestEvent with PASSED.
 */
export async function closeVerificationDefect(
  supabase: GhostClient,
  defectId: string,
): Promise<QueryResult<VerificationDefect>> {
  const current = await supabase.from("verification_defects").select("*").eq("id", defectId).single();
  if (current.error) return fromError(current.error);

  const retests = await supabase
    .from("verification_retest_events")
    .select("id")
    .eq("defect_id", defectId)
    .eq("result_status", "PASSED")
    .limit(1);
  if (retests.error) return fromError(retests.error);
  if (!retests.data?.length) {
    return {
      status: "error",
      message: "Closing a defect requires a PASSED retest event.",
    };
  }

  const updated = await supabase
    .from("verification_defects")
    .update({
      status: "CLOSED" satisfies VerificationDefectStatus,
      closed_at: now(),
      updated_at: now(),
    })
    .eq("id", defectId)
    .select("*")
    .single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapDefect(updated.data) };
}

export async function loadVerificationBundle(
  supabase: GhostClient,
  program: VerificationProgram,
): Promise<QueryResult<VerificationBundle>> {
  const [execution, plan, cases, evidence, defects, retestEvents, requirements, features, openDecisions] =
    await Promise.all([
      loadBuildExecution(supabase, program.projectId),
      loadBuildPlan(supabase, program.projectId),
      loadVerificationCases(supabase, program.id),
      loadVerificationEvidence(supabase, program.id),
      loadVerificationDefects(supabase, program.id),
      loadRetestEvents(supabase, program.id),
      loadProductRequirements(supabase, program.productArchitectureId),
      loadProductFeatures(supabase, program.productArchitectureId),
      supabase
        .from("project_decisions")
        .select("id, title, question")
        .eq("project_id", program.projectId)
        .eq("status", "OPEN"),
    ]);

  for (const result of [execution, plan, cases, evidence, defects, retestEvents, requirements, features]) {
    if (result.status === "error") return { status: "error", message: result.message };
  }
  if (
    execution.status !== "ok" ||
    plan.status !== "ok" ||
    cases.status !== "ok" ||
    evidence.status !== "ok" ||
    defects.status !== "ok" ||
    retestEvents.status !== "ok" ||
    requirements.status !== "ok" ||
    features.status !== "ok"
  ) {
    return { status: "error", message: "Verification records could not be loaded." };
  }

  let packages: VerificationBundle["packages"] = [];
  let packageExecutions: VerificationBundle["packageExecutions"] = [];
  let requirementLinks: VerificationBundle["requirementLinks"] = [];
  let featureLinks: VerificationBundle["featureLinks"] = [];

  if (plan.data) {
    const pkgs = await loadWorkPackages(supabase, plan.data.id);
    if (pkgs.status === "error") return pkgs;
    packages = pkgs.data;
    if (packages.length > 0) {
      const packageIds = packages.map((row) => row.id);
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
  }

  if (execution.data) {
    const pkgExec = await loadPackageExecutions(supabase, execution.data.id);
    if (pkgExec.status === "error") return pkgExec;
    packageExecutions = pkgExec.data;
  }

  return {
    status: "ok",
    data: {
      program,
      executionStatus: execution.data?.status ?? null,
      plan: plan.data,
      packages,
      packageExecutions,
      requirementLinks,
      featureLinks,
      cases: cases.data,
      evidence: evidence.data,
      defects: defects.data,
      retestEvents: retestEvents.data,
      requirements: requirements.data,
      features: features.data,
      openDecisionCount: openDecisions.error ? 0 : (openDecisions.data?.length ?? 0),
      openDecisions: openDecisions.error
        ? []
        : (openDecisions.data ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            question: row.question,
          })),
    },
  };
}
