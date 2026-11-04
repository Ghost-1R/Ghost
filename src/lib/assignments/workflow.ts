import type { AssignmentKind, AssignmentStatus } from "@/lib/access/types";
import { describeMapScope, type MapScope } from "@/lib/assignments/types";

export const AI_CHARGE_LABEL = "Ghost AI test run · $0 charged (MOCK, not live spend)";

export type ReviewDecision = "APPROVE" | "REQUEST_CHANGES";

const PROGRESS_FROM: ReadonlySet<AssignmentStatus> = new Set(["ASSIGNED", "IN_PROGRESS"]);
const SUBMIT_FROM: ReadonlySet<AssignmentStatus> = new Set(["ASSIGNED", "IN_PROGRESS"]);
const REVIEW_FROM: ReadonlySet<AssignmentStatus> = new Set(["SUBMITTED", "IN_REVIEW"]);
const HANDOFF_FROM: ReadonlySet<AssignmentStatus> = new Set([
  "SUBMITTED",
  "IN_REVIEW",
  "COMPLETED",
]);

export function canUpdateProgress(status: AssignmentStatus): boolean {
  return PROGRESS_FROM.has(status);
}

export function canSubmitForReview(status: AssignmentStatus): boolean {
  return SUBMIT_FROM.has(status);
}

export function canCompleteReview(status: AssignmentStatus): boolean {
  return REVIEW_FROM.has(status);
}

/** An AI result may be handed to a person once it has been submitted. */
export function canHandOff(kind: AssignmentKind, status: AssignmentStatus): boolean {
  return kind === "AI" && HANDOFF_FROM.has(status);
}

export function nextStatusAfterReview(decision: ReviewDecision): AssignmentStatus {
  return decision === "APPROVE" ? "COMPLETED" : "IN_PROGRESS";
}

export type AssignmentTextCheck =
  | { ok: true; title: string; instructions: string; dueAt: string | null }
  | { ok: false; error: string };

export function validateAssignmentText(input: {
  title: string;
  instructions: string;
  dueAt?: string | null;
  now?: Date;
}): AssignmentTextCheck {
  const title = input.title.trim();
  const instructions = input.instructions.trim();
  if (title.length < 1 || title.length > 200) {
    return { ok: false, error: "Give the assignment a title (up to 200 characters)." };
  }
  if (instructions.length > 8000) {
    return { ok: false, error: "Instructions are too long (8000 characters max)." };
  }
  let dueAt: string | null = null;
  const rawDue = input.dueAt?.trim();
  if (rawDue) {
    const parsed = new Date(rawDue);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Due date is not a valid date." };
    }
    dueAt = parsed.toISOString();
  }
  return { ok: true, title, instructions, dueAt };
}

export type AssignmentPanelPreview = {
  heading: string;
  lines: string[];
  chargeLabel: string | null;
};

export function buildAssignmentPanelPreview(input: {
  kind: AssignmentKind;
  projectName: string;
  taskTitle: string | null;
  title: string;
  instructions: string;
  dueAt: string | null;
  assigneeLabel: string | null;
  mapScope: MapScope | null;
}): AssignmentPanelPreview {
  const lines = [
    `Project: ${input.projectName || "—"}`,
    input.taskTitle ? `Task: ${input.taskTitle}` : "Task: none linked",
    input.kind === "HUMAN"
      ? `Assignee: ${input.assigneeLabel ?? "Choose a team member"}`
      : "Assignee: Ghost AI (test run)",
    input.dueAt && input.kind === "HUMAN" ? `Due: ${input.dueAt}` : null,
    input.mapScope ? `Area: ${describeMapScope(input.mapScope)} (aggregates only)` : null,
    input.instructions.trim()
      ? `Instructions: ${input.instructions.trim().slice(0, 240)}${
          input.instructions.trim().length > 240 ? "…" : ""
        }`
      : "Instructions: none yet",
  ].filter((line): line is string => line !== null);

  return {
    heading: input.title.trim() || (input.kind === "HUMAN" ? "Assign to teammate" : "Assign to Ghost AI"),
    lines,
    chargeLabel: input.kind === "AI" ? AI_CHARGE_LABEL : null,
  };
}
