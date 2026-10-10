import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { revalidateAuthorizationForExecution } from "@/lib/approvals/workflow";
import {
  revalidateAuthorizationForTaskClaim,
  revalidateAuthorizationForTaskStep,
} from "@/lib/agent-runtime/revalidate-for-task";
import type { AgentTaskAuthorizationBinding } from "@/lib/agent-runtime/types";
import { memoryIsExecutionHalted } from "./memory-store";
import type { RemoteDevTask } from "./types";

export type GateDenial =
  | "MISSING_AUTHORIZATION"
  | "OWNER_MISMATCH"
  | "PROJECT_MISMATCH"
  | "SCOPE_MISMATCH"
  | "FINGERPRINT_MISMATCH"
  | "ENVIRONMENT_MISMATCH"
  | "PENDING"
  | "EXPIRED"
  | "REVOKED"
  | "REJECTED"
  | "NOT_APPROVED"
  | "CONSUMED"
  | "CONSUMED_WITHOUT_CLAIM"
  | "USES_EXHAUSTED"
  | "MISSING_EVIDENCE"
  | "TASK_NOT_CLAIMED"
  | "DEPLOYMENT_NOT_AUTHORIZED"
  | "BUDGET_EXCEEDED"
  | "DURATION_EXCEEDED"
  | "EXECUTION_HALTED";

export type GateResult =
  | { ok: true; shouldConsume: boolean; mode: "APPROVED" | "CONSUMED_FOR_TASK" }
  | { ok: false; reason: GateDenial; message: string };

function toAgentBinding(task: RemoteDevTask): AgentTaskAuthorizationBinding {
  return {
    authorizationId: task.binding.authorizationId,
    ownerId: task.ownerId,
    projectId: task.projectId,
    actionType: task.binding.actionType,
    actionScope: task.binding.actionScope,
    environmentLabel: task.binding.environmentLabel,
    scopeFingerprint: task.binding.scopeFingerprint,
    authorizationKind: task.binding.authorizationKind,
  };
}

function enforceBudgets(
  task: RemoteDevTask,
  options?: { estimatedCostUsd?: number | null; elapsedMs?: number },
): GateResult | null {
  if (
    options?.estimatedCostUsd != null &&
    task.spending.maxEstimatedCostUsd != null &&
    options.estimatedCostUsd > task.spending.maxEstimatedCostUsd
  ) {
    return {
      ok: false,
      reason: "BUDGET_EXCEEDED",
      message: "Estimated cost exceeds the authorized spending limit.",
    };
  }
  if (options?.elapsedMs != null && options.elapsedMs > task.duration.maxDurationMs) {
    return {
      ok: false,
      reason: "DURATION_EXCEEDED",
      message: "Elapsed duration exceeds the authorized maximum.",
    };
  }
  return null;
}

/**
 * Queue/submit boundary: authorization must be APPROVED, exact scope, not expired/revoked.
 * Development approval never grants deployment.
 */
export function gateRemoteDevQueue(
  auth: FounderActionAuthorization | null,
  task: RemoteDevTask,
  options?: { at?: string; estimatedCostUsd?: number | null; elapsedMs?: number },
): GateResult {
  if (task.deploymentAuthorized !== false) {
    return {
      ok: false,
      reason: "DEPLOYMENT_NOT_AUTHORIZED",
      message: "Development workflow refuses any deployment authorization flag.",
    };
  }
  if (task.binding.authorizationKind !== "DEVELOPMENT") {
    return {
      ok: false,
      reason: "DEPLOYMENT_NOT_AUTHORIZED",
      message: "Remote development queue requires DEVELOPMENT authorization.",
    };
  }
  if (memoryIsExecutionHalted(task.binding.authorizationId)) {
    return {
      ok: false,
      reason: "EXECUTION_HALTED",
      message: "Execution was halted after authorization consumption; refuse queue.",
    };
  }

  const claim = revalidateAuthorizationForTaskClaim(auth, toAgentBinding(task), options?.at);
  if (!claim.ok) {
    return {
      ok: false,
      reason: claim.reason as GateDenial,
      message: `Authorization gate denied queue: ${claim.reason}`,
    };
  }

  const budgetDenial = enforceBudgets(task, options);
  if (budgetDenial) return budgetDenial;

  const exec = revalidateAuthorizationForExecution(auth, {
    authorizationId: task.binding.authorizationId,
    ownerId: task.ownerId,
    projectId: task.projectId,
    actionType: task.binding.actionType,
    actionScope: task.binding.actionScope,
    environmentLabel: task.binding.environmentLabel,
    at: options?.at,
  });
  if (!exec.ok) {
    return {
      ok: false,
      reason: exec.reason as GateDenial,
      message: `Execution revalidation denied: ${exec.reason}`,
    };
  }

  return { ok: true, shouldConsume: exec.shouldConsume, mode: claim.mode };
}

/**
 * Mid-execution / recovery revalidation. CONSUMED allowed only when this task already consumed.
 * Refuses halted/cancelled/terminal tasks and re-checks duration/budget when supplied.
 */
export function gateRemoteDevStep(
  auth: FounderActionAuthorization | null,
  task: RemoteDevTask,
  options: {
    authorizationConsumed: boolean;
    at?: string;
    estimatedCostUsd?: number | null;
    elapsedMs?: number;
  },
): GateResult {
  if (
    task.status === "CANCELLED" ||
    task.status === "FAILED" ||
    task.status === "VERIFIED" ||
    memoryIsExecutionHalted(task.binding.authorizationId)
  ) {
    return {
      ok: false,
      reason: "EXECUTION_HALTED",
      message: "Step gate refuses halted or terminal task execution.",
    };
  }
  if (task.deploymentAuthorized !== false) {
    return {
      ok: false,
      reason: "DEPLOYMENT_NOT_AUTHORIZED",
      message: "Development workflow refuses any deployment authorization flag.",
    };
  }

  const budgetDenial = enforceBudgets(task, options);
  if (budgetDenial) return budgetDenial;

  const step = revalidateAuthorizationForTaskStep(
    auth,
    {
      status: options.authorizationConsumed ? "CLAIMED" : "QUEUED",
      claimedAt: options.authorizationConsumed ? (task.queuedAt ?? task.updatedAt) : null,
      authorizationConsumed: options.authorizationConsumed,
      binding: toAgentBinding(task),
    },
    options.at,
  );
  if (!step.ok) {
    return {
      ok: false,
      reason: step.reason as GateDenial,
      message: `Step gate denied: ${step.reason}`,
    };
  }
  return { ok: true, shouldConsume: false, mode: step.mode };
}

/** Elapsed wall time from task creation (fail closed on unparsable clocks). */
export function elapsedMsSinceTaskCreated(task: RemoteDevTask, at?: string): number {
  const now = Date.parse(at ?? new Date().toISOString());
  const created = Date.parse(task.createdAt);
  if (!Number.isFinite(now) || !Number.isFinite(created) || now < created) {
    return Number.POSITIVE_INFINITY;
  }
  return now - created;
}
