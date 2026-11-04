import type { GhostClient } from "@/lib/auth/session";
import type { ProjectDecisionRecord } from "@/lib/decisions/queries";
import type { LifecycleTransitionRecord } from "@/lib/lifecycle/queries";
import { fromError, type QueryResult } from "@/lib/result";

/**
 * Reusable memory from meaningful outcomes — not every Git commit.
 * Operational events stay in lifecycle_transitions / project_decisions / repository_observations.
 * Only founder-resolved decisions and founder lifecycle moves become project knowledge.
 */
export async function rememberResolvedDecision(
  supabase: GhostClient,
  decision: ProjectDecisionRecord,
): Promise<QueryResult<{ id: string } | null>> {
  if (decision.status !== "RESOLVED") {
    return { status: "ok", data: null };
  }
  if (!decision.projectId) {
    // Idea Lab decisions become project knowledge only after promotion attaches a project.
    return { status: "ok", data: null };
  }
  const content = [
    `Question: ${decision.question}`,
    decision.selectedOption ? `Selected: ${decision.selectedOption}` : null,
    decision.founderResponse ? `Founder response: ${decision.founderResponse}` : null,
    decision.rationale ? `Rationale: ${decision.rationale}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const inserted = await supabase
    .from("project_knowledge")
    .insert({
      project_id: decision.projectId,
      kind: "DECISION",
      title: decision.title,
      content,
      source: `project_decisions:${decision.id}`,
    })
    .select("id")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: { id: inserted.data.id } };
}

export async function rememberLifecycleTransition(
  supabase: GhostClient,
  transition: LifecycleTransitionRecord,
): Promise<QueryResult<{ id: string } | null>> {
  if (transition.actor === "SYSTEM_SEED") {
    return { status: "ok", data: null };
  }
  const inserted = await supabase
    .from("project_knowledge")
    .insert({
      project_id: transition.projectId,
      kind: "FACT",
      title: `Lifecycle moved to ${transition.toStage}`,
      content: `Previous stage: ${transition.fromStage ?? "none"}. Reason: ${transition.reason}. Actor: ${transition.actor}.`,
      source: `lifecycle_transitions:${transition.id}`,
    })
    .select("id")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: { id: inserted.data.id } };
}
