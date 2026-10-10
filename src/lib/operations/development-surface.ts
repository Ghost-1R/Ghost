import type { DevelopmentStateProjection } from "@/lib/remote-development/state-projection";
import type { TodayAction } from "./today";
import type { ActivityItem } from "./activity";

/**
 * Project durable/sim development workflow projections onto Operations Today/Activity.
 * Does not invent metrics. SIMULATED labels stay explicit. Never claims Project Truth verified.
 */

const ACTIVE: ReadonlySet<DevelopmentStateProjection["state"]> = new Set([
  "AWAITING_APPROVAL",
  "AUTHORIZED",
  "QUEUED",
  "RUNNING",
  "FAILED_OR_BLOCKED",
  "AWAITING_REVIEW",
  "INDEPENDENTLY_VERIFIED",
]);

function mapStateToToday(status: DevelopmentStateProjection["state"]): TodayAction["status"] {
  if (status === "FAILED_OR_BLOCKED") return "BLOCKED";
  if (status === "FOUNDER_ACCEPTED") return "DONE";
  if (status === "QUEUED" || status === "AUTHORIZED" || status === "AWAITING_APPROVAL") return "OPEN";
  return "IN_PROGRESS";
}

export function projectDevelopmentToTodayActions(
  rows: readonly DevelopmentStateProjection[],
): TodayAction[] {
  return rows
    .filter((row) => ACTIVE.has(row.state))
    .map((row) => ({
      id: `dev-task-${row.remoteTaskId}`,
      projectId: row.projectId,
      projectName: row.projectName,
      title: `Development: ${row.objective.slice(0, 80)}`,
      description: [
        row.state,
        row.simulationLabel === "SIMULATED" ? "SIMULATED" : "durable",
        row.agentTaskId ? `agent ${row.agentTaskId.slice(0, 8)}` : "agent unbound",
        row.projectTruthNote,
      ]
        .join(" · ")
        .slice(0, 2000),
      status: mapStateToToday(row.state),
      priority: row.state === "FAILED_OR_BLOCKED" ? "HIGH" : "NORMAL",
      provenance: "FACT" as const,
      requiresDecision:
        row.state === "AWAITING_REVIEW" ||
        row.state === "INDEPENDENTLY_VERIFIED" ||
        row.state === "FAILED_OR_BLOCKED",
      sourceKind: "development_task",
    }));
}

export function projectDevelopmentToActivity(
  rows: readonly DevelopmentStateProjection[],
): ActivityItem[] {
  return rows.map((row) => ({
    id: `dev-task-act-${row.remoteTaskId}`,
    projectId: row.projectId,
    projectName: row.projectName,
    kind: "development_task" as ActivityItem["kind"],
    title: `Development ${row.state}`,
    detail: [
      row.objective.slice(0, 120),
      row.approvalEffectiveStatus,
      row.evidenceState,
      row.simulationLabel === "SIMULATED" ? "SIMULATED" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    at: new Date().toISOString(),
    href: `/development-tasks`,
  }));
}
