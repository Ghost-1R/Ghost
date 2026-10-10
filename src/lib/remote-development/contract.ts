import { randomUUID } from "node:crypto";
import { assertAuthorizationKindCompatible } from "@/lib/agent-runtime/authorization-kind";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import type {
  CreateRemoteDevTaskInput,
  RemoteDevTask,
  RemoteDevTaskStatus,
} from "./types";

export type ContractDenial =
  | "MISSING_OWNER"
  | "MISSING_PROJECT"
  | "MISSING_OBJECTIVE"
  | "MISSING_AUTHORIZATION"
  | "AMBIGUOUS_SCOPE"
  | "FINGERPRINT_MISMATCH"
  | "KIND_MISMATCH"
  | "DEPLOYMENT_NOT_AUTHORIZED"
  | "DEVELOPMENT_NOT_AUTHORIZED"
  | "UNKNOWN_ACTION_TYPE"
  | "MISSING_REPOSITORY"
  | "MISSING_BASE_BRANCH"
  | "INVALID_LIMITS"
  | "INVALID_IDEMPOTENCY"
  | "CLIENT_CANNOT_SELF_AUTHORIZE";

export type ContractResult =
  | { ok: true; task: RemoteDevTask }
  | { ok: false; reason: ContractDenial; message: string };

const AMBIGUOUS_SCOPE = /^(do something|fix it|improve|whatever|as needed|tbd|todo)\b/i;

/**
 * Create a remote development task bound to founder authorization identity.
 * Browser/model text cannot grant permissions — authorizationId + fingerprint required.
 */
export function createRemoteDevTask(input: CreateRemoteDevTaskInput): ContractResult {
  if (!input.ownerId.trim()) {
    return { ok: false, reason: "MISSING_OWNER", message: "Owner identity is required." };
  }
  if (!input.projectId.trim()) {
    return { ok: false, reason: "MISSING_PROJECT", message: "Project identity is required." };
  }
  if (!input.objective.trim() || input.objective.trim().length < 8) {
    return { ok: false, reason: "MISSING_OBJECTIVE", message: "A concrete development objective is required." };
  }
  if (!input.authorizationId.trim()) {
    return {
      ok: false,
      reason: "MISSING_AUTHORIZATION",
      message: "Founder authorization binding is required. Models and browsers cannot self-authorize.",
    };
  }
  if (!input.actionType.trim() || !input.actionScope.trim()) {
    return { ok: false, reason: "AMBIGUOUS_SCOPE", message: "Exact action type and scope are required." };
  }
  if (AMBIGUOUS_SCOPE.test(input.actionScope.trim()) || input.actionScope.trim().length < 4) {
    return { ok: false, reason: "AMBIGUOUS_SCOPE", message: "Action scope is too ambiguous." };
  }
  if (!input.idempotencyKey.trim() || input.idempotencyKey.trim().length < 8) {
    return { ok: false, reason: "INVALID_IDEMPOTENCY", message: "Idempotency key must be at least 8 characters." };
  }
  if (!input.repository.trim() || !input.repository.includes("/")) {
    return { ok: false, reason: "MISSING_REPOSITORY", message: "Git repository owner/name is required." };
  }
  if (!input.approvedBaseBranch.trim()) {
    return { ok: false, reason: "MISSING_BASE_BRANCH", message: "Approved base branch is required." };
  }

  const kindCheck = assertAuthorizationKindCompatible(input.authorizationKind, input.actionType);
  if (!kindCheck.ok) {
    return { ok: false, reason: kindCheck.reason, message: `Authorization kind rejected: ${kindCheck.reason}` };
  }
  if (input.authorizationKind === "DEPLOYMENT") {
    return {
      ok: false,
      reason: "DEPLOYMENT_NOT_AUTHORIZED",
      message: "Remote development tasks require DEVELOPMENT authorization; deployment is separate.",
    };
  }

  const environmentLabel = (input.environmentLabel ?? "REMOTE_DEV").trim() || "REMOTE_DEV";
  const expectedFp = scopeFingerprint({
    projectId: input.projectId,
    actionType: input.actionType,
    actionScope: input.actionScope,
    environmentLabel,
  });
  if (input.scopeFingerprint !== expectedFp) {
    return {
      ok: false,
      reason: "FINGERPRINT_MISMATCH",
      message: "Scope fingerprint does not match the exact action identity.",
    };
  }

  const maxDurationMs = input.maxDurationMs ?? 60 * 60 * 1000;
  if (!Number.isFinite(maxDurationMs) || maxDurationMs < 60_000 || maxDurationMs > 24 * 60 * 60 * 1000) {
    return { ok: false, reason: "INVALID_LIMITS", message: "Duration limit must be between 1 minute and 24 hours." };
  }
  if (
    input.maxEstimatedCostUsd != null &&
    (!Number.isFinite(input.maxEstimatedCostUsd) || input.maxEstimatedCostUsd < 0 || input.maxEstimatedCostUsd > 500)
  ) {
    return { ok: false, reason: "INVALID_LIMITS", message: "Spending limit is out of allowed range." };
  }

  const at = input.at ?? new Date().toISOString();
  const task: RemoteDevTask = {
    id: randomUUID(),
    ownerId: input.ownerId.trim(),
    projectId: input.projectId.trim(),
    projectName: (input.projectName ?? "Project").trim() || "Project",
    objective: input.objective.trim().slice(0, 4000),
    status: "AWAITING_APPROVAL",
    binding: {
      authorizationId: input.authorizationId.trim(),
      authorizationKind: input.authorizationKind,
      actionType: input.actionType.trim(),
      actionScope: input.actionScope.trim(),
      environmentLabel,
      scopeFingerprint: expectedFp,
    },
    spending: {
      maxEstimatedCostUsd: input.maxEstimatedCostUsd ?? null,
      currency: "USD",
    },
    duration: { maxDurationMs },
    git: {
      repository: input.repository.trim(),
      approvedBaseBranch: input.approvedBaseBranch.trim(),
      baseCommitSha: input.baseCommitSha?.trim() || null,
      taskBranch: null,
    },
    providerKind: "FAKE",
    externalJobId: null,
    agentTaskId: null,
    requiresIndependentReview: input.requiresIndependentReview !== false,
    deploymentAuthorized: false,
    checkpoints: [],
    lastError: null,
    evidence: null,
    idempotencyKey: input.idempotencyKey.trim(),
    createdAt: at,
    updatedAt: at,
    queuedAt: null,
    startedAt: null,
    completedAt: null,
  };

  return { ok: true, task };
}

/** Browser/model text can never approve or authorize. */
export function promptOrClientCannotAuthorize(_text: string): true {
  void _text;
  return true;
}

export const LEGAL_REMOTE_DEV_TRANSITIONS: Record<
  RemoteDevTaskStatus,
  readonly RemoteDevTaskStatus[]
> = {
  AWAITING_APPROVAL: ["QUEUED", "CANCELLED", "BLOCKED"],
  QUEUED: ["RUNNING", "CANCELLED", "BLOCKED", "FAILED"],
  RUNNING: ["AWAITING_FOUNDER_REVIEW", "FAILED", "BLOCKED", "CANCELLED"],
  BLOCKED: ["QUEUED", "CANCELLED", "FAILED"],
  FAILED: ["QUEUED", "CANCELLED"],
  AWAITING_FOUNDER_REVIEW: ["VERIFIED", "FAILED", "CANCELLED"],
  VERIFIED: [],
  CANCELLED: [],
};

export function canTransitionRemoteDevTask(
  from: RemoteDevTaskStatus,
  to: RemoteDevTaskStatus,
): boolean {
  return LEGAL_REMOTE_DEV_TRANSITIONS[from].includes(to);
}

export function transitionRemoteDevTask(
  task: RemoteDevTask,
  to: RemoteDevTaskStatus,
  options?: { ownerId: string; detail?: string; at?: string },
): { ok: true; task: RemoteDevTask; idempotent: boolean } | { ok: false; reason: string } {
  if (options?.ownerId && options.ownerId !== task.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH" };
  }
  if (task.status === to) {
    return { ok: true, task, idempotent: true };
  }
  if (!canTransitionRemoteDevTask(task.status, to)) {
    return { ok: false, reason: `Illegal transition ${task.status} → ${to}` };
  }
  const at = options?.at ?? new Date().toISOString();
  const next: RemoteDevTask = {
    ...task,
    status: to,
    updatedAt: at,
    queuedAt: to === "QUEUED" ? (task.queuedAt ?? at) : task.queuedAt,
    startedAt: to === "RUNNING" ? (task.startedAt ?? at) : task.startedAt,
    completedAt:
      to === "VERIFIED" || to === "FAILED" || to === "CANCELLED" ? at : task.completedAt,
  };
  void options?.detail;
  return { ok: true, task: next, idempotent: false };
}
