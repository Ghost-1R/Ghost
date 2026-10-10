import type { ExecutionRevalidationRequest, FounderActionAuthorization } from "@/lib/approvals/types";

/** Explicit authorization classes — development never implies deployment. */
export const AGENT_AUTHORIZATION_KINDS = ["DEVELOPMENT", "DEPLOYMENT"] as const;
export type AgentAuthorizationKind = (typeof AGENT_AUTHORIZATION_KINDS)[number];

/**
 * Canonical agent-task action types.
 * Unknown action types fail closed (cannot bind or claim).
 */
export const DEVELOPMENT_ACTION_TYPES = [
  "agent_task.develop",
  "agent_task.implement",
  "agent_task.refactor",
  "agent_task.test",
  "agent_task.inspect",
] as const;

export const DEPLOYMENT_ACTION_TYPES = [
  "agent_task.deploy",
  "agent_task.release",
] as const;

export const AGENT_TASK_STATUSES = [
  "QUEUED",
  "CLAIMED",
  "RUNNING",
  "CHECKPOINT",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "BLOCKED",
] as const;

export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];

/** Durable binding between an agent task and a founder authorization. */
export type AgentTaskAuthorizationBinding = {
  authorizationId: string;
  ownerId: string;
  projectId: string;
  actionType: string;
  actionScope: string;
  environmentLabel: string;
  scopeFingerprint: string;
  authorizationKind: AgentAuthorizationKind;
};

export type AgentTaskLease = {
  holderId: string;
  token: string;
  expiresAt: string;
};

export type AgentTaskCheckpoint = {
  id: string;
  sequence: number;
  label: string;
  /** Opaque non-secret progress marker — never credentials. */
  progressRef: string;
  createdAt: string;
  authorizationId: string;
  scopeFingerprint: string;
};

export type AgentTask = {
  id: string;
  ownerId: string;
  projectId: string;
  status: AgentTaskStatus;
  binding: AgentTaskAuthorizationBinding;
  lease: AgentTaskLease | null;
  checkpointSequence: number;
  lastCheckpointId: string | null;
  /** Last successfully applied step idempotency key — enables retry without double progress. */
  lastStepIdempotencyKey: string;
  idempotencyKey: string;
  blockReason: string;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
};

export type AgentTaskAuditEvent = {
  id: string;
  taskId: string;
  eventType: string;
  detail: string;
  authorizationId: string;
  scopeFingerprint: string;
  actorId: string | null;
  createdAt: string;
};

export type CreateAgentTaskInput = {
  ownerId: string;
  projectId: string;
  authorization: FounderActionAuthorization;
  authorizationKind: AgentAuthorizationKind;
  actionType: string;
  actionScope: string;
  environmentLabel?: string;
  idempotencyKey: string;
  at?: string;
};

export type ClaimAgentTaskRequest = {
  taskId: string;
  ownerId: string;
  claimantId: string;
  leaseToken: string;
  leaseTtlMs?: number;
  at?: string;
  /** When true, record one-time / final bounded consumption after successful claim. */
  recordConsumption?: boolean;
};

export type AgentTaskStepRequest = {
  taskId: string;
  ownerId: string;
  claimantId: string;
  leaseToken: string;
  stepIdempotencyKey: string;
  stepLabel: string;
  /** Non-secret progress reference (commit SHA, path, checkpoint label). */
  progressRef?: string;
  at?: string;
};

export type AgentTaskTransitionRequest = {
  taskId: string;
  ownerId: string;
  fromStatus: AgentTaskStatus;
  toStatus: AgentTaskStatus;
  actorId: string;
  leaseToken?: string;
  idempotencyKey: string;
  detail?: string;
  at?: string;
};

/** Revalidation payload derived from a bound task — never invented by a worker. */
export function bindingToRevalidationRequest(
  binding: AgentTaskAuthorizationBinding,
  at?: string,
): ExecutionRevalidationRequest {
  return {
    authorizationId: binding.authorizationId,
    ownerId: binding.ownerId,
    projectId: binding.projectId,
    actionType: binding.actionType,
    actionScope: binding.actionScope,
    environmentLabel: binding.environmentLabel,
    at,
  };
}
