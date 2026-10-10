import { randomUUID } from "node:crypto";
import { getAgentExecutionGuard } from "./execution-guard";
import type { AgentTask } from "./types";

/**
 * Remote-worker queue foundation (Build 09.8).
 * Execution remains disabled by default — enqueue is durable bookkeeping only.
 */

export const WORKER_QUEUE_ITEM_STATUSES = [
  "PENDING",
  "LEASED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTER",
] as const;

export type WorkerQueueItemStatus = (typeof WORKER_QUEUE_ITEM_STATUSES)[number];

export type DurableWorkerError = {
  code: string;
  message: string;
  retryable: boolean;
  at: string;
  attempt: number;
};

export type WorkerQueueItem = {
  id: string;
  taskId: string;
  ownerId: string;
  projectId: string;
  status: WorkerQueueItemStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  leasedBy: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  lastError: DurableWorkerError | null;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueResult =
  | { ok: true; item: WorkerQueueItem; executionEnabled: false }
  | { ok: false; reason: string; message: string };

export function enqueueAgentTask(
  task: Pick<AgentTask, "id" | "ownerId" | "projectId" | "status">,
  options?: { priority?: number; maxAttempts?: number; at?: string },
): EnqueueResult {
  const guard = getAgentExecutionGuard();
  if (guard.enabled) {
    return {
      ok: false,
      reason: "EXECUTION_UNEXPECTEDLY_ENABLED",
      message: "Queue refuses to operate while execution guard is enabled in this build.",
    };
  }
  if (task.status !== "QUEUED" && task.status !== "BLOCKED") {
    // Allow QUEUED (new work) and BLOCKED-for-retry after recovery rebind.
    // CLAIMED/RUNNING belong to an active lease path, not fresh enqueue.
  }
  if (task.status === "SUCCEEDED" || task.status === "CANCELLED" || task.status === "FAILED") {
    return {
      ok: false,
      reason: "TERMINAL_TASK",
      message: `Cannot enqueue a ${task.status} task.`,
    };
  }

  const at = options?.at ?? new Date().toISOString();
  return {
    ok: true,
    executionEnabled: false,
    item: {
      id: randomUUID(),
      taskId: task.id,
      ownerId: task.ownerId,
      projectId: task.projectId,
      status: "PENDING",
      priority: options?.priority ?? 100,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      availableAt: at,
      leasedBy: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
      createdAt: at,
      updatedAt: at,
    },
  };
}

export function leaseQueueItem(
  item: WorkerQueueItem,
  workerId: string,
  leaseToken: string,
  options?: { ttlMs?: number; at?: string },
): { ok: true; item: WorkerQueueItem } | { ok: false; reason: string } {
  const at = options?.at ?? new Date().toISOString();
  if (item.status !== "PENDING" && item.status !== "FAILED") {
    return { ok: false, reason: "NOT_LEASEABLE" };
  }
  if (Date.parse(item.availableAt) > Date.parse(at)) {
    return { ok: false, reason: "NOT_AVAILABLE_YET" };
  }
  if (item.attempts >= item.maxAttempts) {
    return { ok: false, reason: "MAX_ATTEMPTS" };
  }
  const ttl = options?.ttlMs ?? 15 * 60 * 1000;
  return {
    ok: true,
    item: {
      ...item,
      status: "LEASED",
      attempts: item.attempts + 1,
      leasedBy: workerId,
      leaseToken,
      leaseExpiresAt: new Date(Date.parse(at) + ttl).toISOString(),
      updatedAt: at,
    },
  };
}

/** Workers must not run jobs — activation stays disabled. */
export function activateQueuedWorker(_item: WorkerQueueItem): never {
  void _item;
  throw new Error("WORKER_ACTIVATION_DISABLED: remote workers remain off by default (Build 09.8).");
}
