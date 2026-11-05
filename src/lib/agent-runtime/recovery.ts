import type { AgentTask, AgentTaskCheckpoint } from "./types";
import type { DurableWorkerError, WorkerQueueItem } from "./queue";

/**
 * Recovery foundation (Build 09.8).
 * Restores work from checkpoints / expired leases without activating workers.
 */

export type RecoveryPlan =
  | {
      ok: true;
      action: "RESUME_FROM_CHECKPOINT" | "REQUEUE" | "DEAD_LETTER" | "NOOP";
      nextTaskStatus: AgentTask["status"] | null;
      nextQueueStatus: WorkerQueueItem["status"] | null;
      detail: string;
    }
  | { ok: false; reason: string; detail: string };

export function recordDurableError(input: {
  code: string;
  message: string;
  retryable: boolean;
  attempt: number;
  at?: string;
}): DurableWorkerError {
  return {
    code: input.code.trim().slice(0, 80) || "UNKNOWN",
    message: input.message.trim().slice(0, 2000),
    retryable: input.retryable,
    attempt: input.attempt,
    at: input.at ?? new Date().toISOString(),
  };
}

export function planRecoveryFromExpiredLease(input: {
  task: AgentTask;
  queueItem: WorkerQueueItem;
  lastCheckpoint: AgentTaskCheckpoint | null;
  at?: string;
}): RecoveryPlan {
  const at = input.at ?? new Date().toISOString();
  const leaseExpired =
    input.queueItem.leaseExpiresAt != null &&
    Date.parse(input.queueItem.leaseExpiresAt) <= Date.parse(at);

  if (!leaseExpired && input.queueItem.status === "LEASED") {
    return {
      ok: true,
      action: "NOOP",
      nextTaskStatus: null,
      nextQueueStatus: null,
      detail: "Lease still valid — no recovery needed.",
    };
  }

  if (input.task.status === "SUCCEEDED" || input.task.status === "CANCELLED") {
    return {
      ok: true,
      action: "NOOP",
      nextTaskStatus: null,
      nextQueueStatus: "SUCCEEDED",
      detail: "Task already terminal.",
    };
  }

  if (input.queueItem.attempts >= input.queueItem.maxAttempts) {
    const error = recordDurableError({
      code: "MAX_ATTEMPTS_EXCEEDED",
      message: "Queue item exceeded max attempts after lease expiry.",
      retryable: false,
      attempt: input.queueItem.attempts,
      at,
    });
    void error;
    return {
      ok: true,
      action: "DEAD_LETTER",
      nextTaskStatus: "FAILED",
      nextQueueStatus: "DEAD_LETTER",
      detail: "Moved to dead letter after max attempts.",
    };
  }

  if (input.lastCheckpoint || input.task.checkpointSequence > 0) {
    return {
      ok: true,
      action: "RESUME_FROM_CHECKPOINT",
      nextTaskStatus: "CHECKPOINT",
      nextQueueStatus: "PENDING",
      detail: `Resume from checkpoint sequence ${input.task.checkpointSequence}.`,
    };
  }

  return {
    ok: true,
    action: "REQUEUE",
    nextTaskStatus: "QUEUED",
    nextQueueStatus: "PENDING",
    detail: "Requeue task with cleared lease for retry.",
  };
}

export function applyQueueFailure(
  item: WorkerQueueItem,
  error: DurableWorkerError,
  options?: { backoffMs?: number; at?: string },
): WorkerQueueItem {
  const at = options?.at ?? new Date().toISOString();
  const dead = item.attempts >= item.maxAttempts || !error.retryable;
  const backoff = options?.backoffMs ?? Math.min(60_000, 1000 * 2 ** Math.max(0, item.attempts - 1));
  return {
    ...item,
    status: dead ? "DEAD_LETTER" : "FAILED",
    leasedBy: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastError: error,
    availableAt: dead ? at : new Date(Date.parse(at) + backoff).toISOString(),
    updatedAt: at,
  };
}

export function clearTaskLeaseForRecovery(task: AgentTask, at?: string): AgentTask {
  return {
    ...task,
    lease: null,
    status: task.checkpointSequence > 0 ? "CHECKPOINT" : "QUEUED",
    updatedAt: at ?? new Date().toISOString(),
    blockReason: "",
  };
}
