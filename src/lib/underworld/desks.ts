import type { AgentTaskStatus } from "@/lib/agent-runtime/types";
import type { AssignmentStatus } from "@/lib/access/types";

/** Visible monitor cue for a desk — derived from saved Ghost records only. */
export type DeskActivity = "active" | "idle" | "blocked" | "awaiting_approval";

export type DeskMonitorSnapshot = {
  activity: DeskActivity;
  taskTitle: string | null;
  runStatus: string | null;
  assignmentStatus: string | null;
  checkpointSequence: number | null;
  checkpointLabel: string;
  blockReason: string;
  evidenceHref: string | null;
  runHref: string | null;
  workHref: string | null;
  updatedAt: string | null;
};

export function deskMonitorActivity(input: {
  assignmentStatus?: AssignmentStatus | string | null;
  taskStatus?: AgentTaskStatus | string | null;
  blockReason?: string | null;
}): DeskActivity {
  const block = (input.blockReason ?? "").trim();
  if (block || input.taskStatus === "BLOCKED") return "blocked";
  if (
    input.assignmentStatus === "IN_REVIEW" ||
    input.assignmentStatus === "SUBMITTED"
  ) {
    return "awaiting_approval";
  }
  if (
    input.taskStatus === "RUNNING" ||
    input.taskStatus === "CLAIMED" ||
    input.taskStatus === "CHECKPOINT"
  ) {
    return "active";
  }
  return "idle";
}

export function deskActivityLabel(activity: DeskActivity): string {
  switch (activity) {
    case "active":
      return "Run in progress";
    case "blocked":
      return "Blocked";
    case "awaiting_approval":
      return "Awaiting approval";
    default:
      return "Idle";
  }
}

/**
 * Simulated crew desks. Office placement is scene-only.
 * Real work is attached later from founder-scoped assignment/run rows.
 */
export const UNDERWORLD_CREW = [
  {
    id: "atlas",
    name: "Atlas",
    role: "Planner",
    office: "engineering",
    after: "gym",
  },
  {
    id: "nova",
    name: "Nova",
    role: "Builder",
    office: "engineering",
    after: "restaurant",
  },
  {
    id: "reed",
    name: "Reed",
    role: "Specialist",
    office: "team",
    after: "homes",
  },
  {
    id: "sage",
    name: "Sage",
    role: "Reviewer",
    office: "review",
    after: "homes",
  },
] as const;

export type UnderworldCrewId = (typeof UNDERWORLD_CREW)[number]["id"];

export function preferredCrewForDepartment(
  department: "planning" | "engineering" | "review" | "team",
  kind?: string,
): UnderworldCrewId {
  if (department === "review") return "sage";
  // Reed stays available as the intentionally unassigned Team Office desk.
  if (department === "team") return "reed";
  if (kind === "AI") return "nova";
  // Human / planning work shares the Engineering floor with Nova (Atlas desk).
  return "atlas";
}
