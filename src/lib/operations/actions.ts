import type { GhostClient } from "@/lib/auth/session";
import type { ActionPriority, ActionProvenance, OperatingActionStatus } from "@/lib/operations/today";
import { prioritizeTodayActions, type TodayAction } from "@/lib/operations/today";
import { fromError, type QueryResult } from "@/lib/result";

export type NextActionDetail = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: OperatingActionStatus;
  priority: ActionPriority;
  provenance: ActionProvenance;
  sourceKind: string;
  sourceRef: string | null;
  requiresDecision: boolean;
  decisionId: string | null;
  requirementId: string | null;
  position: number;
  createdAt: string;
  completedAt: string | null;
};

const ACTION_COLUMNS =
  "id, project_id, title, description, status, priority, provenance, source_kind, source_ref, requires_decision, decision_id, requirement_id, position, created_at, completed_at" as const;

function mapAction(row: {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: OperatingActionStatus;
  priority: ActionPriority;
  provenance: ActionProvenance;
  source_kind: string;
  source_ref: string | null;
  requires_decision: boolean;
  decision_id: string | null;
  requirement_id: string | null;
  position: number;
  created_at: string;
  completed_at: string | null;
}): NextActionDetail {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    provenance: row.provenance,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    requiresDecision: row.requires_decision,
    decisionId: row.decision_id,
    requirementId: row.requirement_id,
    position: row.position,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function loadProjectNextActions(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<NextActionDetail[]>> {
  const result = await supabase
    .from("next_actions")
    .select(ACTION_COLUMNS)
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  if (result.error) return fromError(result.error);
  return { status: "ok", data: result.data.map(mapAction) };
}

export async function loadTodayActions(supabase: GhostClient): Promise<QueryResult<TodayAction[]>> {
  const [actions, projects] = await Promise.all([
    supabase.from("next_actions").select(ACTION_COLUMNS).in("status", ["OPEN", "IN_PROGRESS", "BLOCKED"]),
    supabase.from("projects").select("id, name"),
  ]);
  if (actions.error) {
    if (/relation .*next_actions.* does not exist|column .* does not exist/i.test(actions.error.message)) {
      return { status: "ok", data: [] };
    }
    return fromError(actions.error);
  }
  if (projects.error) return fromError(projects.error);
  const names = new Map(projects.data.map((project) => [project.id, project.name]));
  const today = actions.data.map((row) => {
    const mapped = mapAction(row);
    return {
      id: mapped.id,
      projectId: mapped.projectId,
      projectName: names.get(mapped.projectId) ?? "Unknown project",
      title: mapped.title,
      description: mapped.description,
      status: mapped.status,
      priority: mapped.priority,
      provenance: mapped.provenance,
      requiresDecision: mapped.requiresDecision,
      sourceKind: mapped.sourceKind,
    } satisfies TodayAction;
  });
  return { status: "ok", data: prioritizeTodayActions(today) };
}

export async function createNextAction(
  supabase: GhostClient,
  input: {
    projectId: string;
    title: string;
    description?: string;
    priority?: ActionPriority;
    provenance: ActionProvenance;
    sourceKind: string;
    sourceRef?: string | null;
    requiresDecision?: boolean;
    decisionId?: string | null;
    requirementId?: string | null;
  },
): Promise<QueryResult<NextActionDetail>> {
  if (input.provenance === "RECOMMENDATION" && input.requiresDecision !== true) {
    // Recommendations never silently become authoritative work.
  }
  const position = await supabase
    .from("next_actions")
    .select("position")
    .eq("project_id", input.projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (position.error) return fromError(position.error);

  const inserted = await supabase
    .from("next_actions")
    .insert({
      project_id: input.projectId,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      status: "OPEN",
      position: (position.data?.position ?? -1) + 1,
      priority: input.priority ?? "NORMAL",
      provenance: input.provenance,
      source_kind: input.sourceKind,
      source_ref: input.sourceRef ?? null,
      requires_decision: input.requiresDecision ?? false,
      decision_id: input.decisionId ?? null,
      requirement_id: input.requirementId ?? null,
    })
    .select(ACTION_COLUMNS)
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapAction(inserted.data) };
}

export async function updateNextActionStatus(
  supabase: GhostClient,
  input: { id: string; status: OperatingActionStatus },
): Promise<QueryResult<NextActionDetail>> {
  const completedAt = input.status === "DONE" ? new Date().toISOString() : null;
  const updated = await supabase
    .from("next_actions")
    .update({ status: input.status, completed_at: completedAt })
    .eq("id", input.id)
    .select(ACTION_COLUMNS)
    .single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapAction(updated.data) };
}
