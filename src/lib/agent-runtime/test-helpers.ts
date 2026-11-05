import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { effectiveAuthorizationStatus, scopeFingerprint } from "@/lib/approvals/workflow";

export const OWNER_ID = "11111111-1111-1111-1111-111111111111";
export const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
export const OTHER_PROJECT_ID = "44444444-4444-4444-4444-444444444444";
export const AUTH_ID = "33333333-3333-3333-3333-333333333333";

export function makeAuth(
  partial: Partial<FounderActionAuthorization> &
    Pick<FounderActionAuthorization, "status" | "actionType" | "actionScope" | "environmentLabel">,
): FounderActionAuthorization {
  const projectId = partial.projectId ?? PROJECT_ID;
  const environmentLabel = partial.environmentLabel;
  const fingerprint =
    partial.scopeFingerprint ??
    scopeFingerprint({
      projectId,
      actionType: partial.actionType,
      actionScope: partial.actionScope,
      environmentLabel,
    });
  const expiresAt = partial.expiresAt ?? new Date(Date.now() + 60_000).toISOString();
  return {
    id: partial.id ?? AUTH_ID,
    ownerId: partial.ownerId ?? OWNER_ID,
    projectId,
    projectName: "Ghost",
    environmentLabel,
    decisionId: null,
    actionType: partial.actionType,
    actionScope: partial.actionScope,
    scopeFingerprint: fingerprint,
    reason: partial.reason ?? "Approval-bound agent task test authorization.",
    evidence: partial.evidence ?? [{ source: "test", reference: "agent-09-6", at: null }],
    sideEffects: "",
    estimatedCost: "UNKNOWN",
    status: partial.status,
    effectiveStatus: effectiveAuthorizationStatus(partial.status, expiresAt),
    reusePolicy: partial.reusePolicy ?? "ONE_TIME",
    maxUses: partial.maxUses ?? null,
    useCount: partial.useCount ?? 0,
    expiresAt,
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: "",
    consumedAt: null,
    idempotencyKey: partial.idempotencyKey ?? "agent-task-test-001",
  };
}
