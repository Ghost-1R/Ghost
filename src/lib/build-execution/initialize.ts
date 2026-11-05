import type { GhostClient } from "@/lib/auth/session";
import { loadBuildPlan, loadWorkPackages } from "@/lib/build-plan/queries";
import { createNextAction } from "@/lib/operations/actions";
import { loadProductArchitecture } from "@/lib/product-architect/queries";
import { fromError, type QueryResult } from "@/lib/result";
import { loadSystemArchitecture } from "@/lib/system-architecture/queries";
import {
  createPackageExecution,
  ensureBuildExecution,
  loadBuildExecution,
  loadPackageExecutions,
  recomputeAndApplyPackageReadiness,
} from "./queries";
import type { BuildExecution } from "./types";

/**
 * Initialize Build Execution from a BUILD_PLAN_READY Build Plan.
 * Seeds package executions as QUEUED, then recomputes READY for unmet-deps-free packages.
 * Does not invent evidence. Implementation ≠ verification ≠ deployment.
 */
export async function initializeBuildExecutionFromProject(
  supabase: GhostClient,
  input: { projectId: string; seedNextAction?: boolean },
): Promise<QueryResult<BuildExecution>> {
  const existing = await loadBuildExecution(supabase, input.projectId);
  if (existing.status === "error") return existing;
  if (existing.data) return { status: "ok", data: existing.data };

  const plan = await loadBuildPlan(supabase, input.projectId);
  if (plan.status === "error") return plan;
  if (!plan.data) {
    return {
      status: "error",
      message: "Initialize Build Plan first. Build Execution needs a BUILD_PLAN_READY plan.",
    };
  }
  if (plan.data.status !== "BUILD_PLAN_READY") {
    return {
      status: "error",
      message: `Build Plan is ${plan.data.status}. It must be BUILD_PLAN_READY before Build Execution can start.`,
    };
  }

  const product = await loadProductArchitecture(supabase, input.projectId);
  if (product.status === "error") return product;
  if (!product.data) {
    return { status: "error", message: "Product Architecture is missing. Build Execution needs product provenance." };
  }

  const system = await loadSystemArchitecture(supabase, input.projectId);
  if (system.status === "error") return system;
  if (!system.data) {
    return { status: "error", message: "System Architecture is missing. Build Execution needs system provenance." };
  }

  const created = await ensureBuildExecution(supabase, {
    projectId: input.projectId,
    buildPlanId: plan.data.id,
    productArchitectureId: product.data.id,
    systemArchitectureId: system.data.id,
    summary: plan.data.summary,
  });
  if (created.status === "error") return created;

  const packages = await loadWorkPackages(supabase, plan.data.id);
  if (packages.status === "error") return packages;

  const existingExecutions = await loadPackageExecutions(supabase, created.data.id);
  if (existingExecutions.status === "error") return existingExecutions;
  const seededIds = new Set(existingExecutions.data.map((row) => row.workPackageId));

  for (const pkg of packages.data) {
    if (seededIds.has(pkg.id)) continue;
    const seeded = await createPackageExecution(supabase, {
      executionId: created.data.id,
      projectId: input.projectId,
      workPackageId: pkg.id,
      status: "QUEUED",
    });
    if (seeded.status === "error") return seeded;
  }

  const readiness = await recomputeAndApplyPackageReadiness(supabase, created.data);
  if (readiness.status === "error") return readiness;

  const knowledge = await supabase.from("project_knowledge").insert({
    project_id: input.projectId,
    kind: "FACT",
    title: "Build Execution initialized",
    content: [
      `Build execution ${created.data.id}`,
      `Build plan provenance: ${plan.data.id} (${plan.data.status})`,
      `Product architecture provenance: ${product.data.id} (${product.data.status})`,
      `System architecture provenance: ${system.data.id} (${system.data.status})`,
      `Seeded ${packages.data.length} work package execution(s) as QUEUED; readiness recomputed to READY where deps allow.`,
      "No implementation evidence was invented. IMPLEMENTED ≠ VERIFIED ≠ DEPLOYED.",
    ].join("\n"),
    source: `build_executions:${created.data.id}`,
  });
  if (knowledge.error) return fromError(knowledge.error);

  if (input.seedNextAction !== false) {
    await createNextAction(supabase, {
      projectId: input.projectId,
      title: "Begin next ready work package",
      description:
        "Start a READY work package. Record implementation evidence before marking IMPLEMENTED. Implementation is not verification or deployment.",
      provenance: "FOUNDER_APPROVED_ACTION",
      sourceKind: "build_execution",
      sourceRef: created.data.id,
      priority: "HIGH",
    });
  }

  return created;
}
