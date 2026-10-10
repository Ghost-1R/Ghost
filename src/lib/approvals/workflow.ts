import { createHash } from "node:crypto";
import type {
  AuthorizationRequestInput,
  AuthorizationReusePolicy,
  AuthorizationStatus,
  ExecutionRevalidationRequest,
  FounderActionAuthorization,
} from "./types";

/** Canonical fingerprint — scope changes invalidate prior approvals. */
export function scopeFingerprint(input: {
  projectId: string;
  actionType: string;
  actionScope: string;
  environmentLabel?: string;
}): string {
  const payload = JSON.stringify({
    projectId: input.projectId.trim(),
    actionType: input.actionType.trim(),
    actionScope: input.actionScope.trim(),
    environmentLabel: (input.environmentLabel ?? "UNKNOWN").trim() || "UNKNOWN",
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function validateAuthorizationRequest(input: AuthorizationRequestInput): string | null {
  if (!input.projectId.trim()) return "A project is required.";
  if (!input.actionType.trim()) return "An exact action type is required.";
  if (input.actionType.trim().length > 120) return "Action type is too long.";
  if (!input.actionScope.trim()) return "An exact action scope is required.";
  if (input.actionScope.trim().length > 2000) return "Action scope is too long.";
  if (!input.reason.trim()) return "A reason is required.";
  if (!input.idempotencyKey.trim() || input.idempotencyKey.trim().length < 8) {
    return "Idempotency key must be at least 8 characters.";
  }
  const expires = Date.parse(input.expiresAt);
  if (!Number.isFinite(expires)) return "A valid expiration timestamp is required.";
  if (expires <= Date.now()) return "Expiration must be in the future.";
  const reuse: AuthorizationReusePolicy = input.reusePolicy ?? "ONE_TIME";
  if (reuse === "BOUNDED") {
    if (input.maxUses == null || input.maxUses < 1 || input.maxUses > 100) {
      return "Bounded reuse requires maxUses between 1 and 100.";
    }
  } else if (input.maxUses != null) {
    return "One-time authorizations cannot set maxUses.";
  }
  if ((input.evidence ?? []).some((item) => !item.source.trim() || !item.reference.trim())) {
    return "Evidence items require source and reference.";
  }
  return null;
}

/** Apply wall-clock expiry without mutating durable history rows in the caller. */
export function effectiveAuthorizationStatus(
  status: AuthorizationStatus,
  expiresAt: string,
  at: string = new Date().toISOString(),
): AuthorizationStatus {
  if (status === "PENDING" || status === "APPROVED") {
    const expires = Date.parse(expiresAt);
    const now = Date.parse(at);
    if (Number.isFinite(expires) && Number.isFinite(now) && now >= expires) {
      return "EXPIRED";
    }
  }
  return status;
}

export type TransitionDecision =
  | { ok: true; nextStatus: AuthorizationStatus; eventType: string; detail: string }
  | { ok: false; reason: string };

export function decideApprove(auth: Pick<FounderActionAuthorization, "status" | "expiresAt" | "ownerId">, actorId: string, at?: string): TransitionDecision {
  if (auth.ownerId !== actorId) {
    return { ok: false, reason: "Only the owning founder can approve this request." };
  }
  const effective = effectiveAuthorizationStatus(auth.status, auth.expiresAt, at);
  if (effective === "EXPIRED") return { ok: false, reason: "This request has expired." };
  if (auth.status !== "PENDING") return { ok: false, reason: `Cannot approve a ${auth.status.toLowerCase()} request.` };
  return { ok: true, nextStatus: "APPROVED", eventType: "APPROVED", detail: "Founder approved exact action scope." };
}

export function decideReject(auth: Pick<FounderActionAuthorization, "status" | "expiresAt" | "ownerId">, actorId: string, at?: string): TransitionDecision {
  if (auth.ownerId !== actorId) {
    return { ok: false, reason: "Only the owning founder can reject this request." };
  }
  const effective = effectiveAuthorizationStatus(auth.status, auth.expiresAt, at);
  if (effective === "EXPIRED") return { ok: false, reason: "This request has expired." };
  if (auth.status !== "PENDING") return { ok: false, reason: `Cannot reject a ${auth.status.toLowerCase()} request.` };
  return { ok: true, nextStatus: "REJECTED", eventType: "REJECTED", detail: "Founder rejected the request." };
}

export function decideRevoke(
  auth: Pick<FounderActionAuthorization, "status" | "expiresAt" | "ownerId">,
  actorId: string,
  revokeReason: string,
  at?: string,
): TransitionDecision {
  if (auth.ownerId !== actorId) {
    return { ok: false, reason: "Only the owning founder can revoke this authorization." };
  }
  if (!revokeReason.trim()) return { ok: false, reason: "A revoke reason is required." };
  const effective = effectiveAuthorizationStatus(auth.status, auth.expiresAt, at);
  if (effective === "EXPIRED") return { ok: false, reason: "This authorization has already expired." };
  if (auth.status !== "APPROVED") return { ok: false, reason: "Only APPROVED authorizations can be revoked." };
  return {
    ok: true,
    nextStatus: "REVOKED",
    eventType: "REVOKED",
    detail: revokeReason.trim().slice(0, 2000),
  };
}

export type RevalidationResult =
  | { ok: true; reason: "APPROVED"; shouldConsume: boolean }
  | {
      ok: false;
      reason:
        | "MISSING_AUTHORIZATION"
        | "OWNER_MISMATCH"
        | "PROJECT_MISMATCH"
        | "SCOPE_MISMATCH"
        | "EXPIRED"
        | "REVOKED"
        | "REJECTED"
        | "PENDING"
        | "CONSUMED"
        | "USES_EXHAUSTED"
        | "MISSING_EVIDENCE"
        | "NOT_APPROVED";
    };

/**
 * Fail-closed revalidation for a separately authorized executor.
 * Approval never auto-executes; callers must invoke this at start and after recovery.
 */
export function revalidateAuthorizationForExecution(
  auth: FounderActionAuthorization | null,
  request: ExecutionRevalidationRequest,
): RevalidationResult {
  if (!auth) return { ok: false, reason: "MISSING_AUTHORIZATION" };
  if (auth.ownerId !== request.ownerId) return { ok: false, reason: "OWNER_MISMATCH" };
  if (auth.projectId !== request.projectId) return { ok: false, reason: "PROJECT_MISMATCH" };
  if (!auth.reason.trim()) return { ok: false, reason: "MISSING_EVIDENCE" };
  if (!Array.isArray(auth.evidence)) return { ok: false, reason: "MISSING_EVIDENCE" };

  const expected = scopeFingerprint({
    projectId: request.projectId,
    actionType: request.actionType,
    actionScope: request.actionScope,
    environmentLabel: request.environmentLabel ?? auth.environmentLabel,
  });
  if (auth.scopeFingerprint !== expected) return { ok: false, reason: "SCOPE_MISMATCH" };
  if (
    auth.actionType.trim() !== request.actionType.trim() ||
    auth.actionScope.trim() !== request.actionScope.trim()
  ) {
    return { ok: false, reason: "SCOPE_MISMATCH" };
  }

  const effective = effectiveAuthorizationStatus(auth.status, auth.expiresAt, request.at);
  if (effective === "EXPIRED") return { ok: false, reason: "EXPIRED" };
  if (auth.status === "REVOKED" || effective === "REVOKED") return { ok: false, reason: "REVOKED" };
  if (auth.status === "REJECTED") return { ok: false, reason: "REJECTED" };
  if (auth.status === "PENDING") return { ok: false, reason: "PENDING" };
  if (auth.status === "CONSUMED") return { ok: false, reason: "CONSUMED" };
  if (auth.status !== "APPROVED" || effective !== "APPROVED") {
    return { ok: false, reason: "NOT_APPROVED" };
  }

  if (auth.reusePolicy === "ONE_TIME" && auth.useCount >= 1) {
    return { ok: false, reason: "USES_EXHAUSTED" };
  }
  if (auth.reusePolicy === "BOUNDED" && auth.maxUses != null && auth.useCount >= auth.maxUses) {
    return { ok: false, reason: "USES_EXHAUSTED" };
  }

  const shouldConsume =
    auth.reusePolicy === "ONE_TIME" ||
    (auth.reusePolicy === "BOUNDED" && auth.maxUses != null && auth.useCount + 1 >= auth.maxUses);

  return { ok: true, reason: "APPROVED", shouldConsume };
}

/** Chat / model text can never approve. */
export function promptCannotApprove(_message: string): true {
  void _message;
  return true;
}
