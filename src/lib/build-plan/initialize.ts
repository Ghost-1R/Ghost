import type { GhostClient } from "@/lib/auth/session";
import { createNextAction } from "@/lib/operations/actions";
import { loadProductArchitecture } from "@/lib/product-architect/queries";
import { fromError, type QueryResult } from "@/lib/result";
import { loadSystemArchitecture } from "@/lib/system-architecture/queries";
import { ensureBuildPlan, loadBuildPlan } from "./queries";
import type { BuildPlan } from "./types";

/**
 * Initialize Build Plan from an ARCHITECTURE_READY System Architecture.
 * Seeds plan provenance only. Does not invent phases or work packages.
 * Planning only — nothing is implemented or deployed.
 */
export async function initializeBuildPlanFromProject(
  supabase: GhostClient,
  input: { projectId: string; seedNextAction?: boolean },
): Promise<QueryResult<BuildPlan>> {
  const existing = await loadBuildPlan(supabase, input.projectId);
  if (existing.status === "error") return existing;
  if (existing.data) return { status: "ok", data: existing.data };

  const system = await loadSystemArchitecture(supabase, input.projectId);
  if (system.status === "error") return system;
  if (!system.data) {
    return { status: "error", message: "Initialize System Architecture first. Build Plan needs an ARCHITECTURE_READY system design." };
  }
  if (system.data.status !== "ARCHITECTURE_READY") {
    return {
      status: "error",
      message: `System Architecture is ${system.data.status}. It must be ARCHITECTURE_READY before Build Plan can start.`,
    };
  }

  const product = await loadProductArchitecture(supabase, input.projectId);
  if (product.status === "error") return product;
  if (!product.data) {
    return { status: "error", message: "Product Architecture is missing. Build Plan needs product and system provenance." };
  }

  const created = await ensureBuildPlan(supabase, {
    projectId: input.projectId,
    productArchitectureId: product.data.id,
    systemArchitectureId: system.data.id,
  });
  if (created.status === "error") return created;

  const knowledge = await supabase.from("project_knowledge").insert({
    project_id: input.projectId,
    kind: "FACT",
    title: "Build Plan initialized",
    content: [
      `Build plan ${created.data.id}`,
      `Product architecture provenance: ${product.data.id} (${product.data.status})`,
      `System architecture provenance: ${system.data.id} (${system.data.status})`,
      "No phases or work packages were invented. Planning is not implementation or deployment.",
    ].join("\n"),
    source: `build_plans:${created.data.id}`,
  });
  if (knowledge.error) return fromError(knowledge.error);

  if (input.seedNextAction !== false) {
    await createNextAction(supabase, {
      projectId: input.projectId,
      title: "Define build plan phases and work packages",
      description: "Describe phases and work packages. Nothing has been planned for coding yet, let alone built.",
      provenance: "FOUNDER_APPROVED_ACTION",
      sourceKind: "build_plan",
      sourceRef: created.data.id,
      priority: "HIGH",
    });
  }

  return created;
}
