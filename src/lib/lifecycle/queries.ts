import type { GhostClient } from "@/lib/auth/session";
import { rememberLifecycleTransition } from "@/lib/memory/outcomes";
import type { LifecycleActor, LifecycleStage } from "@/lib/lifecycle/stages";
import { fromError, type QueryResult } from "@/lib/result";

export type LifecycleTransitionRecord = {
  id: string;
  projectId: string;
  fromStage: LifecycleStage | null;
  toStage: LifecycleStage;
  changedAt: string;
  changedBy: string | null;
  actor: LifecycleActor;
  reason: string;
  evidenceKind: string | null;
  evidenceId: string | null;
};

function mapTransition(row: {
  id: string;
  project_id: string;
  from_stage: LifecycleStage | null;
  to_stage: LifecycleStage;
  changed_at: string;
  changed_by: string | null;
  actor: LifecycleActor;
  reason: string;
  evidence_kind: string | null;
  evidence_id: string | null;
}): LifecycleTransitionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    actor: row.actor,
    reason: row.reason,
    evidenceKind: row.evidence_kind,
    evidenceId: row.evidence_id,
  };
}

export async function loadLifecycleHistory(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<LifecycleTransitionRecord[]>> {
  const result = await supabase
    .from("lifecycle_transitions")
    .select("id, project_id, from_stage, to_stage, changed_at, changed_by, actor, reason, evidence_kind, evidence_id")
    .eq("project_id", projectId)
    .order("changed_at", { ascending: false });
  if (result.error) return fromError(result.error);
  return { status: "ok", data: result.data.map(mapTransition) };
}

export async function recordLifecycleTransition(
  supabase: GhostClient,
  input: {
    projectId: string;
    toStage: LifecycleStage;
    reason: string;
    actor?: Exclude<LifecycleActor, "SYSTEM_SEED">;
    evidenceKind?: string | null;
    evidenceId?: string | null;
  },
): Promise<QueryResult<LifecycleTransitionRecord>> {
  const result = await supabase.rpc("record_lifecycle_transition", {
    target_project_id: input.projectId,
    next_stage: input.toStage,
    transition_reason: input.reason,
    transition_actor: input.actor ?? "FOUNDER",
    evidence_kind: input.evidenceKind ?? null,
    evidence_id: input.evidenceId ?? null,
  });
  if (result.error) return fromError(result.error);
  const mapped = mapTransition(result.data);
  await rememberLifecycleTransition(supabase, mapped);
  return { status: "ok", data: mapped };
}
