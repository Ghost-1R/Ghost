import type { AgentTaskSurfaceRow } from "@/lib/operations/agent-task-surface";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import type { AgentTaskStatus } from "@/lib/agent-runtime/types";
import { workspaceTaskHref } from "@/lib/workspace/types";

export type ControlCenterBoard = {
  queued: AgentTaskSurfaceRow[];
  running: AgentTaskSurfaceRow[];
  blocked: AgentTaskSurfaceRow[];
  failed: AgentTaskSurfaceRow[];
  completed: AgentTaskSurfaceRow[];
  awaitingApproval: FounderActionAuthorization[];
};

const RUNNING: ReadonlySet<AgentTaskStatus> = new Set(["CLAIMED", "RUNNING", "CHECKPOINT"]);

export function buildControlCenterBoard(
  tasks: readonly AgentTaskSurfaceRow[],
  approvals: readonly FounderActionAuthorization[],
): ControlCenterBoard {
  return {
    queued: tasks.filter((row) => row.status === "QUEUED"),
    running: tasks.filter((row) => RUNNING.has(row.status)),
    blocked: tasks.filter((row) => row.status === "BLOCKED"),
    failed: tasks.filter((row) => row.status === "FAILED"),
    completed: tasks.filter((row) => row.status === "SUCCEEDED"),
    awaitingApproval: approvals.filter(
      (auth) => auth.effectiveStatus === "PENDING" || auth.status === "PENDING",
    ),
  };
}

export function controlCenterHref(row: Pick<AgentTaskSurfaceRow, "projectId">): string {
  return workspaceTaskHref(row.projectId);
}
