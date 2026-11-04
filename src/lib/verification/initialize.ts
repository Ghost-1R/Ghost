import type { GhostClient } from "@/lib/auth/session";
import { loadBuildExecution, loadPackageExecutions } from "@/lib/build-execution/queries";
import { loadBuildPlan, loadVerifications } from "@/lib/build-plan/queries";
import { createNextAction } from "@/lib/operations/actions";
import { loadProductArchitecture } from "@/lib/product-architect/queries";
import { fromError, type QueryResult } from "@/lib/result";
import { loadSystemArchitecture } from "@/lib/system-architecture/queries";
import {
  createVerificationCase,
  ensureVerificationProgram,
  loadVerificationCases,
  loadVerificationProgram,
} from "./queries";
import type { VerificationProgram } from "./types";
import { mapPlanVerificationKind } from "./workflow";

/**
 * Initialize Verification from an IMPLEMENTED Build Execution.
 * Seeds cases from plan work_package_verifications. Does not invent pass evidence.
 * VERIFIED ≠ DEPLOYED. IMPLEMENTED ≠ VERIFIED.
 */
export async function initializeVerificationFromProject(
  supabase: GhostClient,
  input: { projectId: string; seedNextAction?: boolean },
): Promise<QueryResult<VerificationProgram>> {
  const existing = await loadVerificationProgram(supabase, input.projectId);
  if (existing.status === "error") return existing;
  if (existing.data) return { status: "ok", data: existing.data };

  const execution = await loadBuildExecution(supabase, input.projectId);
  if (execution.status === "error") return execution;
  if (!execution.data) {
    return {
      status: "error",
      message: "Initialize Build Execution first. Verification needs an IMPLEMENTED execution.",
    };
  }
  if (execution.data.status !== "IMPLEMENTED") {
    return {
      status: "error",
      message: `Build Execution is ${execution.data.status}. It must be IMPLEMENTED before Verification can start.`,
    };
  }

  const plan = await loadBuildPlan(supabase, input.projectId);
  if (plan.status === "error") return plan;
  if (!plan.data) {
    return { status: "error", message: "Build Plan is missing. Verification needs plan provenance." };
  }

  const product = await loadProductArchitecture(supabase, input.projectId);
  if (product.status === "error") return product;
  if (!product.data) {
    return { status: "error", message: "Product Architecture is missing. Verification needs product provenance." };
  }

  const system = await loadSystemArchitecture(supabase, input.projectId);
  if (system.status === "error") return system;
  if (!system.data) {
    return { status: "error", message: "System Architecture is missing. Verification needs system provenance." };
  }

  const created = await ensureVerificationProgram(supabase, {
    projectId: input.projectId,
    buildExecutionId: execution.data.id,
    buildPlanId: plan.data.id,
    productArchitectureId: product.data.id,
    systemArchitectureId: system.data.id,
    summary: execution.data.summary || plan.data.summary,
  });
  if (created.status === "error") return created;

  const [planVerifications, packageExecutions, existingCases] = await Promise.all([
    loadVerifications(supabase, plan.data.id),
    loadPackageExecutions(supabase, execution.data.id),
    loadVerificationCases(supabase, created.data.id),
  ]);
  if (planVerifications.status === "error") return planVerifications;
  if (packageExecutions.status === "error") return packageExecutions;
  if (existingCases.status === "error") return existingCases;

  const packageExecByWp = new Map(packageExecutions.data.map((row) => [row.workPackageId, row]));
  const seededPlanIds = new Set(
    existingCases.data.map((row) => row.planVerificationId).filter((id): id is string => Boolean(id)),
  );

  const packageIds = [...new Set(planVerifications.data.map((row) => row.workPackageId))];
  const requirementByWp = new Map<string, string>();
  const featureByWp = new Map<string, string>();
  if (packageIds.length > 0) {
    const [reqLinks, featLinks] = await Promise.all([
      supabase.from("work_package_requirement_links").select("*").in("work_package_id", packageIds),
      supabase.from("work_package_feature_links").select("*").in("work_package_id", packageIds),
    ]);
    if (!reqLinks.error) {
      for (const row of reqLinks.data ?? []) {
        if (!requirementByWp.has(row.work_package_id)) {
          requirementByWp.set(row.work_package_id, row.requirement_id);
        }
      }
    }
    if (!featLinks.error) {
      for (const row of featLinks.data ?? []) {
        if (!featureByWp.has(row.work_package_id)) {
          featureByWp.set(row.work_package_id, row.feature_id);
        }
      }
    }
  }

  let seeded = 0;
  for (const planVerification of planVerifications.data) {
    if (seededPlanIds.has(planVerification.id)) continue;
    const caseKind = mapPlanVerificationKind(planVerification.kind);
    const packageExecution = packageExecByWp.get(planVerification.workPackageId);
    const seededCase = await createVerificationCase(supabase, {
      programId: created.data.id,
      projectId: input.projectId,
      title: planVerification.description.slice(0, 200) || `${planVerification.kind} verification`,
      purpose: planVerification.observableSignal || planVerification.description,
      caseKind,
      isAutomated: caseKind === "AUTOMATED" || caseKind === "DATABASE_RLS" || caseKind === "SECURITY",
      isRequired: true,
      isRegression: caseKind === "REGRESSION" || planVerification.kind === "BUILD",
      status: "READY",
      expectedResult: planVerification.observableSignal,
      workPackageId: planVerification.workPackageId,
      packageExecutionId: packageExecution?.id ?? null,
      planVerificationId: planVerification.id,
      requirementId: requirementByWp.get(planVerification.workPackageId) ?? null,
      featureId: featureByWp.get(planVerification.workPackageId) ?? null,
    });
    if (seededCase.status === "error") return seededCase;
    seeded += 1;
  }

  const knowledge = await supabase.from("project_knowledge").insert({
    project_id: input.projectId,
    kind: "FACT",
    title: "Verification program initialized",
    content: [
      `Verification program ${created.data.id}`,
      `Build execution provenance: ${execution.data.id} (${execution.data.status})`,
      `Build plan provenance: ${plan.data.id} (${plan.data.status})`,
      `Product architecture provenance: ${product.data.id} (${product.data.status})`,
      `System architecture provenance: ${system.data.id} (${system.data.status})`,
      `Seeded ${seeded} verification case(s) as READY from plan verifications.`,
      "No pass evidence was invented. VERIFIED ≠ DEPLOYED. IMPLEMENTED ≠ VERIFIED.",
    ].join("\n"),
    source: `verification_programs:${created.data.id}`,
  });
  if (knowledge.error) return fromError(knowledge.error);

  if (input.seedNextAction !== false) {
    await createNextAction(supabase, {
      projectId: input.projectId,
      title: "Run next required verification case",
      description:
        "Start a READY verification case. Record evidence before marking PASSED. VERIFIED is not deployed.",
      provenance: "FOUNDER_APPROVED_ACTION",
      sourceKind: "verification",
      sourceRef: created.data.id,
      priority: "HIGH",
    });
  }

  return created;
}
