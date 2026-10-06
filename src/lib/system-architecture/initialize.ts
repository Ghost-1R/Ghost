import type { GhostClient } from "@/lib/auth/session";
import { createNextAction } from "@/lib/operations/actions";
import { loadProductArchitecture, loadProductRequirements } from "@/lib/product-architect/queries";
import { fromError, type QueryResult } from "@/lib/result";
import { ensureSystemArchitecture, loadSystemArchitecture } from "./queries";
import type { SystemArchitecture } from "./types";

/**
 * Initialize System Architecture from a BUILD_READY Product Architecture.
 * Seeds NOT_COVERED coverage rows for accepted requirements only. Does not invent components,
 * entities, interfaces, or any design. Design only — nothing is implemented or deployed.
 */
export async function initializeSystemArchitectureFromProject(
  supabase: GhostClient,
  input: { projectId: string; seedNextAction?: boolean },
): Promise<QueryResult<SystemArchitecture>> {
  const existing = await loadSystemArchitecture(supabase, input.projectId);
  if (existing.status === "error") return existing;
  if (existing.data) return { status: "ok", data: existing.data };

  const product = await loadProductArchitecture(supabase, input.projectId);
  if (product.status === "error") return product;
  if (!product.data) {
    return { status: "error", message: "Initialize Product Architect first. System Architecture needs a Product Architecture." };
  }
  if (product.data.status !== "BUILD_READY") {
    return {
      status: "error",
      message: `Product Architecture is ${product.data.status}. It must be BUILD_READY before System Architecture can start.`,
    };
  }

  const created = await ensureSystemArchitecture(supabase, {
    projectId: input.projectId,
    productArchitectureId: product.data.id,
  });
  if (created.status === "error") return created;

  const requirements = await loadProductRequirements(supabase, product.data.id);
  if (requirements.status === "error") return requirements;
  const accepted = requirements.data.filter((row) => row.approvalStatus === "ACCEPTED");
  if (accepted.length) {
    const seeded = await supabase.from("system_requirement_coverage").upsert(
      accepted.map((requirement) => ({
        architecture_id: created.data.id,
        project_id: input.projectId,
        requirement_id: requirement.id,
        coverage: "NOT_COVERED" as const,
        gap_note: "Seeded from an accepted product requirement. Not yet covered by the system design.",
      })),
      { onConflict: "architecture_id,requirement_id", ignoreDuplicates: true },
    );
    if (seeded.error) return fromError(seeded.error);
  }

  const knowledge = await supabase.from("project_knowledge").insert({
    project_id: input.projectId,
    kind: "FACT",
    title: "System Architecture initialized",
    content: [
      `System architecture ${created.data.id}`,
      `Product architecture provenance: ${product.data.id} (${product.data.status})`,
      `Accepted requirements seeded as NOT_COVERED: ${accepted.length}`,
      "No components, entities, or interfaces were invented. Design is not implementation or deployment.",
    ].join("\n"),
    source: `system_architectures:${created.data.id}`,
  });
  if (knowledge.error) return fromError(knowledge.error);

  if (input.seedNextAction !== false) {
    await createNextAction(supabase, {
      projectId: input.projectId,
      title: "Define system architecture summary and components",
      description: "Describe the runtime shape and components. Nothing has been designed yet, let alone built.",
      provenance: "FOUNDER_APPROVED_ACTION",
      sourceKind: "system_architecture",
      sourceRef: created.data.id,
      priority: "HIGH",
    });
  }

  return created;
}
