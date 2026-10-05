import type { GhostClient } from "@/lib/auth/session";
import { rememberResolvedDecision } from "@/lib/memory/outcomes";
import type { DecisionDraft, DecisionResolution, DecisionStatus } from "@/lib/decisions/workflow";
import { validateDecisionDraft, validateDecisionResolution } from "@/lib/decisions/workflow";
import { fromError, type QueryResult } from "@/lib/result";

export type ProjectDecisionRecord = {
  id: string;
  projectId: string;
  title: string;
  question: string;
  context: string;
  status: DecisionStatus;
  options: Array<{ id: string; label: string }>;
  recommendation: string | null;
  evidence: Array<{ type: string; id: string; title: string }>;
  createdAt: string;
  createdBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  selectedOption: string | null;
  founderResponse: string | null;
  rationale: string | null;
};

const DECISION_COLUMNS =
  "id, project_id, title, question, context, status, options, recommendation, evidence, created_at, created_by, resolved_at, resolved_by, selected_option, founder_response, rationale" as const;

function mapDecision(row: {
  id: string;
  project_id: string;
  title: string;
  question: string;
  context: string;
  status: DecisionStatus;
  options: unknown;
  recommendation: string | null;
  evidence: unknown;
  created_at: string;
  created_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  selected_option: string | null;
  founder_response: string | null;
  rationale: string | null;
}): ProjectDecisionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    question: row.question,
    context: row.context,
    status: row.status,
    options: Array.isArray(row.options) ? (row.options as Array<{ id: string; label: string }>) : [],
    recommendation: row.recommendation,
    evidence: Array.isArray(row.evidence) ? (row.evidence as Array<{ type: string; id: string; title: string }>) : [],
    createdAt: row.created_at,
    createdBy: row.created_by,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    selectedOption: row.selected_option,
    founderResponse: row.founder_response,
    rationale: row.rationale,
  };
}

export async function loadOpenDecisions(
  supabase: GhostClient,
  projectId?: string,
): Promise<QueryResult<ProjectDecisionRecord[]>> {
  let query = supabase.from("project_decisions").select(DECISION_COLUMNS).eq("status", "OPEN").order("created_at", { ascending: true });
  if (projectId) query = query.eq("project_id", projectId);
  const result = await query;
  if (result.error) {
    if (/project_decisions|does not exist/i.test(result.error.message)) {
      return { status: "ok", data: [] };
    }
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapDecision) };
}

export async function loadProjectDecisions(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<ProjectDecisionRecord[]>> {
  const result = await supabase
    .from("project_decisions")
    .select(DECISION_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (/project_decisions|does not exist/i.test(result.error.message)) {
      return { status: "ok", data: [] };
    }
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapDecision) };
}

export async function createProjectDecision(
  supabase: GhostClient,
  draft: DecisionDraft,
  createdBy: string | null,
): Promise<QueryResult<ProjectDecisionRecord>> {
  const invalid = validateDecisionDraft(draft);
  if (invalid) return { status: "error", message: invalid };
  const inserted = await supabase
    .from("project_decisions")
    .insert({
      project_id: draft.projectId,
      title: draft.title.trim(),
      question: draft.question.trim(),
      context: draft.context?.trim() ?? "",
      options: draft.options ?? [],
      recommendation: draft.recommendation ?? null,
      evidence: draft.evidence ?? [],
      created_by: createdBy,
      status: "OPEN",
    })
    .select(DECISION_COLUMNS)
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapDecision(inserted.data) };
}

async function resolveProjectDecisionDirect(
  supabase: GhostClient,
  decisionId: string,
  resolution: DecisionResolution,
): Promise<QueryResult<ProjectDecisionRecord>> {
  const existing = await supabase.from("project_decisions").select(DECISION_COLUMNS).eq("id", decisionId).maybeSingle();
  if (existing.error) return fromError(existing.error);
  if (!existing.data) return { status: "error", message: "That decision is not visible." };
  if (existing.data.status !== "OPEN") {
    return { status: "error", message: `That decision is already ${existing.data.status.toLowerCase()}.` };
  }

  const auth = await supabase.auth.getUser();
  const updated = await supabase
    .from("project_decisions")
    .update({
      status: resolution.status,
      resolved_at: new Date().toISOString(),
      resolved_by: auth.data.user?.id ?? null,
      selected_option: resolution.status === "RESOLVED" ? resolution.selectedOption ?? null : null,
      founder_response: resolution.founderResponse ?? null,
      rationale: resolution.rationale ?? null,
    })
    .eq("id", decisionId)
    .eq("status", "OPEN")
    .select(DECISION_COLUMNS)
    .single();
  if (updated.error) return fromError(updated.error);

  if (resolution.status === "RESOLVED" && resolution.followUpAction?.title.trim()) {
    const position = await supabase
      .from("next_actions")
      .select("position")
      .eq("project_id", updated.data.project_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (position.error) return fromError(position.error);
    const followUp = await supabase.from("next_actions").insert({
      project_id: updated.data.project_id,
      title: resolution.followUpAction.title.trim(),
      description: resolution.followUpAction.description?.trim() ?? "",
      status: "OPEN",
      position: (position.data?.position ?? -1) + 1,
      priority: "HIGH",
      provenance: "FOUNDER_APPROVED_ACTION",
      source_kind: "decision_resolution",
      source_ref: decisionId,
      requires_decision: false,
      decision_id: decisionId,
    });
    if (followUp.error) return fromError(followUp.error);

    await supabase
      .from("next_actions")
      .update({ status: "OPEN", requires_decision: false })
      .eq("decision_id", decisionId)
      .eq("requires_decision", true)
      .in("status", ["OPEN", "BLOCKED"]);
  }

  return { status: "ok", data: mapDecision(updated.data) };
}

export async function resolveProjectDecision(
  supabase: GhostClient,
  decisionId: string,
  resolution: DecisionResolution,
): Promise<QueryResult<ProjectDecisionRecord>> {
  const invalid = validateDecisionResolution(resolution);
  if (invalid) return { status: "error", message: invalid };
  const result = await supabase.rpc("resolve_project_decision", {
    target_decision_id: decisionId,
    next_status: resolution.status,
    selected_option: resolution.selectedOption ?? null,
    founder_response: resolution.founderResponse ?? null,
    rationale: resolution.rationale ?? null,
    follow_up_action_title: resolution.followUpAction?.title ?? null,
    follow_up_action_description: resolution.followUpAction?.description ?? null,
  });
  if (result.error) {
    // Pre-fix RPC builds collide parameter names with columns; fall back safely.
    if (/ambiguous|selected_option/i.test(result.error.message)) {
      const fallback = await resolveProjectDecisionDirect(supabase, decisionId, resolution);
      if (fallback.status === "ok" && fallback.data.status === "RESOLVED") {
        await rememberResolvedDecision(supabase, fallback.data);
      }
      return fallback;
    }
    return fromError(result.error);
  }
  const mapped = mapDecision(result.data);
  if (mapped.status === "RESOLVED") {
    await rememberResolvedDecision(supabase, mapped);
  }
  return { status: "ok", data: mapped };
}
