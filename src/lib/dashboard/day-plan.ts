import type { AgentTaskSurfaceRow } from "@/lib/operations/agent-task-surface";
import type { TodayAction } from "@/lib/operations/today";
import { explainTodayPriority } from "@/lib/operations/today";

export const DAY_PLAN_BUCKETS = ["DO_FIRST", "LATER", "WAITING"] as const;
export type DayPlanBucket = (typeof DAY_PLAN_BUCKETS)[number];

export type DayPlanSourceKind = "agent_task" | "next_action" | "decision";

export type DayPlanItem = {
  id: string;
  sourceKind: DayPlanSourceKind;
  sourceId: string;
  projectId: string;
  projectName: string;
  title: string;
  detail: string;
  bucket: DayPlanBucket;
  reason: string;
  /** Minutes only when a recorded estimate exists — never invented. */
  estimateMinutes: number | null;
  href: string;
  actionLabel: string | null;
  statusTag: string | null;
  taskId: string | null;
};

export type DayPlanPlacement = {
  id: string;
  bucket: DayPlanBucket;
};

export type SavedDayPlan = {
  planDate: string;
  placements: DayPlanPlacement[];
  savedAt: string | null;
};

export type OpenDecisionSeed = {
  id: string;
  projectId: string | null;
  projectName: string;
  title: string;
  question: string;
};

const BUCKET_LABEL: Record<DayPlanBucket, string> = {
  DO_FIRST: "Do first",
  LATER: "Later",
  WAITING: "Waiting",
};

export function dayPlanBucketLabel(bucket: DayPlanBucket): string {
  return BUCKET_LABEL[bucket];
}

/** Parse a recorded estimate from known fact text only — never invents numbers. */
export function recordedEstimateMinutes(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(
    /(?:^|[\s·|;])(?:estimate|est\.?|recorded\s+estimate)\s*[:=]?\s*~?\s*(\d{1,3})\s*(?:min|mins|minutes)\b/i,
  );
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 480) return null;
  return value;
}

export function plainDecisionTitle(title: string): string {
  const trimmed = title.trim();
  if (/accept\s+mock\s+vehicle\s+result/i.test(trimmed)) {
    return "Accept the vehicle test result?";
  }
  if (trimmed.endsWith("?")) return trimmed;
  if (/^accept\b/i.test(trimmed)) return `${trimmed}?`;
  return trimmed.startsWith("Decision:") ? trimmed : `Decision: ${trimmed}`;
}

function agentTaskTitle(row: AgentTaskSurfaceRow): string {
  if (row.status === "SUCCEEDED") return "Test run completed";
  if (row.status === "QUEUED") return "Start test run";
  if (row.checkpointSequence > 0) return "Continue test run";
  return "Continue MOCK step";
}

function agentTaskReason(row: AgentTaskSurfaceRow): string {
  if (row.status === "BLOCKED") {
    return row.blockReason
      ? `Waiting until the block is cleared: ${row.blockReason.slice(0, 140)}`
      : "Waiting because this worker task is blocked.";
  }
  if (row.status === "QUEUED") {
    return "Do first because a test worker task is queued and ready to start.";
  }
  if (row.status === "CHECKPOINT" || row.status === "RUNNING" || row.status === "CLAIMED") {
    return `Do first because the test run is mid-flight at step ${Math.max(row.checkpointSequence, 1)}.`;
  }
  return "Open worker task on today's board.";
}

function agentTaskBucket(row: AgentTaskSurfaceRow): DayPlanBucket {
  if (row.status === "BLOCKED") return "WAITING";
  if (row.status === "QUEUED" || row.status === "CLAIMED" || row.status === "RUNNING" || row.status === "CHECKPOINT") {
    return "DO_FIRST";
  }
  return "LATER";
}

function agentActionLabel(row: AgentTaskSurfaceRow): string | null {
  if (row.status === "QUEUED") return "Run with worker";
  if (row.status === "CLAIMED" || row.status === "RUNNING" || row.status === "CHECKPOINT") {
    return "Continue";
  }
  if (row.status === "BLOCKED") return "Resume";
  if (row.status === "SUCCEEDED") return "Open result";
  return null;
}

export function recommendDayPlan(input: {
  actions: readonly TodayAction[];
  agentTasks: readonly AgentTaskSurfaceRow[];
  decisions: readonly OpenDecisionSeed[];
}): DayPlanItem[] {
  const items: DayPlanItem[] = [];
  const seenActionIds = new Set<string>();

  for (const row of input.agentTasks) {
    if (!["QUEUED", "CLAIMED", "RUNNING", "CHECKPOINT", "BLOCKED"].includes(row.status)) continue;
    const id = `agent_task:${row.id}`;
    seenActionIds.add(`agent-task-${row.id}`);
    const estimate = recordedEstimateMinutes(row.actionScope) ?? recordedEstimateMinutes(row.blockReason);
    items.push({
      id,
      sourceKind: "agent_task",
      sourceId: row.id,
      projectId: row.projectId,
      projectName: row.projectName,
      title: agentTaskTitle(row),
      detail:
        row.checkpointSequence > 0
          ? `Saved after step ${row.checkpointSequence}`
          : row.status === "QUEUED"
            ? "Ready to start the test run"
            : "Worker task in progress",
      bucket: agentTaskBucket(row),
      reason: agentTaskReason(row),
      estimateMinutes: estimate,
      href: `/projects/${row.projectId}/workspace?task=${encodeURIComponent(row.id)}`,
      actionLabel: agentActionLabel(row),
      statusTag: row.status === "BLOCKED" ? "Waiting" : null,
      taskId: row.id,
    });
  }

  for (const decision of input.decisions) {
    const projectId = decision.projectId ?? "";
    items.push({
      id: `decision:${decision.id}`,
      sourceKind: "decision",
      sourceId: decision.id,
      projectId,
      projectName: decision.projectName,
      title: plainDecisionTitle(decision.title),
      detail: decision.question.slice(0, 220),
      bucket: "WAITING",
      reason: "Waiting because this needs your judgment before work can close.",
      estimateMinutes: recordedEstimateMinutes(decision.question),
      href: projectId ? `/projects/${projectId}` : "/decisions",
      actionLabel: "Review",
      statusTag: "Needs decision",
      taskId: null,
    });
  }

  for (const action of input.actions) {
    if (seenActionIds.has(action.id)) continue;
    if (action.sourceKind === "agent_task") continue;
    let bucket: DayPlanBucket = "LATER";
    if (action.requiresDecision || action.status === "BLOCKED") bucket = "WAITING";
    else if (action.priority === "HIGH" || action.status === "IN_PROGRESS") bucket = "DO_FIRST";
    else if (action.priority === "LOW") bucket = "LATER";

    items.push({
      id: `next_action:${action.id}`,
      sourceKind: "next_action",
      sourceId: action.id,
      projectId: action.projectId,
      projectName: action.projectName,
      title: action.title,
      detail: action.description.slice(0, 220),
      bucket,
      reason: explainDayPlanRecommendation(action, bucket),
      estimateMinutes: recordedEstimateMinutes(action.description),
      href: `/projects/${action.projectId}`,
      actionLabel: bucket === "WAITING" ? null : action.priority === "HIGH" ? "Open" : "Plan",
      statusTag: action.requiresDecision
        ? "Needs decision"
        : action.status === "BLOCKED"
          ? "Waiting"
          : null,
      taskId: null,
    });
  }

  return sortDayPlanItems(items);
}

function explainDayPlanRecommendation(action: TodayAction, bucket: DayPlanBucket): string {
  const base = explainTodayPriority(action);
  if (bucket === "DO_FIRST") {
    return base.endsWith(".") ? `${base.slice(0, -1)} — put this first today.` : `${base} Put this first today.`;
  }
  if (bucket === "WAITING") {
    return base.startsWith("Waiting") || base.startsWith("Blocked")
      ? base
      : `Waiting: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  }
  return `Later: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}

export function sortDayPlanItems(items: readonly DayPlanItem[]): DayPlanItem[] {
  const rank: Record<DayPlanBucket, number> = { DO_FIRST: 0, LATER: 1, WAITING: 2 };
  return [...items].sort((left, right) => {
    const bucket = rank[left.bucket] - rank[right.bucket];
    if (bucket !== 0) return bucket;
    return left.title.localeCompare(right.title);
  });
}

export function applyDayPlanPlacements(
  recommended: readonly DayPlanItem[],
  placements: readonly DayPlanPlacement[] | null | undefined,
): DayPlanItem[] {
  if (!placements || placements.length === 0) return sortDayPlanItems(recommended);
  const byId = new Map(recommended.map((item) => [item.id, item]));
  const used = new Set<string>();
  const ordered: DayPlanItem[] = [];
  for (const placement of placements) {
    const item = byId.get(placement.id);
    if (!item) continue;
    used.add(item.id);
    ordered.push({ ...item, bucket: placement.bucket });
  }
  for (const item of recommended) {
    if (used.has(item.id)) continue;
    ordered.push(item);
  }
  return ordered;
}

export function groupDayPlan(items: readonly DayPlanItem[]): Array<{
  bucket: DayPlanBucket;
  label: string;
  items: DayPlanItem[];
}> {
  return DAY_PLAN_BUCKETS.map((bucket) => ({
    bucket,
    label: dayPlanBucketLabel(bucket),
    items: items.filter((item) => item.bucket === bucket),
  })).filter((group) => group.items.length > 0);
}

export function dayPlanSummary(items: readonly DayPlanItem[]): string {
  const groups = groupDayPlan(items).length;
  const tasks = items.length;
  return `${groups} group${groups === 1 ? "" : "s"} · ${tasks} task${tasks === 1 ? "" : "s"}`;
}

export function placementsFromItems(items: readonly DayPlanItem[]): DayPlanPlacement[] {
  return items.map((item) => ({ id: item.id, bucket: item.bucket }));
}

export function moveDayPlanItem(
  items: readonly DayPlanItem[],
  itemId: string,
  direction: "up" | "down",
): DayPlanItem[] {
  const next = [...items];
  const index = next.findIndex((item) => item.id === itemId);
  if (index < 0) return next;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= next.length) return next;
  const current = next[index]!;
  const swap = next[target]!;
  if (current.bucket !== swap.bucket) {
    next[index] = { ...current, bucket: swap.bucket };
    return next;
  }
  next[index] = swap;
  next[target] = current;
  return next;
}

export function setDayPlanItemBucket(
  items: readonly DayPlanItem[],
  itemId: string,
  bucket: DayPlanBucket,
): DayPlanItem[] {
  return items.map((item) => (item.id === itemId ? { ...item, bucket } : item));
}

export type WorkerAssignmentScope =
  | { mode: "project"; projectId: string; projectName: string }
  | { mode: "plan_tasks"; itemIds: string[]; items: DayPlanItem[] };

export type WorkerAssignmentPreview = {
  mode: "project" | "plan_tasks";
  title: string;
  willReview: string[];
  willReturn: string[];
  chargeLabel: string;
  projectId: string | null;
  taskId: string | null;
  linkedItemIds: string[];
};

export function buildWorkerAssignmentPreview(input: {
  scope: WorkerAssignmentScope;
  agentTasks: readonly AgentTaskSurfaceRow[];
}): WorkerAssignmentPreview {
  const scope = input.scope;
  if (scope.mode === "project") {
    const projectId = scope.projectId;
    const task =
      input.agentTasks.find(
        (row) =>
          row.projectId === projectId &&
          ["QUEUED", "CLAIMED", "RUNNING", "CHECKPOINT", "BLOCKED"].includes(row.status),
      ) ??
      input.agentTasks.find((row) => row.projectId === projectId) ??
      null;
    return {
      mode: "project",
      title: `Review ${scope.projectName}`,
      willReview: [
        `Project: ${scope.projectName}`,
        task
          ? `Active worker task ${task.actionType} (${task.status}${
              task.checkpointSequence > 0 ? `, step ${task.checkpointSequence}` : ""
            })`
          : "No active worker task on this project yet — Ghost will not invent one.",
      ],
      willReturn: [
        "Step snapshots as the test run advances",
        "A saved test result linked to this project",
        "Plain-language status on Today and Files",
      ],
      chargeLabel: "Test run · $0 charged (MOCK, not live spend)",
      projectId,
      taskId: task?.id ?? null,
      linkedItemIds: [],
    };
  }

  const items = scope.items;
  const firstTask = items.find((item) => item.taskId)?.taskId ?? null;
  const projectId = items[0]?.projectId || null;
  return {
    mode: "plan_tasks",
    title: `Review ${items.length} item${items.length === 1 ? "" : "s"} from today's plan`,
    willReview: items.map((item) => `${item.title} · ${item.projectName}`),
    willReturn: [
      "A linked test review covering the selected plan items",
      "Step snapshots when a worker task is available",
      "Saved result openable from Today and Files",
    ],
    chargeLabel: "Test run · $0 charged (MOCK, not live spend)",
    projectId,
    taskId: firstTask,
    linkedItemIds: items.map((item) => item.id),
  };
}
