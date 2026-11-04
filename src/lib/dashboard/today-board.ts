import type { AgentTaskSurfaceRow } from "@/lib/operations/agent-task-surface";
import type { ActivityItem } from "@/lib/operations/activity";
import type { TodayAction } from "@/lib/operations/today";
import type { ProjectStatus } from "@/lib/domain/status";
import { PROJECT_STATUSES } from "@/lib/domain/status";

export type PriorityCard = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  detail: string;
  href: string;
  dueLabel: string;
  status: TodayAction["status"];
};

export type ProjectBoardRow = {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  nextAction: string | null;
  href: string;
};

export type ActivityDayGroup = {
  dayKey: string;
  dayLabel: string;
  items: Array<
    ActivityItem & {
      resultHref: string | null;
      evidenceHref: string | null;
    }
  >;
};

/** Due dates are not persisted on next_actions yet — always label absence clearly. */
export function dueDateLabel(dueAt: string | null | undefined): string {
  if (!dueAt) return "No due date recorded";
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "No due date recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function buildPriorityCards(actions: readonly TodayAction[]): PriorityCard[] {
  return actions.slice(0, 8).map((action) => ({
    id: action.id,
    projectId: action.projectId,
    projectName: action.projectName,
    title: action.title,
    detail: action.description,
    href: `/projects/${action.projectId}`,
    dueLabel: dueDateLabel(null),
    status: action.status,
  }));
}

export function pickCurrentWorkerTask(
  rows: readonly AgentTaskSurfaceRow[],
): AgentTaskSurfaceRow | null {
  const order = ["RUNNING", "CHECKPOINT", "CLAIMED", "BLOCKED", "QUEUED"] as const;
  for (const status of order) {
    const match = rows.find((row) => row.status === status);
    if (match) return match;
  }
  return null;
}

export type WorkerControlAction = "MOCK" | "PAUSE" | "RESUME" | "CANCEL";

export type WorkerControlOptions = {
  leaseExpiresAt?: string | null;
  checkpointSequence?: number;
  at?: string;
};

const IN_FLIGHT_STATUSES = new Set(["CLAIMED", "RUNNING", "CHECKPOINT"]);

/**
 * In-flight task with an explicitly missing or wall-clock-expired lease
 * cannot Continue/Pause. Omit leaseExpiresAt when the caller has no lease data.
 */
export function isTestSessionExpired(
  input: {
    status: AgentTaskSurfaceRow["status"];
    leaseExpiresAt?: string | null;
  },
  at = new Date().toISOString(),
): boolean {
  if (!IN_FLIGHT_STATUSES.has(input.status)) return false;
  if (input.leaseExpiresAt === undefined) return false;
  if (input.leaseExpiresAt == null || input.leaseExpiresAt === "") return true;
  const expires = Date.parse(input.leaseExpiresAt);
  const now = Date.parse(at);
  if (!Number.isFinite(expires) || !Number.isFinite(now)) return true;
  return now >= expires;
}

export function workerControlsFor(
  status: AgentTaskSurfaceRow["status"],
  options?: WorkerControlOptions,
): WorkerControlAction[] {
  if (
    isTestSessionExpired(
      { status, leaseExpiresAt: options?.leaseExpiresAt },
      options?.at,
    )
  ) {
    return ["CANCEL"];
  }
  if (status === "BLOCKED") return ["RESUME"];
  if (status === "QUEUED") return ["MOCK", "CANCEL"];
  if (status === "CLAIMED" || status === "RUNNING" || status === "CHECKPOINT") {
    return ["MOCK", "PAUSE", "CANCEL"];
  }
  if (status === "SUCCEEDED") return [];
  return [];
}

export function primaryWorkerAction(
  status: AgentTaskSurfaceRow["status"],
  options?: WorkerControlOptions,
): string {
  if (
    isTestSessionExpired(
      { status, leaseExpiresAt: options?.leaseExpiresAt },
      options?.at,
    )
  ) {
    return (options?.checkpointSequence ?? 0) > 0
      ? "View saved step"
      : "Open Worker history";
  }
  if (status === "QUEUED") return "Start test run";
  if (status === "CLAIMED" || status === "RUNNING" || status === "CHECKPOINT") {
    return "Continue test run";
  }
  if (status === "BLOCKED") return "Resume";
  if (status === "SUCCEEDED") return "Open saved result";
  return "Open workspace";
}

export function groupProjectsByStatus(rows: readonly ProjectBoardRow[]): Array<{
  status: ProjectStatus;
  projects: ProjectBoardRow[];
}> {
  const buckets = new Map<ProjectStatus, ProjectBoardRow[]>();
  for (const status of PROJECT_STATUSES) buckets.set(status, []);
  for (const row of rows) {
    const list = buckets.get(row.status) ?? [];
    list.push(row);
    buckets.set(row.status, list);
  }
  return PROJECT_STATUSES.map((status) => ({
    status,
    projects: buckets.get(status) ?? [],
  })).filter((group) => group.projects.length > 0);
}

export function enrichActivityItem(item: ActivityItem): ActivityItem & {
  resultHref: string | null;
  evidenceHref: string | null;
} {
  if (item.kind === "agent_task") {
    const taskMatch = item.id.match(/^agent-task-act-(.+)$/);
    const taskId = taskMatch?.[1] ?? null;
    const workspace = taskId
      ? `/projects/${item.projectId}/workspace?task=${encodeURIComponent(taskId)}`
      : `/projects/${item.projectId}/workspace`;
    const succeeded = /status SUCCEEDED/i.test(item.detail);
    return {
      ...item,
      href: workspace,
      resultHref: succeeded ? `/files` : null,
      evidenceHref: workspace,
    };
  }
  if (item.kind === "decision") {
    return {
      ...item,
      href: `/decisions`,
      resultHref: null,
      evidenceHref: item.projectId ? `/projects/${item.projectId}` : "/decisions",
    };
  }
  if (item.kind === "verification") {
    return {
      ...item,
      resultHref: `/projects/${item.projectId}`,
      evidenceHref: `/projects/${item.projectId}`,
    };
  }
  if (item.kind === "deployment") {
    return {
      ...item,
      resultHref: item.href,
      evidenceHref: item.href,
    };
  }
  return { ...item, resultHref: null, evidenceHref: item.href };
}

export function groupActivityByDate(
  items: readonly ActivityItem[],
  timeZone: string,
): ActivityDayGroup[] {
  const groups = new Map<string, ActivityDayGroup>();
  for (const raw of items) {
    const item = enrichActivityItem(raw);
    const at = new Date(item.at);
    const dayKey = Number.isNaN(at.getTime())
      ? "unknown"
      : new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(at);
    const dayLabel =
      dayKey === "unknown"
        ? "Date not recorded"
        : new Intl.DateTimeFormat("en-US", {
            timeZone,
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          }).format(at);
    const existing = groups.get(dayKey);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(dayKey, { dayKey, dayLabel, items: [item] });
    }
  }
  return [...groups.values()];
}

export function decisionReviewHref(input: {
  decisionId: string;
  projectId: string | null;
  taskId: string | null;
}): string {
  if (input.taskId && input.projectId) {
    return `/projects/${input.projectId}/workspace?task=${encodeURIComponent(input.taskId)}`;
  }
  if (input.projectId) return `/projects/${input.projectId}`;
  return `/decisions`;
}
