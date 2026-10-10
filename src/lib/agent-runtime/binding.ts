import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import { assertAuthorizationKindCompatible } from "./authorization-kind";
import type { AgentAuthorizationKind, AgentTaskAuthorizationBinding } from "./types";

export type BindingDenialReason =
  | "MISSING_AUTHORIZATION"
  | "OWNER_MISMATCH"
  | "PROJECT_MISMATCH"
  | "ENVIRONMENT_MISMATCH"
  | "SCOPE_MISMATCH"
  | "FINGERPRINT_MISMATCH"
  | "UNKNOWN_ACTION_TYPE"
  | "KIND_MISMATCH"
  | "DEPLOYMENT_NOT_AUTHORIZED"
  | "DEVELOPMENT_NOT_AUTHORIZED"
  | "NOT_APPROVED"
  | "EXPIRED"
  | "REVOKED"
  | "REJECTED"
  | "PENDING"
  | "CONSUMED"
  | "USES_EXHAUSTED"
  | "MISSING_EVIDENCE";

export type BindingResult =
  | { ok: true; binding: AgentTaskAuthorizationBinding }
  | { ok: false; reason: BindingDenialReason; message: string };

const BINDING_MESSAGES: Record<BindingDenialReason, string> = {
  MISSING_AUTHORIZATION: "No authorization record is available for this agent task.",
  OWNER_MISMATCH: "Caller is not the owning founder for this authorization.",
  PROJECT_MISMATCH: "Authorization project does not match the agent task project.",
  ENVIRONMENT_MISMATCH: "Authorization environment does not match the agent task environment.",
  SCOPE_MISMATCH: "Action type or scope does not match the approved authorization.",
  FINGERPRINT_MISMATCH: "Stored scope fingerprint does not match recomputed identity.",
  UNKNOWN_ACTION_TYPE: "Action type is not a recognized agent-task authorization class.",
  KIND_MISMATCH: "Declared authorization kind does not match the action type class.",
  DEPLOYMENT_NOT_AUTHORIZED:
    "Development authorization cannot authorize deployment agent tasks.",
  DEVELOPMENT_NOT_AUTHORIZED:
    "Deployment authorization cannot authorize development agent tasks.",
  NOT_APPROVED: "Authorization is not in an APPROVED state.",
  EXPIRED: "Authorization has expired.",
  REVOKED: "Authorization was revoked.",
  REJECTED: "Authorization was rejected.",
  PENDING: "Authorization is still pending founder approval.",
  CONSUMED: "Authorization was already consumed.",
  USES_EXHAUSTED: "Authorization reuse budget is exhausted.",
  MISSING_EVIDENCE: "Authorization is missing required reason or evidence.",
};

/**
 * Build an immutable authorization binding for an agent task.
 * Scope fingerprint is recomputed and must match the durable authorization row.
 * Development and deployment kinds are strictly separated.
 */
export function bindAgentTaskAuthorization(input: {
  authorization: FounderActionAuthorization | null;
  ownerId: string;
  projectId: string;
  actionType: string;
  actionScope: string;
  environmentLabel?: string;
  authorizationKind: AgentAuthorizationKind;
  at?: string;
}): BindingResult {
  const auth = input.authorization;
  if (!auth) {
    return { ok: false, reason: "MISSING_AUTHORIZATION", message: BINDING_MESSAGES.MISSING_AUTHORIZATION };
  }

  const kindCheck = assertAuthorizationKindCompatible(input.authorizationKind, input.actionType);
  if (!kindCheck.ok) {
    return { ok: false, reason: kindCheck.reason, message: BINDING_MESSAGES[kindCheck.reason] };
  }

  const authKind = assertAuthorizationKindCompatible(input.authorizationKind, auth.actionType);
  if (!authKind.ok) {
    return { ok: false, reason: authKind.reason, message: BINDING_MESSAGES[authKind.reason] };
  }

  if (auth.ownerId !== input.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: BINDING_MESSAGES.OWNER_MISMATCH };
  }
  if (auth.projectId !== input.projectId) {
    return { ok: false, reason: "PROJECT_MISMATCH", message: BINDING_MESSAGES.PROJECT_MISMATCH };
  }
  if (!auth.reason.trim() || !Array.isArray(auth.evidence)) {
    return { ok: false, reason: "MISSING_EVIDENCE", message: BINDING_MESSAGES.MISSING_EVIDENCE };
  }

  const environmentLabel =
    (input.environmentLabel ?? auth.environmentLabel).trim() || "UNKNOWN";
  if (auth.environmentLabel.trim() !== environmentLabel) {
    return { ok: false, reason: "ENVIRONMENT_MISMATCH", message: BINDING_MESSAGES.ENVIRONMENT_MISMATCH };
  }

  if (
    auth.actionType.trim() !== input.actionType.trim() ||
    auth.actionScope.trim() !== input.actionScope.trim()
  ) {
    return { ok: false, reason: "SCOPE_MISMATCH", message: BINDING_MESSAGES.SCOPE_MISMATCH };
  }

  const expectedFingerprint = scopeFingerprint({
    projectId: input.projectId,
    actionType: input.actionType,
    actionScope: input.actionScope,
    environmentLabel,
  });
  if (auth.scopeFingerprint !== expectedFingerprint) {
    return { ok: false, reason: "FINGERPRINT_MISMATCH", message: BINDING_MESSAGES.FINGERPRINT_MISMATCH };
  }

  const effective = auth.effectiveStatus;
  const status = auth.status;
  if (effective === "EXPIRED") {
    return { ok: false, reason: "EXPIRED", message: BINDING_MESSAGES.EXPIRED };
  }
  if (status === "REVOKED" || effective === "REVOKED") {
    return { ok: false, reason: "REVOKED", message: BINDING_MESSAGES.REVOKED };
  }
  if (status === "REJECTED") {
    return { ok: false, reason: "REJECTED", message: BINDING_MESSAGES.REJECTED };
  }
  if (status === "PENDING") {
    return { ok: false, reason: "PENDING", message: BINDING_MESSAGES.PENDING };
  }
  if (status === "CONSUMED") {
    return { ok: false, reason: "CONSUMED", message: BINDING_MESSAGES.CONSUMED };
  }
  if (status !== "APPROVED" || effective !== "APPROVED") {
    return { ok: false, reason: "NOT_APPROVED", message: BINDING_MESSAGES.NOT_APPROVED };
  }

  if (auth.reusePolicy === "ONE_TIME" && auth.useCount >= 1) {
    return { ok: false, reason: "USES_EXHAUSTED", message: BINDING_MESSAGES.USES_EXHAUSTED };
  }
  if (auth.reusePolicy === "BOUNDED" && auth.maxUses != null && auth.useCount >= auth.maxUses) {
    return { ok: false, reason: "USES_EXHAUSTED", message: BINDING_MESSAGES.USES_EXHAUSTED };
  }

  // Wall-clock expiry double-check using optional `at`.
  if (input.at) {
    const expires = Date.parse(auth.expiresAt);
    const now = Date.parse(input.at);
    if (Number.isFinite(expires) && Number.isFinite(now) && now >= expires) {
      return { ok: false, reason: "EXPIRED", message: BINDING_MESSAGES.EXPIRED };
    }
  }

  return {
    ok: true,
    binding: {
      authorizationId: auth.id,
      ownerId: auth.ownerId,
      projectId: auth.projectId,
      actionType: auth.actionType.trim(),
      actionScope: auth.actionScope.trim(),
      environmentLabel,
      scopeFingerprint: expectedFingerprint,
      authorizationKind: input.authorizationKind,
    },
  };
}

/**
 * Verify a stored binding still matches the live authorization identity.
 * Used before claim and every execution step — fail closed on any drift.
 */
export function assertBindingMatchesAuthorization(
  binding: AgentTaskAuthorizationBinding,
  authorization: FounderActionAuthorization | null,
): BindingResult {
  return bindAgentTaskAuthorization({
    authorization,
    ownerId: binding.ownerId,
    projectId: binding.projectId,
    actionType: binding.actionType,
    actionScope: binding.actionScope,
    environmentLabel: binding.environmentLabel,
    authorizationKind: binding.authorizationKind,
  });
}
