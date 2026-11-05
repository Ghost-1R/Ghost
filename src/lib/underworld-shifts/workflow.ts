import { createHash } from "node:crypto";
import type { UnderworldShiftJob, UnderworldShiftJobStatus } from "./types";

export const LEGAL_SHIFT_JOB_TRANSITIONS: Record<
  UnderworldShiftJobStatus,
  readonly UnderworldShiftJobStatus[]
> = {
  AWAITING_APPROVAL: ["QUEUED", "CANCELLED", "BLOCKED"],
  QUEUED: ["WORKING", "CANCELLED", "BLOCKED", "AWAITING_APPROVAL"],
  WORKING: ["QUEUED", "COMPLETE", "FAILED", "BLOCKED", "CANCELLED"],
  BLOCKED: ["QUEUED", "AWAITING_APPROVAL", "CANCELLED"],
  COMPLETE: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionShiftJob(
  from: UnderworldShiftJobStatus,
  to: UnderworldShiftJobStatus,
): boolean {
  return LEGAL_SHIFT_JOB_TRANSITIONS[from].includes(to);
}

export function buildPlanReviewScope(projectId: string): string {
  return `underworld_shift_review|workflow:BUILD_PLAN_REVIEW|project:${projectId}|mode:read_only`;
}

export function buildPlanReviewIdempotencyKey(projectId: string, buildPlanId: string): string {
  return `uw-shift-bpr-${projectId.slice(0, 8)}-${buildPlanId.slice(0, 8)}`;
}

export function fingerprintReviewResult(input: {
  projectId: string;
  buildPlanId: string;
  summary: string;
  evidenceHrefs: readonly string[];
  /** Scopes uniqueness per queued job so retries collide but new runs do not. */
  idempotencyKey: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.idempotencyKey.trim(),
        input.projectId,
        input.buildPlanId,
        input.summary.trim(),
        ...[...input.evidenceHrefs].map((h) => h.trim()).sort(),
      ].join("|"),
    )
    .digest("hex");
}

export type ShiftTransitionDecision =
  | { ok: true; next: UnderworldShiftJobStatus; idempotent: boolean }
  | { ok: false; reason: string };

export function decideShiftJobTransition(
  job: Pick<UnderworldShiftJob, "status">,
  to: UnderworldShiftJobStatus,
): ShiftTransitionDecision {
  if (job.status === to) return { ok: true, next: to, idempotent: true };
  if (!canTransitionShiftJob(job.status, to)) {
    return { ok: false, reason: `Illegal shift-job transition ${job.status} → ${to}.` };
  }
  return { ok: true, next: to, idempotent: false };
}

/** Promote AWAITING_APPROVAL → QUEUED once founder auth is APPROVED. */
export function decideReleaseAfterApproval(input: {
  jobStatus: UnderworldShiftJobStatus;
  authorizationStatus: string;
}): ShiftTransitionDecision {
  if (input.jobStatus !== "AWAITING_APPROVAL") {
    return { ok: false, reason: "Job is not awaiting approval." };
  }
  if (input.authorizationStatus !== "APPROVED") {
    return { ok: false, reason: "Authorization is not APPROVED." };
  }
  return { ok: true, next: "QUEUED", idempotent: false };
}
