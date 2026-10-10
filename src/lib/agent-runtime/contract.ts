import { assertExecutionAuthorized } from "@/lib/approvals/execution-gate";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { planAuthorizationConsumption } from "./consume";
import { assertAgentExecutionDisabled } from "./execution-guard";
import {
  revalidateAuthorizationForTaskClaim,
  revalidateAuthorizationForTaskStep,
} from "./revalidate-for-task";
import {
  applyBlockToTask,
  applyCheckpointToTask,
  applyClaimToTask,
  buildCheckpoint,
  createLease,
  decideAgentTaskTransition,
  isLeaseValid,
  rejectSecretProgressRef,
} from "./workflow";
import type {
  AgentTask,
  AgentTaskAuditEvent,
  AgentTaskCheckpoint,
  AgentTaskStepRequest,
  ClaimAgentTaskRequest,
} from "./types";
import { bindingToRevalidationRequest } from "./types";
import { randomUUID } from "node:crypto";

export type ClaimResult =
  | {
      ok: true;
      task: AgentTask;
      shouldConsume: boolean;
      /** Planned CAS consumption for durable persistence (null when idempotent reclaim). */
      consumePlan: ReturnType<typeof planAuthorizationConsumption> | null;
      audit: AgentTaskAuditEvent;
      idempotent: boolean;
    }
  | {
      ok: false;
      reason: string;
      message: string;
      task: AgentTask | null;
      audit: AgentTaskAuditEvent | null;
    };

export type StepResult =
  | {
      ok: true;
      task: AgentTask;
      checkpoint: AgentTaskCheckpoint | null;
      audit: AgentTaskAuditEvent;
      idempotent: boolean;
    }
  | {
      ok: false;
      reason: string;
      message: string;
      task: AgentTask | null;
      audit: AgentTaskAuditEvent | null;
    };

function auditEvent(input: {
  taskId: string;
  eventType: string;
  detail: string;
  authorizationId: string;
  scopeFingerprint: string;
  actorId: string | null;
  at?: string;
}): AgentTaskAuditEvent {
  return {
    id: randomUUID(),
    taskId: input.taskId,
    eventType: input.eventType,
    detail: input.detail.slice(0, 4000),
    authorizationId: input.authorizationId,
    scopeFingerprint: input.scopeFingerprint,
    actorId: input.actorId,
    createdAt: input.at ?? new Date().toISOString(),
  };
}

/**
 * Revalidate founder authorization before claiming a queued task.
 * On success, plans atomic one-time consumption (CAS on status+use_count).
 * Does not start workers — execution remains disabled.
 */
export function claimAgentTaskWithRevalidation(
  task: AgentTask,
  authorization: FounderActionAuthorization | null,
  request: ClaimAgentTaskRequest,
): ClaimResult {
  assertAgentExecutionDisabled();

  if (task.ownerId !== request.ownerId) {
    return {
      ok: false,
      reason: "OWNER_MISMATCH",
      message: "Caller is not the owning founder for this agent task.",
      task,
      audit: null,
    };
  }

  const at = request.at ?? new Date().toISOString();

  // Idempotent reclaim: same holder + token on already CLAIMED with valid lease.
  if (
    task.status === "CLAIMED" &&
    isLeaseValid(task.lease, {
      holderId: request.claimantId,
      token: request.leaseToken,
      at,
    })
  ) {
    return {
      ok: true,
      task,
      shouldConsume: false,
      consumePlan: null,
      idempotent: true,
      audit: auditEvent({
        taskId: task.id,
        eventType: "CLAIM_IDEMPOTENT",
        detail: "Claim replayed with valid lease — no state change.",
        authorizationId: task.binding.authorizationId,
        scopeFingerprint: task.binding.scopeFingerprint,
        actorId: request.claimantId,
        at,
      }),
    };
  }

  const claimCheck = revalidateAuthorizationForTaskClaim(authorization, task.binding, at);
  if (!claimCheck.ok) {
    const blocked = applyBlockToTask(task, claimCheck.reason, at);
    return {
      ok: false,
      reason: claimCheck.reason,
      message: `Authorization revalidation failed: ${claimCheck.reason}`,
      task: blocked,
      audit: auditEvent({
        taskId: task.id,
        eventType: "CLAIM_BLOCKED",
        detail: `Claim denied: ${claimCheck.reason}`,
        authorizationId: task.binding.authorizationId,
        scopeFingerprint: task.binding.scopeFingerprint,
        actorId: request.claimantId,
        at,
      }),
    };
  }

  const gate = assertExecutionAuthorized(
    authorization,
    bindingToRevalidationRequest(task.binding, at),
  );
  if (!gate.ok) {
    const blocked = applyBlockToTask(task, gate.message, at);
    return {
      ok: false,
      reason: gate.reason,
      message: gate.message,
      task: blocked,
      audit: auditEvent({
        taskId: task.id,
        eventType: "CLAIM_BLOCKED",
        detail: `${gate.reason}: ${gate.message}`,
        authorizationId: task.binding.authorizationId,
        scopeFingerprint: task.binding.scopeFingerprint,
        actorId: request.claimantId,
        at,
      }),
    };
  }

  const consumePlan = planAuthorizationConsumption({
    authorizationId: task.binding.authorizationId,
    observedStatus: authorization!.status,
    observedUseCount: authorization!.useCount,
    reusePolicy: authorization!.reusePolicy,
    maxUses: authorization!.maxUses,
  });
  if (!consumePlan.ok && gate.shouldConsume) {
    const blocked = applyBlockToTask(task, consumePlan.reason, at);
    return {
      ok: false,
      reason: consumePlan.reason,
      message: `Atomic consumption plan failed: ${consumePlan.reason}`,
      task: blocked,
      audit: auditEvent({
        taskId: task.id,
        eventType: "CLAIM_BLOCKED",
        detail: `Consume plan denied: ${consumePlan.reason}`,
        authorizationId: task.binding.authorizationId,
        scopeFingerprint: task.binding.scopeFingerprint,
        actorId: request.claimantId,
        at,
      }),
    };
  }

  const transition = decideAgentTaskTransition(task, {
    ownerId: request.ownerId,
    toStatus: "CLAIMED",
    detail: "Claimed after authorization revalidation.",
  });
  if (!transition.ok) {
    return {
      ok: false,
      reason: "ILLEGAL_TRANSITION",
      message: transition.reason,
      task,
      audit: null,
    };
  }

  const lease = createLease({
    holderId: request.claimantId,
    token: request.leaseToken,
    at,
    ttlMs: request.leaseTtlMs,
  });
  const willConsume = gate.shouldConsume && consumePlan.ok;
  const claimed = applyClaimToTask(task, lease, at, {
    authorizationConsumed: willConsume,
  });

  return {
    ok: true,
    task: claimed,
    shouldConsume: willConsume,
    consumePlan: consumePlan.ok ? consumePlan : null,
    idempotent: transition.idempotent,
    audit: auditEvent({
      taskId: task.id,
      eventType: "CLAIMED",
      detail: `Claimed by ${request.claimantId}; shouldConsume=${willConsume}.`,
      authorizationId: task.binding.authorizationId,
      scopeFingerprint: task.binding.scopeFingerprint,
      actorId: request.claimantId,
      at,
    }),
  };
}

/**
 * Revalidate founder authorization before every execution step / checkpoint.
 * Expired or revoked approval stops future execution (task → BLOCKED).
 * One-time CONSUMED auth is allowed only when this task recorded consumption at claim.
 */
export function executeAgentTaskStepWithRevalidation(
  task: AgentTask,
  authorization: FounderActionAuthorization | null,
  request: AgentTaskStepRequest,
): StepResult {
  assertAgentExecutionDisabled();

  if (task.ownerId !== request.ownerId) {
    return {
      ok: false,
      reason: "OWNER_MISMATCH",
      message: "Caller is not the owning founder for this agent task.",
      task,
      audit: null,
    };
  }

  const at = request.at ?? new Date().toISOString();
  const progressRef = request.progressRef ?? request.stepLabel;
  const secretCheck = rejectSecretProgressRef(progressRef);
  if (!secretCheck.ok) {
    return {
      ok: false,
      reason: "SECRET_IN_PROGRESS_REF",
      message: secretCheck.reason,
      task,
      audit: null,
    };
  }

  if (
    !isLeaseValid(task.lease, {
      holderId: request.claimantId,
      token: request.leaseToken,
      at,
    })
  ) {
    return {
      ok: false,
      reason: "LEASE_INVALID",
      message: "Agent-task lease is missing, mismatched, or expired.",
      task,
      audit: auditEvent({
        taskId: task.id,
        eventType: "STEP_LEASE_DENIED",
        detail: "Lease invalid for step execution.",
        authorizationId: task.binding.authorizationId,
        scopeFingerprint: task.binding.scopeFingerprint,
        actorId: request.claimantId,
        at,
      }),
    };
  }

  if (
    request.stepIdempotencyKey &&
    task.lastStepIdempotencyKey === request.stepIdempotencyKey &&
    (task.status === "CHECKPOINT" || task.status === "RUNNING")
  ) {
    return {
      ok: true,
      task,
      checkpoint: null,
      idempotent: true,
      audit: auditEvent({
        taskId: task.id,
        eventType: "STEP_IDEMPOTENT",
        detail: `Step ${request.stepIdempotencyKey} already applied.`,
        authorizationId: task.binding.authorizationId,
        scopeFingerprint: task.binding.scopeFingerprint,
        actorId: request.claimantId,
        at,
      }),
    };
  }

  const stepCheck = revalidateAuthorizationForTaskStep(authorization, task, at);
  if (!stepCheck.ok) {
    const blocked = applyBlockToTask(task, stepCheck.reason, at);
    return {
      ok: false,
      reason: stepCheck.reason,
      message: `Authorization revalidation failed: ${stepCheck.reason}`,
      task: blocked,
      audit: auditEvent({
        taskId: task.id,
        eventType: "STEP_BLOCKED",
        detail: `Step denied: ${stepCheck.reason}`,
        authorizationId: task.binding.authorizationId,
        scopeFingerprint: task.binding.scopeFingerprint,
        actorId: request.claimantId,
        at,
      }),
    };
  }

  if (task.status !== "CLAIMED" && task.status !== "RUNNING" && task.status !== "CHECKPOINT") {
    return {
      ok: false,
      reason: "ILLEGAL_TRANSITION",
      message: `Cannot execute a step from status ${task.status}.`,
      task,
      audit: null,
    };
  }

  let working = task;
  if (task.status === "CLAIMED") {
    const toRunning = decideAgentTaskTransition(task, {
      ownerId: request.ownerId,
      toStatus: "RUNNING",
      detail: "First step after claim.",
    });
    if (!toRunning.ok) {
      return {
        ok: false,
        reason: "ILLEGAL_TRANSITION",
        message: toRunning.reason,
        task,
        audit: null,
      };
    }
    working = { ...task, status: "RUNNING", updatedAt: at };
  }

  const checkpoint = buildCheckpoint({
    taskId: working.id,
    sequence: working.checkpointSequence + 1,
    label: request.stepLabel,
    progressRef,
    binding: working.binding,
    at,
  });

  const next: AgentTask = {
    ...applyCheckpointToTask(working, checkpoint, at),
    lastStepIdempotencyKey: request.stepIdempotencyKey.trim().slice(0, 200),
    blockReason: "",
  };

  return {
    ok: true,
    task: next,
    checkpoint,
    idempotent: false,
    audit: auditEvent({
      taskId: task.id,
      eventType: "STEP_CHECKPOINT",
      detail: `Step ${request.stepLabel} checkpoint ${checkpoint.sequence}; mode=${stepCheck.mode}.`,
      authorizationId: task.binding.authorizationId,
      scopeFingerprint: task.binding.scopeFingerprint,
      actorId: request.claimantId,
      at,
    }),
  };
}

/**
 * Mark task SUCCEEDED only after a final revalidation.
 * One-time approvals should already have been consumed at claim when shouldConsume was true.
 */
export function completeAgentTaskWithRevalidation(
  task: AgentTask,
  authorization: FounderActionAuthorization | null,
  request: {
    ownerId: string;
    claimantId: string;
    leaseToken: string;
    at?: string;
  },
): StepResult {
  assertAgentExecutionDisabled();
  const at = request.at ?? new Date().toISOString();

  if (task.ownerId !== request.ownerId) {
    return {
      ok: false,
      reason: "OWNER_MISMATCH",
      message: "Caller is not the owning founder for this agent task.",
      task,
      audit: null,
    };
  }

  if (task.status === "SUCCEEDED") {
    return {
      ok: true,
      task,
      checkpoint: null,
      idempotent: true,
      audit: auditEvent({
        taskId: task.id,
        eventType: "COMPLETE_IDEMPOTENT",
        detail: "Task already succeeded.",
        authorizationId: task.binding.authorizationId,
        scopeFingerprint: task.binding.scopeFingerprint,
        actorId: request.claimantId,
        at,
      }),
    };
  }

  if (
    !isLeaseValid(task.lease, {
      holderId: request.claimantId,
      token: request.leaseToken,
      at,
    })
  ) {
    return {
      ok: false,
      reason: "LEASE_INVALID",
      message: "Agent-task lease is missing, mismatched, or expired.",
      task,
      audit: null,
    };
  }

  const stepCheck = revalidateAuthorizationForTaskStep(authorization, task, at);
  if (!stepCheck.ok) {
    const blocked = applyBlockToTask(task, stepCheck.reason, at);
    return {
      ok: false,
      reason: stepCheck.reason,
      message: `Authorization revalidation failed: ${stepCheck.reason}`,
      task: blocked,
      audit: auditEvent({
        taskId: task.id,
        eventType: "COMPLETE_BLOCKED",
        detail: `Complete denied: ${stepCheck.reason}`,
        authorizationId: task.binding.authorizationId,
        scopeFingerprint: task.binding.scopeFingerprint,
        actorId: request.claimantId,
        at,
      }),
    };
  }

  let working: AgentTask = task;
  if (task.status === "CHECKPOINT") {
    working = { ...task, status: "RUNNING", updatedAt: at, blockReason: "" };
  }

  const finalTransition = decideAgentTaskTransition(working, {
    ownerId: request.ownerId,
    toStatus: "SUCCEEDED",
    detail: "Completed after final authorization revalidation.",
  });
  if (!finalTransition.ok) {
    return {
      ok: false,
      reason: "ILLEGAL_TRANSITION",
      message: finalTransition.reason,
      task,
      audit: null,
    };
  }

  const completed: AgentTask = {
    ...working,
    status: "SUCCEEDED",
    lease: null,
    blockReason: "",
    completedAt: at,
    updatedAt: at,
  };

  return {
    ok: true,
    task: completed,
    checkpoint: null,
    idempotent: finalTransition.idempotent,
    audit: auditEvent({
      taskId: task.id,
      eventType: "SUCCEEDED",
      detail: `Task succeeded; auth mode=${stepCheck.mode}.`,
      authorizationId: task.binding.authorizationId,
      scopeFingerprint: task.binding.scopeFingerprint,
      actorId: request.claimantId,
      at,
    }),
  };
}
