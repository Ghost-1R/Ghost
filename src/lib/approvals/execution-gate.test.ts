import assert from "node:assert/strict";
import test from "node:test";
import { assertExecutionAuthorized } from "./execution-gate";
import type { FounderActionAuthorization } from "./types";
import { effectiveAuthorizationStatus, scopeFingerprint } from "./workflow";

const ownerId = "11111111-1111-1111-1111-111111111111";
const projectId = "22222222-2222-2222-2222-222222222222";

function makeAuth(
  partial: Partial<FounderActionAuthorization> &
    Pick<FounderActionAuthorization, "status" | "actionType" | "actionScope" | "environmentLabel">,
): FounderActionAuthorization {
  const environmentLabel = partial.environmentLabel;
  const fingerprint =
    partial.scopeFingerprint ??
    scopeFingerprint({
      projectId: partial.projectId ?? projectId,
      actionType: partial.actionType,
      actionScope: partial.actionScope,
      environmentLabel,
    });
  const expiresAt = partial.expiresAt ?? new Date(Date.now() + 60_000).toISOString();
  return {
    id: partial.id ?? "33333333-3333-3333-3333-333333333333",
    ownerId: partial.ownerId ?? ownerId,
    projectId: partial.projectId ?? projectId,
    projectName: "Ghost",
    environmentLabel,
    decisionId: null,
    actionType: partial.actionType,
    actionScope: partial.actionScope,
    scopeFingerprint: fingerprint,
    reason: partial.reason ?? "Synthetic local executor test.",
    evidence: partial.evidence ?? [{ source: "test", reference: "syn-1", at: null }],
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
    idempotencyKey: "gate-test-001",
  };
}

function request(overrides: Partial<Parameters<typeof assertExecutionAuthorized>[1]> = {}) {
  return {
    authorizationId: "33333333-3333-3333-3333-333333333333",
    ownerId,
    projectId,
    actionType: "synthetic_local_action",
    actionScope: "target:local-only",
    environmentLabel: "LOCAL",
    ...overrides,
  };
}

test("execution gate allows matching approved authorization without executing side effects", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "synthetic_local_action",
    actionScope: "target:local-only",
    environmentLabel: "LOCAL",
  });
  const result = assertExecutionAuthorized(auth, request());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.shouldConsume, true);
    assert.equal(result.consumed, null);
  }
});

test("execution gate fails closed for every required denial", () => {
  const base = makeAuth({
    status: "APPROVED",
    actionType: "synthetic_local_action",
    actionScope: "target:local-only",
    environmentLabel: "LOCAL",
  });

  const cases: Array<{ name: string; auth: FounderActionAuthorization | null; req: ReturnType<typeof request>; reason: string }> = [
    { name: "missing", auth: null, req: request(), reason: "MISSING_AUTHORIZATION" },
    {
      name: "owner",
      auth: { ...base, ownerId: "99999999-9999-9999-9999-999999999999" },
      req: request(),
      reason: "OWNER_MISMATCH",
    },
    {
      name: "project",
      auth: base,
      req: request({ projectId: "44444444-4444-4444-4444-444444444444" }),
      reason: "PROJECT_MISMATCH",
    },
    {
      name: "environment",
      auth: base,
      req: request({ environmentLabel: "PRODUCTION" }),
      reason: "ENVIRONMENT_MISMATCH",
    },
    {
      name: "scope",
      auth: base,
      req: request({ actionScope: "target:changed" }),
      reason: "SCOPE_MISMATCH",
    },
    {
      name: "expired",
      auth: makeAuth({
        status: "APPROVED",
        actionType: "synthetic_local_action",
        actionScope: "target:local-only",
        environmentLabel: "LOCAL",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
      req: request({ at: new Date().toISOString() }),
      reason: "EXPIRED",
    },
    {
      name: "revoked",
      auth: { ...base, status: "REVOKED", effectiveStatus: "REVOKED" },
      req: request(),
      reason: "REVOKED",
    },
    {
      name: "consumed",
      auth: { ...base, status: "CONSUMED", effectiveStatus: "CONSUMED", useCount: 1 },
      req: request(),
      reason: "CONSUMED",
    },
    {
      name: "replay",
      auth: { ...base, useCount: 1 },
      req: request(),
      reason: "USES_EXHAUSTED",
    },
    {
      name: "evidence",
      auth: { ...base, reason: "  " },
      req: request(),
      reason: "MISSING_EVIDENCE",
    },
    {
      name: "pending",
      auth: { ...base, status: "PENDING", effectiveStatus: "PENDING" },
      req: request(),
      reason: "PENDING",
    },
  ];

  for (const item of cases) {
    const result = assertExecutionAuthorized(item.auth, item.req);
    assert.equal(result.ok, false, item.name);
    if (!result.ok) assert.equal(result.reason, item.reason, item.name);
  }
});
