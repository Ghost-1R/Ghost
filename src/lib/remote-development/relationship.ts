import type { AgentTask, AgentTaskStatus } from "@/lib/agent-runtime/types";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { effectiveAuthorizationStatus } from "@/lib/approvals/workflow";
import type { RemoteDevTask, RemoteDevTaskStatus } from "./types";

/**
 * Build 09.13 — task relationship without a third task system.
 *
 * remote_development_tasks owns founder orchestration:
 *   objectives, git target, budget/duration, provider job, founder review.
 *
 * agent_tasks owns execution mechanics:
 *   leases, checkpoints, recovery, step evidence, worker queue (still disabled).
 *
 * founder_action_authorizations owns approval lifecycle / consumption.
 */

export const STATUS_OWNERSHIP = {
  authorizationLifecycle: "founder_action_authorizations",
  orchestrationAndReview: "remote_development_tasks",
  executionLeasesCheckpoints: "agent_tasks",
  workerQueue: "agent_worker_queue",
} as const;

/** Which table may lawfully write each high-level concern. */
export const STATUS_TRANSITION_OWNERS = {
  authorizationPendingApprovedRevokedConsumed: "founder_action_authorizations",
  remoteAwaitingApprovalQueuedRunningReviewVerifiedCancelled: "remote_development_tasks",
  agentQueuedClaimedRunningCheckpointSucceededFailedBlocked: "agent_tasks",
} as const;

export type RelationshipDenial =
  | "OWNER_MISMATCH"
  | "PROJECT_MISMATCH"
  | "AUTHORIZATION_MISMATCH"
  | "KIND_MISMATCH"
  | "ORPHAN_LINK"
  | "REASSIGN_FORBIDDEN"
  | "DEPLOYMENT_NOT_AUTHORIZED";

/**
 * Pure validation for linking a remote-dev orchestration row to an agent execution row.
 * DB trigger enforces the same rules when schema is applied.
 */
export function assertRemoteDevAgentLinkAllowed(
  remote: Pick<RemoteDevTask, "ownerId" | "projectId" | "binding" | "agentTaskId" | "deploymentAuthorized">,
  agent: Pick<AgentTask, "id" | "ownerId" | "projectId" | "binding">,
): { ok: true } | { ok: false; reason: RelationshipDenial; message: string } {
  if (remote.deploymentAuthorized !== false) {
    return {
      ok: false,
      reason: "DEPLOYMENT_NOT_AUTHORIZED",
      message: "Development orchestration refuses deployment authorization.",
    };
  }
  if (remote.binding.authorizationKind !== "DEVELOPMENT") {
    return {
      ok: false,
      reason: "KIND_MISMATCH",
      message: "Remote development requires DEVELOPMENT authorization kind.",
    };
  }
  if (agent.binding.authorizationKind !== "DEVELOPMENT") {
    return {
      ok: false,
      reason: "KIND_MISMATCH",
      message: "Cannot link remote development to a DEPLOYMENT agent task.",
    };
  }
  if (remote.ownerId !== agent.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: "Owner mismatch prevents agent_task link." };
  }
  if (remote.projectId !== agent.projectId) {
    return {
      ok: false,
      reason: "PROJECT_MISMATCH",
      message: "Project mismatch prevents agent_task link.",
    };
  }
  if (remote.binding.authorizationId !== agent.binding.authorizationId) {
    return {
      ok: false,
      reason: "AUTHORIZATION_MISMATCH",
      message: "Authorization mismatch prevents agent_task link.",
    };
  }
  if (remote.binding.scopeFingerprint !== agent.binding.scopeFingerprint) {
    return {
      ok: false,
      reason: "AUTHORIZATION_MISMATCH",
      message: "Scope fingerprint mismatch prevents agent_task link.",
    };
  }
  if (remote.agentTaskId && remote.agentTaskId !== agent.id) {
    return {
      ok: false,
      reason: "REASSIGN_FORBIDDEN",
      message: "agent_task_id cannot be reassigned once bound.",
    };
  }
  return { ok: true };
}

/**
 * Read-only progress hint from agent execution into remote-dev display.
 * Does not write remote-dev status — orchestration remains the source of review truth.
 */
export function suggestRemoteProgressFromAgent(
  agentStatus: AgentTaskStatus,
): Extract<RemoteDevTaskStatus, "QUEUED" | "RUNNING" | "BLOCKED" | "FAILED" | "AWAITING_FOUNDER_REVIEW" | "CANCELLED"> {
  switch (agentStatus) {
    case "QUEUED":
      return "QUEUED";
    case "CLAIMED":
    case "RUNNING":
    case "CHECKPOINT":
      return "RUNNING";
    case "BLOCKED":
      return "BLOCKED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "SUCCEEDED":
      return "AWAITING_FOUNDER_REVIEW";
    default:
      return "BLOCKED";
  }
}

/**
 * Whether an agent terminal/progress signal may advance remote-dev orchestration.
 * Founder VERIFIED remains remote-dev-owned and never auto-applied from agent success.
 */
export function canApplyAgentProgressToRemoteDev(
  remoteStatus: RemoteDevTaskStatus,
  suggested: RemoteDevTaskStatus,
): boolean {
  if (remoteStatus === "VERIFIED" || remoteStatus === "CANCELLED") return false;
  if (suggested === "VERIFIED") return false;
  if (remoteStatus === "AWAITING_APPROVAL") return false;
  return true;
}

export function authorizationSupportsRemoteDev(
  auth: FounderActionAuthorization | null,
  remote: Pick<RemoteDevTask, "ownerId" | "projectId" | "binding">,
  at?: string,
): { ok: true; effective: string } | { ok: false; reason: string; message: string } {
  if (!auth) {
    return { ok: false, reason: "MISSING_AUTHORIZATION", message: "Durable authorization is required." };
  }
  if (auth.ownerId !== remote.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: "Authorization owner mismatch." };
  }
  if (auth.projectId !== remote.projectId) {
    return { ok: false, reason: "PROJECT_MISMATCH", message: "Authorization project mismatch." };
  }
  if (auth.id !== remote.binding.authorizationId) {
    return { ok: false, reason: "AUTHORIZATION_MISMATCH", message: "Authorization id mismatch." };
  }
  if (auth.scopeFingerprint !== remote.binding.scopeFingerprint) {
    return { ok: false, reason: "SCOPE_MISMATCH", message: "Scope fingerprint mismatch." };
  }
  const effective = effectiveAuthorizationStatus(auth.status, auth.expiresAt, at);
  return { ok: true, effective };
}
