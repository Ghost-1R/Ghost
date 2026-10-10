import { transitionRemoteDevTask } from "./contract";
import type { RemoteDevTask, RemoteProviderStatusEvent } from "./types";

/**
 * Reconcile remote provider status into task state — fail closed on ambiguity.
 * Never grants deployment permission.
 */
export function reconcileRemoteStatus(
  task: RemoteDevTask,
  event: RemoteProviderStatusEvent,
  options?: { ownerId?: string; at?: string },
): { ok: true; task: RemoteDevTask } | { ok: false; reason: string; message: string } {
  if (options?.ownerId && options.ownerId !== task.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: "Owner mismatch on reconcile." };
  }
  if (!task.externalJobId || task.externalJobId !== event.externalJobId) {
    return {
      ok: false,
      reason: "JOB_IDENTITY_MISMATCH",
      message: "External job identity does not match the bound task.",
    };
  }
  if (event.providerKind !== task.providerKind) {
    return {
      ok: false,
      reason: "PROVIDER_MISMATCH",
      message: "Provider kind does not match the task binding.",
    };
  }

  const at = options?.at ?? event.occurredAt;
  switch (event.status) {
    case "QUEUED": {
      const next = transitionRemoteDevTask(task, "QUEUED", { ownerId: task.ownerId, at });
      return next.ok
        ? { ok: true, task: next.task }
        : { ok: false, reason: "ILLEGAL_TRANSITION", message: next.reason };
    }
    case "RUNNING": {
      let working = task;
      if (task.status === "AWAITING_APPROVAL") {
        const queued = transitionRemoteDevTask(task, "QUEUED", { ownerId: task.ownerId, at });
        if (!queued.ok) return { ok: false, reason: "ILLEGAL_TRANSITION", message: queued.reason };
        working = queued.task;
      }
      const next = transitionRemoteDevTask(working, "RUNNING", { ownerId: task.ownerId, at });
      return next.ok
        ? { ok: true, task: next.task }
        : { ok: false, reason: "ILLEGAL_TRANSITION", message: next.reason };
    }
    case "SUCCEEDED": {
      const next = transitionRemoteDevTask(task, "AWAITING_FOUNDER_REVIEW", {
        ownerId: task.ownerId,
        at,
      });
      return next.ok
        ? { ok: true, task: next.task }
        : { ok: false, reason: "ILLEGAL_TRANSITION", message: next.reason };
    }
    case "FAILED":
    case "TIMEOUT": {
      const next = transitionRemoteDevTask(task, "FAILED", { ownerId: task.ownerId, at });
      if (!next.ok) return { ok: false, reason: "ILLEGAL_TRANSITION", message: next.reason };
      return {
        ok: true,
        task: {
          ...next.task,
          lastError: {
            code: event.status,
            message: event.detail.slice(0, 2000),
            retryable: event.status === "TIMEOUT",
            at,
          },
        },
      };
    }
    case "CANCELLED": {
      const next = transitionRemoteDevTask(task, "CANCELLED", { ownerId: task.ownerId, at });
      return next.ok
        ? { ok: true, task: next.task }
        : { ok: false, reason: "ILLEGAL_TRANSITION", message: next.reason };
    }
    default:
      return {
        ok: false,
        reason: "AMBIGUOUS_STATUS",
        message: "Unrecognized remote status — fail closed.",
      };
  }
}
