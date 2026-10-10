import type { GhostClient } from "@/lib/auth/session";
import type { AgentTask, AgentTaskStatus } from "@/lib/agent-runtime/types";
import { fromError, type QueryResult } from "@/lib/result";
import type { TodayAction } from "./today";
import type { ActivityItem } from "./activity";

/**
 * Genuine agent-task projection onto Ghost operating surfaces (Build 09.8 ops).
 * Never invents progress percentages or fake activity.
 * Pages should import this module — not @/lib/agent-runtime — to keep surface coupling thin.
 */

export type AgentTaskSurfaceRow = {
  id: string;
  ownerId: string;
  projectId: string;
  projectName: string;
  status: AgentTaskStatus;
  actionType: string;
  actionScope: string;
  authorizationKind: "DEVELOPMENT" | "DEPLOYMENT";
  checkpointSequence: number;
  lastStepIdempotencyKey: string;
  blockReason: string;
  updatedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
};

const ACTIVE: ReadonlySet<AgentTaskStatus> = new Set([
  "QUEUED",
  "CLAIMED",
  "RUNNING",
  "CHECKPOINT",
  "BLOCKED",
]);

function mapStatusToAction(status: AgentTaskStatus): TodayAction["status"] {
  if (status === "BLOCKED") return "BLOCKED";
  if (status === "SUCCEEDED") return "DONE";
  if (status === "CANCELLED" || status === "FAILED") return "CANCELLED";
  if (status === "QUEUED") return "OPEN";
  return "IN_PROGRESS";
}

/** Pure projection — used by tests and loaders. */
export function projectAgentTasksToTodayActions(
  rows: readonly AgentTaskSurfaceRow[],
): TodayAction[] {
  return rows
    .filter((row) => ACTIVE.has(row.status))
    .map((row) => {
      const checkpoint =
        row.checkpointSequence > 0 ? ` · checkpoint ${row.checkpointSequence}` : "";
      const blocked = row.status === "BLOCKED" && row.blockReason ? ` (${row.blockReason})` : "";
      return {
        id: `agent-task-${row.id}`,
        projectId: row.projectId,
        projectName: row.projectName,
        title: `Agent task: ${row.actionType}`,
        description: `${row.authorizationKind} · ${row.actionScope}${checkpoint}${blocked}`.slice(
          0,
          2000,
        ),
        status: mapStatusToAction(row.status),
        priority: row.status === "BLOCKED" ? "HIGH" : "NORMAL",
        provenance: "FACT" as const,
        requiresDecision: row.status === "BLOCKED",
        sourceKind: "agent_task",
      };
    });
}

export function projectAgentTasksToActivity(
  rows: readonly AgentTaskSurfaceRow[],
): ActivityItem[] {
  return rows.map((row) => {
    const detailParts = [
      `status ${row.status}`,
      row.authorizationKind,
      row.checkpointSequence > 0 ? `checkpoint ${row.checkpointSequence}` : null,
      row.blockReason ? `blocked: ${row.blockReason}` : null,
    ].filter(Boolean);
    return {
      id: `agent-task-act-${row.id}`,
      projectId: row.projectId,
      projectName: row.projectName,
      kind: "agent_task" as ActivityItem["kind"],
      title: `Agent task ${row.actionType}`,
      detail: detailParts.join(" · "),
      at: row.updatedAt,
      href: `/projects/${row.projectId}`,
    };
  });
}

export function countActiveAgentTasks(rows: readonly AgentTaskSurfaceRow[]): number {
  return rows.filter((row) => ACTIVE.has(row.status)).length;
}

type TaskRow = {
  id: string;
  owner_id: string;
  project_id: string;
  status: string;
  action_type: string;
  action_scope: string;
  authorization_kind: string;
  checkpoint_sequence: number;
  last_step_idempotency_key: string;
  block_reason: string;
  updated_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  projects?: { name: string } | { name: string }[] | null;
};

function projectNameFromJoin(value: TaskRow["projects"]): string {
  if (!value) return "Project";
  if (Array.isArray(value)) return value[0]?.name ?? "Project";
  return value.name || "Project";
}

/**
 * Load genuine agent tasks for operating surfaces.
 * Missing table → empty ok (schema not applied yet), never fake rows.
 */
export async function loadAgentTaskSurface(
  supabase: GhostClient,
  options?: { limit?: number },
): Promise<QueryResult<AgentTaskSurfaceRow[]>> {
  const limit = options?.limit ?? 20;
  const { data, error } = await supabase
    .from("agent_tasks")
    .select(
      "id, owner_id, project_id, status, action_type, action_scope, authorization_kind, checkpoint_sequence, last_step_idempotency_key, block_reason, updated_at, claimed_at, completed_at, projects(name)",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (/agent_tasks|schema cache|does not exist/i.test(error.message)) {
      return { status: "ok", data: [] };
    }
    return fromError(error);
  }

  const rows: AgentTaskSurfaceRow[] = ((data ?? []) as TaskRow[]).map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    projectName: projectNameFromJoin(row.projects),
    status: row.status as AgentTaskStatus,
    actionType: row.action_type,
    actionScope: row.action_scope,
    authorizationKind: row.authorization_kind as "DEVELOPMENT" | "DEPLOYMENT",
    checkpointSequence: row.checkpoint_sequence ?? 0,
    lastStepIdempotencyKey: row.last_step_idempotency_key ?? "",
    blockReason: row.block_reason ?? "",
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
  }));

  return { status: "ok", data: rows };
}

/** Test helper: project an in-memory AgentTask without DB. */
export function surfaceRowFromTask(
  task: AgentTask,
  projectName: string,
): AgentTaskSurfaceRow {
  return {
    id: task.id,
    ownerId: task.ownerId,
    projectId: task.projectId,
    projectName,
    status: task.status,
    actionType: task.binding.actionType,
    actionScope: task.binding.actionScope,
    authorizationKind: task.binding.authorizationKind,
    checkpointSequence: task.checkpointSequence,
    lastStepIdempotencyKey: task.lastStepIdempotencyKey,
    blockReason: task.blockReason,
    updatedAt: task.updatedAt,
    claimedAt: task.claimedAt,
    completedAt: task.completedAt,
  };
}
