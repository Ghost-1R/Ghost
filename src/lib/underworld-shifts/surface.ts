import type { ActivityItem } from "@/lib/operations/activity";
import type { TodayAction } from "@/lib/operations/today";
import type { UnderworldShiftJob, UnderworldShiftJobStatus } from "./types";

const ACTIVE: ReadonlySet<UnderworldShiftJobStatus> = new Set([
  "QUEUED",
  "WORKING",
  "BLOCKED",
  "AWAITING_APPROVAL",
]);

function statusLabel(status: UnderworldShiftJobStatus): string {
  switch (status) {
    case "QUEUED":
      return "queued";
    case "WORKING":
      return "working";
    case "BLOCKED":
      return "blocked";
    case "AWAITING_APPROVAL":
      return "awaiting approval";
    case "COMPLETE":
      return "complete";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
  }
}

function toTodayStatus(status: UnderworldShiftJobStatus): TodayAction["status"] {
  if (status === "BLOCKED" || status === "AWAITING_APPROVAL") return "BLOCKED";
  if (status === "COMPLETE") return "DONE";
  if (status === "FAILED" || status === "CANCELLED") return "CANCELLED";
  if (status === "QUEUED") return "OPEN";
  return "IN_PROGRESS";
}

export function projectShiftJobsToTodayActions(
  rows: readonly (UnderworldShiftJob & { projectName?: string })[],
): TodayAction[] {
  return rows
    .filter((row) => ACTIVE.has(row.status) || row.status === "COMPLETE")
    .slice(0, 12)
    .map((row) => ({
      id: `uw-shift-${row.id}`,
      projectId: row.projectId,
      projectName: row.projectName ?? "Project",
      title: `Underworld shift · build plan review (${statusLabel(row.status)})`,
      description: [
        row.checkpointLabel ? `checkpoint ${row.checkpointStep}: ${row.checkpointLabel}` : null,
        row.reviewSummary || null,
        row.blockReason || null,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 2000) || "Shift job recorded.",
      status: toTodayStatus(row.status),
      priority:
        row.status === "BLOCKED" || row.status === "AWAITING_APPROVAL" ? "HIGH" : "NORMAL",
      provenance: "FACT" as const,
      requiresDecision: row.status === "AWAITING_APPROVAL" || row.status === "BLOCKED",
      sourceKind: "underworld_shift_job",
    }));
}

export function projectShiftJobsToActivity(
  rows: readonly (UnderworldShiftJob & { projectName?: string })[],
): ActivityItem[] {
  return rows.map((row) => ({
    id: `uw-shift-activity-${row.id}`,
    projectId: row.projectId,
    projectName: row.projectName ?? "Project",
    title: `Shift job ${statusLabel(row.status)}`,
    detail: row.reviewSummary || row.checkpointLabel || row.workflow,
    at: row.updatedAt,
    href: `/underworld/watch?project=${row.projectId}`,
    kind: "agent_task" as const,
  }));
}
