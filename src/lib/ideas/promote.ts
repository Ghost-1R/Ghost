import type { GhostClient } from "@/lib/auth/session";
import { createNextAction } from "@/lib/operations/actions";
import { recordIdeaTransition, loadIdea, loadIdeaStrategy, loadIdeaEvidence, loadIdeaValidations } from "@/lib/ideas/queries";
import { fromError, type QueryResult } from "@/lib/result";
import { slugify, withSlugSuffix } from "@/lib/slug";

async function ensureCompany(
  supabase: GhostClient,
  ownerId: string,
): Promise<QueryResult<string>> {
  const existing = await supabase
    .from("companies")
    .select("id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) return fromError(existing.error);
  if (existing.data?.id) return { status: "ok", data: existing.data.id };
  const created = await supabase
    .from("companies")
    .insert({
      owner_id: ownerId,
      name: "Workspace",
      slug: "workspace",
      description: "Default founder workspace.",
    })
    .select("id")
    .single();
  if (created.error || !created.data) {
    return { status: "error", message: created.error?.message ?? "Workspace was not created." };
  }
  return { status: "ok", data: created.data.id };
}

/**
 * Explicit founder promotion: Idea → Project. Never automatic.
 * Seeds Project Brain from idea/strategy records with provenance.
 */
export async function promoteIdeaToProject(
  supabase: GhostClient,
  input: { ideaId: string; ownerId: string },
): Promise<QueryResult<{ projectId: string; nextActionId: string | null }>> {
  const idea = await loadIdea(supabase, input.ideaId);
  if (idea.status === "error") return idea;
  if (!idea.data) return { status: "error", message: "That idea is not visible." };
  if (idea.data.status !== "APPROVED") {
    return { status: "error", message: "Only an approved idea can become a project." };
  }
  if (idea.data.promotedProjectId) {
    return { status: "error", message: "This idea is already linked to a project." };
  }

  const strategy = await loadIdeaStrategy(supabase, input.ideaId);
  if (strategy.status === "error") return strategy;

  const company = await ensureCompany(supabase, input.ownerId);
  if (company.status === "error") return company;

  let slug = slugify(idea.data.title);
  let projectId: string | null = null;
  let lastError: string | null = null;
  const description = [
    idea.data.summary || idea.data.rawIdea,
    strategy.data?.mvp ? `MVP: ${strategy.data.mvp}` : null,
    `Originated from Idea Lab (${idea.data.id}).`,
  ]
    .filter(Boolean)
    .join("\n\n");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const inserted = await supabase
      .from("projects")
      .insert({
        company_id: company.data,
        name: idea.data.title.slice(0, 160),
        slug,
        description,
        current_milestone: "Strategy → first build slice",
        status: "PLANNING",
        lifecycle_stage: "STRATEGY",
      })
      .select("id")
      .single();
    if (!inserted.error && inserted.data) {
      projectId = inserted.data.id;
      break;
    }
    lastError = inserted.error?.message ?? "Project was not created.";
    if (inserted.error?.code !== "23505") break;
    slug = withSlugSuffix(slugify(idea.data.title));
  }
  if (!projectId) return { status: "error", message: lastError ?? "Project was not created." };

  await supabase.from("milestones").insert({
    project_id: projectId,
    title: "Strategy → first build slice",
    description: "Promoted from Idea Lab. Define the smallest useful version before broad build.",
    status: "PLANNING",
    position: 0,
  });

  const knowledgeRows: Array<{ project_id: string; kind: "FACT" | "REQUIREMENT" | "CONSTRAINT" | "DECISION"; title: string; content: string; source: string }> = [
    {
      project_id: projectId,
      kind: "FACT",
      title: "Originated from Idea Lab",
      content: `Idea ${idea.data.id}: ${idea.data.title}\nRaw: ${idea.data.rawIdea}`,
      source: `ideas:${idea.data.id}`,
    },
  ];
  if (idea.data.problem.trim()) {
    knowledgeRows.push({
      project_id: projectId,
      kind: "REQUIREMENT",
      title: "Problem",
      content: idea.data.problem,
      source: `ideas:${idea.data.id}:problem`,
    });
  }
  if (idea.data.targetUser.trim()) {
    knowledgeRows.push({
      project_id: projectId,
      kind: "REQUIREMENT",
      title: "Target user",
      content: idea.data.targetUser,
      source: `ideas:${idea.data.id}:target_user`,
    });
  }
  if (idea.data.proposedSolution.trim()) {
    knowledgeRows.push({
      project_id: projectId,
      kind: "REQUIREMENT",
      title: "Proposed solution",
      content: idea.data.proposedSolution,
      source: `ideas:${idea.data.id}:solution`,
    });
  }
  for (const constraint of idea.data.constraints) {
    knowledgeRows.push({
      project_id: projectId,
      kind: "CONSTRAINT",
      title: "Idea constraint",
      content: constraint,
      source: `ideas:${idea.data.id}:constraint`,
    });
  }
  if (strategy.data) {
    if (strategy.data.mvp.trim()) {
      knowledgeRows.push({
        project_id: projectId,
        kind: "REQUIREMENT",
        title: "MVP",
        content: strategy.data.mvp,
        source: `idea_strategies:${strategy.data.id}:mvp`,
      });
    }
    if (strategy.data.notBuilding.trim()) {
      knowledgeRows.push({
        project_id: projectId,
        kind: "CONSTRAINT",
        title: "What we are not building",
        content: strategy.data.notBuilding,
        source: `idea_strategies:${strategy.data.id}:not_building`,
      });
    }
    if (strategy.data.approvedAt) {
      knowledgeRows.push({
        project_id: projectId,
        kind: "DECISION",
        title: "Strategy approved",
        content: `Strategy ${strategy.data.id} approved at ${strategy.data.approvedAt}.`,
        source: `idea_strategies:${strategy.data.id}`,
      });
    }
  }

  const evidence = await loadIdeaEvidence(supabase, input.ideaId);
  if (evidence.status === "ok") {
    for (const item of evidence.data.slice(0, 20)) {
      knowledgeRows.push({
        project_id: projectId,
        kind: "FACT",
        title: `Evidence: ${item.evidenceType}`,
        content: `${item.statement}${item.source ? `\nSource: ${item.source}` : ""}\nProvenance: ${item.provenance}. This is idea evidence, not implementation proof.`,
        source: `idea_evidence:${item.id}`,
      });
    }
  }

  if (knowledgeRows.length > 0) {
    const knowledgeInsert = await supabase.from("project_knowledge").insert(knowledgeRows);
    if (knowledgeInsert.error) {
      await supabase.from("projects").delete().eq("id", projectId);
      return fromError(knowledgeInsert.error);
    }
  }

  const next = await createNextAction(supabase, {
    projectId,
    title: "Define the first build slice from the approved MVP",
    description: strategy.data?.mvp
      ? `MVP recorded: ${strategy.data.mvp}. Break it into the smallest useful engineering slice. Project creation is not implementation.`
      : "No MVP text was recorded. Capture the smallest useful version before broad build. Project creation is not implementation.",
    priority: "HIGH",
    provenance: "FOUNDER_APPROVED_ACTION",
    sourceKind: "idea_promotion",
    sourceRef: input.ideaId,
  });
  if (next.status === "error") {
    await supabase.from("projects").delete().eq("id", projectId);
    return next;
  }

  const linked = await supabase
    .from("ideas")
    .update({ promoted_project_id: projectId })
    .eq("id", input.ideaId);
  if (linked.error) {
    await supabase.from("projects").delete().eq("id", projectId);
    return fromError(linked.error);
  }

  const transition = await recordIdeaTransition(
    supabase,
    input.ideaId,
    "PROMOTED",
    `Founder promoted idea into project ${projectId}. Project creation is not implementation or deployment.`,
  );
  if (transition.status === "error") {
    return { status: "error", message: transition.message };
  }

  // Move project lifecycle history note via knowledge; stage already STRATEGY.
  void loadIdeaValidations;

  return { status: "ok", data: { projectId, nextActionId: next.data.id } };
}
