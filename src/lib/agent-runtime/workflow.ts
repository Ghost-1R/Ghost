import { createHash, randomUUID } from "node:crypto";
import type {
  AgentTask,
  AgentTaskAuthorizationBinding,
  AgentTaskCheckpoint,
  AgentTaskLease,
  AgentTaskStatus,
  CreateAgentTaskInput,
} from "./types";
import { bindAgentTaskAuthorization } from "./binding";

export const LEGAL_AGENT_TASK_TRANSITIONS: Record<AgentTaskStatus, readonly AgentTaskStatus[]> = {
  QUEUED: ["CLAIMED", "CANCELLED", "BLOCKED"],
  CLAIMED: ["RUNNING", "CANCELLED", "BLOCKED", "QUEUED"],
  RUNNING: ["CHECKPOINT", "SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED"],
  CHECKPOINT: ["RUNNING", "CANCELLED", "BLOCKED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  BLOCKED: ["QUEUED"], // recovery only after fresh authorization rebind
};

export function canTransitionAgentTask(from: AgentTaskStatus, to: AgentTaskStatus): boolean {
  return LEGAL_AGENT_TASK_TRANSITIONS[from].includes(to);
}

export function isTerminalAgentTaskStatus(status: AgentTaskStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

export function isActiveAgentTaskStatus(status: AgentTaskStatus): boolean {
  return status === "QUEUED" || status === "CLAIMED" || status === "RUNNING" || status === "CHECKPOINT";
}

export type TransitionDecision =
  | { ok: true; nextStatus: AgentTaskStatus; idempotent: boolean; eventType: string; detail: string }
  | { ok: false; reason: string };

/**
 * Idempotent state transition.
 * Same from→to when already at `to` returns idempotent success (no-op).
 */
export function decideAgentTaskTransition(
  task: Pick<AgentTask, "status" | "ownerId">,
  input: {
    ownerId: string;
    toStatus: AgentTaskStatus;
    detail?: string;
  },
): TransitionDecision {
  if (task.ownerId !== input.ownerId) {
    return { ok: false, reason: "Only the owning founder can transition this agent task." };
  }
  if (task.status === input.toStatus) {
    return {
      ok: true,
      nextStatus: input.toStatus,
      idempotent: true,
      eventType: "TRANSITION_IDEMPOTENT",
      detail: input.detail?.trim() || `Already ${input.toStatus}.`,
    };
  }
  if (!canTransitionAgentTask(task.status, input.toStatus)) {
    return {
      ok: false,
      reason: `Illegal agent-task transition ${task.status} → ${input.toStatus}.`,
    };
  }
  return {
    ok: true,
    nextStatus: input.toStatus,
    idempotent: false,
    eventType: `TRANSITION_${input.toStatus}`,
    detail: input.detail?.trim() || `Transitioned to ${input.toStatus}.`,
  };
}

export const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;

export function createLease(input: {
  holderId: string;
  token: string;
  at?: string;
  ttlMs?: number;
}): AgentTaskLease {
  const now = Date.parse(input.at ?? new Date().toISOString());
  const ttl = input.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  return {
    holderId: input.holderId,
    token: input.token,
    expiresAt: new Date(now + ttl).toISOString(),
  };
}

export function isLeaseValid(
  lease: AgentTaskLease | null,
  input: { holderId: string; token: string; at?: string },
): boolean {
  if (!lease) return false;
  if (lease.holderId !== input.holderId) return false;
  if (lease.token !== input.token) return false;
  const now = Date.parse(input.at ?? new Date().toISOString());
  const expires = Date.parse(lease.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expires)) return false;
  return now < expires;
}

export function leaseFingerprint(lease: AgentTaskLease): string {
  return createHash("sha256")
    .update(`${lease.holderId}|${lease.token}|${lease.expiresAt}`)
    .digest("hex");
}

export type CreateTaskResult =
  | { ok: true; task: AgentTask }
  | { ok: false; reason: string; message: string };

/**
 * Create a QUEUED agent task bound to a validated founder authorization.
 * Does not claim, execute, or consume the authorization.
 */
export function createBoundAgentTask(input: CreateAgentTaskInput & { taskId?: string }): CreateTaskResult {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.trim().length < 8) {
    return { ok: false, reason: "INVALID_IDEMPOTENCY_KEY", message: "Idempotency key must be at least 8 characters." };
  }

  const bound = bindAgentTaskAuthorization({
    authorization: input.authorization,
    ownerId: input.ownerId,
    projectId: input.projectId,
    actionType: input.actionType,
    actionScope: input.actionScope,
    environmentLabel: input.environmentLabel,
    authorizationKind: input.authorizationKind,
    at: input.at,
  });
  if (!bound.ok) {
    return { ok: false, reason: bound.reason, message: bound.message };
  }

  const now = input.at ?? new Date().toISOString();
  return {
    ok: true,
    task: {
      id: input.taskId ?? randomUUID(),
      ownerId: input.ownerId,
      projectId: input.projectId,
      status: "QUEUED",
      binding: bound.binding,
      lease: null,
      checkpointSequence: 0,
      lastCheckpointId: null,
      lastStepIdempotencyKey: "",
      idempotencyKey: input.idempotencyKey.trim(),
      blockReason: "",
      authorizationConsumed: false,
      createdAt: now,
      updatedAt: now,
      claimedAt: null,
      completedAt: null,
    },
  };
}

export function applyClaimToTask(
  task: AgentTask,
  lease: AgentTaskLease,
  at: string,
  options?: { authorizationConsumed?: boolean },
): AgentTask {
  return {
    ...task,
    status: "CLAIMED",
    lease,
    claimedAt: task.claimedAt ?? at,
    updatedAt: at,
    blockReason: "",
    authorizationConsumed: options?.authorizationConsumed ?? task.authorizationConsumed,
  };
}

export function applyBlockToTask(task: AgentTask, reason: string, at: string): AgentTask {
  return {
    ...task,
    status: "BLOCKED",
    lease: null,
    blockReason: reason.slice(0, 2000),
    updatedAt: at,
  };
}

export function applyCheckpointToTask(
  task: AgentTask,
  checkpoint: AgentTaskCheckpoint,
  at: string,
): AgentTask {
  return {
    ...task,
    status: "CHECKPOINT",
    checkpointSequence: checkpoint.sequence,
    lastCheckpointId: checkpoint.id,
    updatedAt: at,
  };
}

export function buildCheckpoint(input: {
  taskId: string;
  sequence: number;
  label: string;
  progressRef: string;
  binding: AgentTaskAuthorizationBinding;
  at?: string;
}): AgentTaskCheckpoint {
  const createdAt = input.at ?? new Date().toISOString();
  return {
    id: randomUUID(),
    sequence: input.sequence,
    label: input.label.trim().slice(0, 200),
    progressRef: input.progressRef.trim().slice(0, 500),
    createdAt,
    authorizationId: input.binding.authorizationId,
    scopeFingerprint: input.binding.scopeFingerprint,
  };
}

/** Reject secret-looking progress refs — credentials must never enter task records. */
export function rejectSecretProgressRef(progressRef: string): { ok: true } | { ok: false; reason: string } {
  const value = progressRef.trim();
  if (!value) return { ok: true };
  if (
    /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|Bearer\s+)/i.test(
      value,
    )
  ) {
    return { ok: false, reason: "Progress references must not contain credentials or API keys." };
  }
  return { ok: true };
}
