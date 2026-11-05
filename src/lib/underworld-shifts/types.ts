export const UNDERWORLD_SHIFT_JOB_STATUSES = [
  "QUEUED",
  "WORKING",
  "BLOCKED",
  "AWAITING_APPROVAL",
  "COMPLETE",
  "FAILED",
  "CANCELLED",
] as const;

export type UnderworldShiftJobStatus = (typeof UNDERWORLD_SHIFT_JOB_STATUSES)[number];

export const UNDERWORLD_SHIFT_WORKFLOWS = ["BUILD_PLAN_REVIEW"] as const;
export type UnderworldShiftWorkflow = (typeof UNDERWORLD_SHIFT_WORKFLOWS)[number];

export const DEFAULT_SHIFT_TIMEZONE = "America/New_York";
export const DEFAULT_SHIFT_WEEKDAYS = [1, 2, 3, 4, 5] as const; // Mon–Fri (JS getUTCDay style after TZ parts)
export const DEFAULT_SHIFT_START_HOUR = 9;
export const DEFAULT_SHIFT_END_HOUR = 17;

export const BUILD_PLAN_REVIEW_ACTION_TYPE = "agent_task.inspect";
export const BUILD_PLAN_REVIEW_STEPS = 4;

export type ShiftEvidenceLink = {
  label: string;
  href: string;
};

export type UnderworldShiftJob = {
  id: string;
  ownerId: string;
  companyId: string;
  projectId: string;
  workflow: UnderworldShiftWorkflow;
  status: UnderworldShiftJobStatus;
  idempotencyKey: string;
  authorizationId: string | null;
  agentTaskId: string | null;
  buildPlanId: string | null;
  checkpointStep: number;
  checkpointLabel: string;
  resultFingerprint: string | null;
  reviewSummary: string;
  evidence: ShiftEvidenceLink[];
  blockReason: string;
  leaseHolderId: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  timezone: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
