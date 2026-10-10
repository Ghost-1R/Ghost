import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { effectiveAuthorizationStatus, scopeFingerprint } from "@/lib/approvals/workflow";
import type { AgentTask, AgentTaskAuthorizationBinding } from "./types";

export type TaskRevalidationDenial =
  | "MISSING_AUTHORIZATION"
  | "OWNER_MISMATCH"
  | "PROJECT_MISMATCH"
  | "ENVIRONMENT_MISMATCH"
  | "SCOPE_MISMATCH"
  | "FINGERPRINT_MISMATCH"
  | "EXPIRED"
  | "REVOKED"
  | "REJECTED"
  | "PENDING"
  | "NOT_APPROVED"
  | "CONSUMED_WITHOUT_CLAIM"
  | "USES_EXHAUSTED"
  | "MISSING_EVIDENCE"
  | "TASK_NOT_CLAIMED";

export type TaskRevalidationResult =
  | { ok: true; mode: "APPROVED" | "CONSUMED_FOR_TASK" }
  | { ok: false; reason: TaskRevalidationDenial };

function matchIdentity(
  auth: FounderActionAuthorization,
  binding: AgentTaskAuthorizationBinding,
): TaskRevalidationDenial | null {
  if (auth.ownerId !== binding.ownerId) return "OWNER_MISMATCH";
  if (auth.projectId !== binding.projectId) return "PROJECT_MISMATCH";
  if (!auth.reason.trim() || !Array.isArray(auth.evidence)) return "MISSING_EVIDENCE";
  if (auth.environmentLabel.trim() !== binding.environmentLabel.trim()) return "ENVIRONMENT_MISMATCH";
  if (
    auth.actionType.trim() !== binding.actionType.trim() ||
    auth.actionScope.trim() !== binding.actionScope.trim()
  ) {
    return "SCOPE_MISMATCH";
  }
  const expected = scopeFingerprint({
    projectId: binding.projectId,
    actionType: binding.actionType,
    actionScope: binding.actionScope,
    environmentLabel: binding.environmentLabel,
  });
  if (auth.scopeFingerprint !== expected || binding.scopeFingerprint !== expected) {
    return "FINGERPRINT_MISMATCH";
  }
  return null;
}

/**
 * Claim-time revalidation — authorization must still be APPROVED.
 * One-time consumption is recorded after a successful claim (optimistic lock).
 */
export function revalidateAuthorizationForTaskClaim(
  auth: FounderActionAuthorization | null,
  binding: AgentTaskAuthorizationBinding,
  at?: string,
): TaskRevalidationResult {
  if (!auth) return { ok: false, reason: "MISSING_AUTHORIZATION" };
  const identity = matchIdentity(auth, binding);
  if (identity) return { ok: false, reason: identity };

  const effective = effectiveAuthorizationStatus(auth.status, auth.expiresAt, at);
  if (effective === "EXPIRED") return { ok: false, reason: "EXPIRED" };
  if (auth.status === "REVOKED" || effective === "REVOKED") return { ok: false, reason: "REVOKED" };
  if (auth.status === "REJECTED") return { ok: false, reason: "REJECTED" };
  if (auth.status === "PENDING") return { ok: false, reason: "PENDING" };
  if (auth.status === "CONSUMED") return { ok: false, reason: "CONSUMED_WITHOUT_CLAIM" };
  if (auth.status !== "APPROVED" || effective !== "APPROVED") {
    return { ok: false, reason: "NOT_APPROVED" };
  }
  if (auth.reusePolicy === "ONE_TIME" && auth.useCount >= 1) {
    return { ok: false, reason: "USES_EXHAUSTED" };
  }
  if (auth.reusePolicy === "BOUNDED" && auth.maxUses != null && auth.useCount >= auth.maxUses) {
    return { ok: false, reason: "USES_EXHAUSTED" };
  }
  return { ok: true, mode: "APPROVED" };
}

/**
 * Step/complete revalidation after claim.
 * - REVOKED / EXPIRED always stop future execution.
 * - APPROVED continues (bounded reuse).
 * - CONSUMED is allowed only when this task already claimed and recorded consumption
 *   (one-time approval consumed at claim must not strand an in-flight task).
 * - CONSUMED without a prior claim on this task fails closed.
 */
export function revalidateAuthorizationForTaskStep(
  auth: FounderActionAuthorization | null,
  task: Pick<AgentTask, "status" | "claimedAt" | "authorizationConsumed" | "binding">,
  at?: string,
): TaskRevalidationResult {
  if (!auth) return { ok: false, reason: "MISSING_AUTHORIZATION" };
  const identity = matchIdentity(auth, task.binding);
  if (identity) return { ok: false, reason: identity };

  if (!task.claimedAt || task.status === "QUEUED") {
    return { ok: false, reason: "TASK_NOT_CLAIMED" };
  }

  const effective = effectiveAuthorizationStatus(auth.status, auth.expiresAt, at);
  if (effective === "EXPIRED") return { ok: false, reason: "EXPIRED" };
  if (auth.status === "REVOKED" || effective === "REVOKED") return { ok: false, reason: "REVOKED" };
  if (auth.status === "REJECTED") return { ok: false, reason: "REJECTED" };
  if (auth.status === "PENDING") return { ok: false, reason: "PENDING" };

  if (auth.status === "APPROVED" && effective === "APPROVED") {
    if (auth.reusePolicy === "BOUNDED" && auth.maxUses != null && auth.useCount >= auth.maxUses) {
      return { ok: false, reason: "USES_EXHAUSTED" };
    }
    return { ok: true, mode: "APPROVED" };
  }

  if (auth.status === "CONSUMED") {
    if (!task.authorizationConsumed) {
      return { ok: false, reason: "CONSUMED_WITHOUT_CLAIM" };
    }
    return { ok: true, mode: "CONSUMED_FOR_TASK" };
  }

  return { ok: false, reason: "NOT_APPROVED" };
}
