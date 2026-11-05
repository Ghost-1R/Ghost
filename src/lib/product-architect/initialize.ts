import type { GhostClient } from "@/lib/auth/session";
import { loadIdea, loadIdeaStrategy } from "@/lib/ideas/queries";
import { createNextAction } from "@/lib/operations/actions";
import { fromError, type QueryResult } from "@/lib/result";
import { ensureProductArchitecture, createProductQuestion } from "./queries";
import type { ProductArchitecture } from "./types";

/**
 * Initialize Product Architect from project + optional Idea/Strategy provenance.
 * Does not copy Strategy blindly — seeds definition fields as drafts under DRAFT status.
 */
export async function initializeProductArchitectFromProject(
  supabase: GhostClient,
  input: {
    projectId: string;
    ideaId?: string | null;
    strategyId?: string | null;
    seedNextAction?: boolean;
  },
): Promise<QueryResult<ProductArchitecture>> {
  let ideaId = input.ideaId ?? null;
  let strategyId = input.strategyId ?? null;
  let what = "";
  let why = "";
  let who = "";
  let outcome = "";
  let nonGoals: string[] = [];
  let assumptions: string[] = [];
  let risks: string[] = [];
  let constraints: string[] = [];

  if (ideaId) {
    const idea = await loadIdea(supabase, ideaId);
    if (idea.status === "ok" && idea.data) {
      what = idea.data.proposedSolution || idea.data.title;
      why = idea.data.problem || idea.data.valueProposition;
      who = idea.data.targetUser;
      outcome = idea.data.valueProposition;
      assumptions = idea.data.assumptions;
      risks = idea.data.risks;
      constraints = idea.data.constraints;
      for (const question of idea.data.openQuestions) {
        // questions created after architecture exists
        void question;
      }
    }
  }

  if (!strategyId && ideaId) {
    const strategy = await loadIdeaStrategy(supabase, ideaId);
    if (strategy.status === "ok" && strategy.data) {
      strategyId = strategy.data.id;
    }
  }

  if (strategyId && ideaId) {
    const strategy = await loadIdeaStrategy(supabase, ideaId);
    if (strategy.status === "ok" && strategy.data) {
      what = strategy.data.mvp || strategy.data.coreOffer || what;
      why = strategy.data.problem || why;
      who = strategy.data.targetCustomer || who;
      outcome = strategy.data.valueProposition || outcome;
      nonGoals = strategy.data.nonGoals.length ? strategy.data.nonGoals : nonGoals;
      if (strategy.data.notBuilding.trim()) {
        nonGoals = [...nonGoals, strategy.data.notBuilding];
      }
      assumptions = strategy.data.assumptions.length ? strategy.data.assumptions : assumptions;
      risks = strategy.data.risks.length ? strategy.data.risks : risks;
      constraints = strategy.data.constraints.length ? strategy.data.constraints : constraints;
    }
  }

  // Fallback: look up idea via promoted_project_id when not provided.
  if (!ideaId) {
    const linked = await supabase.from("ideas").select("id").eq("promoted_project_id", input.projectId).maybeSingle();
    if (!linked.error && linked.data?.id) {
      ideaId = linked.data.id;
      return initializeProductArchitectFromProject(supabase, {
        ...input,
        ideaId,
      });
    }
  }

  const created = await ensureProductArchitecture(supabase, {
    projectId: input.projectId,
    ideaId,
    strategyId,
    what,
    why,
    who,
    outcome,
    nonGoals,
    assumptions,
    risks,
    constraints,
  });
  if (created.status === "error") return created;

  if (ideaId) {
    const idea = await loadIdea(supabase, ideaId);
    if (idea.status === "ok" && idea.data) {
      for (const question of idea.data.openQuestions.slice(0, 8)) {
        await createProductQuestion(supabase, {
          architectureId: created.data.id,
          projectId: input.projectId,
          question,
        });
      }
    }
    const strategy = await loadIdeaStrategy(supabase, ideaId);
    if (strategy.status === "ok" && strategy.data) {
      for (const open of strategy.data.openDecisions.slice(0, 8)) {
        if (open.startsWith("RESOLVED:")) continue;
        await createProductQuestion(supabase, {
          architectureId: created.data.id,
          projectId: input.projectId,
          question: open,
        });
      }
    }
  }

  const knowledge = await supabase.from("project_knowledge").insert({
    project_id: input.projectId,
    kind: "FACT",
    title: "Product Architect initialized",
    content: [
      `Architecture ${created.data.id}`,
      ideaId ? `Idea provenance: ${ideaId}` : "No idea provenance recorded.",
      strategyId ? `Strategy provenance: ${strategyId}` : "No strategy provenance recorded.",
      "Seeded definition fields are drafts until founder saves/approves Product Architect state.",
    ].join("\n"),
    source: `product_architectures:${created.data.id}`,
  });
  if (knowledge.error) return fromError(knowledge.error);

  if (input.seedNextAction !== false) {
    await createNextAction(supabase, {
      projectId: input.projectId,
      title: "Define product what / why / who / outcome",
      description: "Complete Product Architect definition. Seeded strategy text is not automatically approved.",
      provenance: "FOUNDER_APPROVED_ACTION",
      sourceKind: "product_architect",
      sourceRef: created.data.id,
      priority: "HIGH",
    });
  }

  return created;
}
