export const ACTION_PRIORITIES = ["HIGH", "NORMAL", "LOW"] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

export const ACTION_PROVENANCES = ["FACT", "RECOMMENDATION", "FOUNDER_APPROVED_ACTION"] as const;
export type ActionProvenance = (typeof ACTION_PROVENANCES)[number];

export const OPERATING_ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const;
export type OperatingActionStatus = (typeof OPERATING_ACTION_STATUSES)[number];

export type TodayAction = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status: OperatingActionStatus;
  priority: ActionPriority;
  provenance: ActionProvenance;
  requiresDecision: boolean;
  sourceKind: string;
};

const PRIORITY_RANK: Record<ActionPriority, number> = {
  HIGH: 0,
  NORMAL: 1,
  LOW: 2,
};

/** Deterministic attention order. AI may explain this list; it must not secretly reorder it. */
export function prioritizeTodayActions(actions: readonly TodayAction[]): TodayAction[] {
  return [...actions]
    .filter((action) => action.status === "OPEN" || action.status === "IN_PROGRESS" || action.status === "BLOCKED")
    .sort((left, right) => {
      const decision = Number(right.requiresDecision) - Number(left.requiresDecision);
      if (decision !== 0) return decision;
      const blocked = Number(right.status === "BLOCKED") - Number(left.status === "BLOCKED");
      if (blocked !== 0) return blocked;
      const priority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
      if (priority !== 0) return priority;
      const active = Number(right.status === "IN_PROGRESS") - Number(left.status === "IN_PROGRESS");
      if (active !== 0) return active;
      return left.title.localeCompare(right.title);
    });
}

export function explainTodayPriority(action: TodayAction): string {
  if (action.requiresDecision) return "Waiting on a founder decision.";
  if (action.status === "BLOCKED") return "Blocked work.";
  if (action.priority === "HIGH") return "Explicitly high priority.";
  if (action.status === "IN_PROGRESS") return "Currently active work.";
  return "Open next action.";
}

export function isAuthoritativeAction(action: Pick<TodayAction, "provenance">): boolean {
  return action.provenance === "FACT" || action.provenance === "FOUNDER_APPROVED_ACTION";
}
