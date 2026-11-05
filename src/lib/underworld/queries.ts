import type { GhostClient } from "@/lib/auth/session";
import { isMissingRelation, loose } from "@/lib/db/loose";
import { fromError, type QueryResult } from "@/lib/result";
import type {
  UnderworldGoal,
  UnderworldPlan,
  UnderworldStep,
} from "@/lib/underworld/types";

export type UnderworldBoard = {
  goal: UnderworldGoal;
  plan: UnderworldPlan;
  steps: UnderworldStep[];
};

function mapGoal(row: Record<string, unknown>): UnderworldGoal {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    projectId: String(row.project_id),
    ownerId: String(row.owner_id),
    title: String(row.title),
    objective: String(row.objective ?? ""),
    classification: row.classification as UnderworldGoal["classification"],
    budgetCents: Number(row.budget_cents ?? 0),
    stopCondition: String(row.stop_condition ?? ""),
    status: row.status as UnderworldGoal["status"],
  };
}

function mapPlan(row: Record<string, unknown>): UnderworldPlan {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    version: Number(row.version ?? 1),
    status: row.status as UnderworldPlan["status"],
    scopeSummary: String(row.scope_summary ?? ""),
    scopeFingerprint: String(row.scope_fingerprint ?? ""),
    previewedAt: (row.previewed_at as string | null) ?? null,
  };
}

function mapStep(row: Record<string, unknown>): UnderworldStep {
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    seq: Number(row.seq),
    title: String(row.title),
    role: row.role as UnderworldStep["role"],
    assigneeKind: row.assignee_kind as UnderworldStep["assigneeKind"],
    dependsOn: Array.isArray(row.depends_on) ? (row.depends_on as string[]) : [],
    assignmentId: (row.assignment_id as string | null) ?? null,
    agentTaskId: (row.agent_task_id as string | null) ?? null,
    status: row.status as UnderworldStep["status"],
    stopCondition: String(row.stop_condition ?? ""),
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
  };
}

export async function loadLatestUnderworldBoard(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<UnderworldBoard | null>> {
  const goals = await loose(supabase)
    .from("underworld_goals")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (goals.error) {
    if (isMissingRelation(goals.error.message)) return { status: "ok", data: null };
    return fromError(goals.error);
  }
  const goalRow = (goals.data ?? [])[0] as Record<string, unknown> | undefined;
  if (!goalRow) return { status: "ok", data: null };

  const plans = await loose(supabase)
    .from("underworld_plans")
    .select("*")
    .eq("goal_id", goalRow.id)
    .order("version", { ascending: false })
    .limit(1);
  if (plans.error) return fromError(plans.error);
  const planRow = (plans.data ?? [])[0] as Record<string, unknown> | undefined;
  if (!planRow) return { status: "ok", data: null };

  const steps = await loose(supabase)
    .from("underworld_steps")
    .select("*")
    .eq("plan_id", planRow.id)
    .order("seq");
  if (steps.error) return fromError(steps.error);

  return {
    status: "ok",
    data: {
      goal: mapGoal(goalRow),
      plan: mapPlan(planRow),
      steps: ((steps.data ?? []) as Record<string, unknown>[]).map(mapStep),
    },
  };
}
