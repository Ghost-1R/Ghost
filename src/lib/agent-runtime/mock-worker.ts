/**
 * Bounded MOCK worker turn — deterministic, no provider HTTP, no LIVE spend.
 * Resume only from the last checkpoint. Uncertain external effects are not replayed.
 */

import { randomUUID } from "node:crypto";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { parseCodegenScopeFragment } from "@/lib/codegen/request-contract";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import {
  claimAgentTaskWithRevalidation,
  completeAgentTaskWithRevalidation,
  executeAgentTaskStepWithRevalidation,
} from "./contract";
import { getAgentExecutionGuard } from "./execution-guard";
import type { AgentTask } from "./types";

export const MOCK_WORKER_ID = "ghost-mock-worker";
export const MOCK_WORKER_MAX_STEPS = 4;

export type MockWorkerTurn =
  | {
      ok: true;
      mode: "MOCK_GENERATION";
      task: AgentTask;
      stepLabel: string;
      completed: boolean;
      liveHttpInvoked: false;
      chargedCents: 0;
    }
  | {
      ok: false;
      reason: string;
      message: string;
      liveHttpInvoked: false;
    };

function refusePaid(scope: string | undefined): MockWorkerTurn | null {
  if (isCodegenLiveEnabled()) {
    return {
      ok: false,
      reason: "LIVE_FLAG_ON",
      message: "Mock worker refuses to run while GHOST_CODEGEN_LIVE_ENABLED=1.",
      liveHttpInvoked: false,
    };
  }
  const contract = scope ? parseCodegenScopeFragment(scope) : null;
  if (contract?.dispatch === "LIVE") {
    return {
      ok: false,
      reason: "DISPATCH_LIVE",
      message: "Mock worker will not execute a LIVE dispatch fingerprint.",
      liveHttpInvoked: false,
    };
  }
  return null;
}

export function runBoundedMockWorkerTurn(input: {
  task: AgentTask;
  authorization: FounderActionAuthorization | null;
  ownerId: string;
  at?: string;
}): MockWorkerTurn {
  const paid = refusePaid(input.task.binding.actionScope);
  if (paid) return paid;

  const guard = getAgentExecutionGuard();
  if (guard.enabled) {
    return {
      ok: false,
      reason: "EXECUTION_GUARD",
      message: guard.detail,
      liveHttpInvoked: false,
    };
  }

  const at = input.at ?? new Date().toISOString();
  const leaseToken = input.task.lease?.token || `mock-${randomUUID()}`;

  let working = input.task;
  if (working.status === "QUEUED" || working.status === "BLOCKED") {
    const claimed = claimAgentTaskWithRevalidation(working, input.authorization, {
      taskId: working.id,
      ownerId: input.ownerId,
      claimantId: MOCK_WORKER_ID,
      leaseToken,
      at,
    });
    if (!claimed.ok) {
      return { ok: false, reason: claimed.reason, message: claimed.message, liveHttpInvoked: false };
    }
    working = claimed.task;
  }

  const nextSequence = working.checkpointSequence + 1;
  if (nextSequence > MOCK_WORKER_MAX_STEPS) {
    return completeMock(working, input.authorization, leaseToken, at);
  }

  const stepped = executeAgentTaskStepWithRevalidation(working, input.authorization, {
    taskId: working.id,
    ownerId: input.ownerId,
    claimantId: MOCK_WORKER_ID,
    leaseToken,
    stepIdempotencyKey: `mock-step-${working.id}-${nextSequence}`,
    stepLabel: `mock-step-${nextSequence}`,
    progressRef: `checkpoint:${working.id}:${nextSequence}`,
    at,
  });
  if (!stepped.ok) {
    return { ok: false, reason: stepped.reason, message: stepped.message, liveHttpInvoked: false };
  }

  if (nextSequence < MOCK_WORKER_MAX_STEPS) {
    return {
      ok: true,
      mode: "MOCK_GENERATION",
      task: stepped.task,
      stepLabel: stepped.checkpoint?.label ?? `mock-step-${nextSequence}`,
      completed: false,
      liveHttpInvoked: false,
      chargedCents: 0,
    };
  }

  return completeMock(stepped.task, input.authorization, leaseToken, at);
}

function completeMock(
  task: AgentTask,
  authorization: FounderActionAuthorization | null,
  leaseToken: string,
  at: string,
): MockWorkerTurn {
  const done = completeAgentTaskWithRevalidation(task, authorization, {
    ownerId: task.ownerId,
    claimantId: MOCK_WORKER_ID,
    leaseToken,
    at,
  });
  if (!done.ok) {
    return { ok: false, reason: done.reason, message: done.message, liveHttpInvoked: false };
  }
  return {
    ok: true,
    mode: "MOCK_GENERATION",
    task: done.task,
    stepLabel: "bounded-complete",
    completed: true,
    liveHttpInvoked: false,
    chargedCents: 0,
  };
}
