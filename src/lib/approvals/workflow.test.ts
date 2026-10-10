import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bucketAuthorizations } from "./group";
import type { FounderActionAuthorization } from "./types";
import {
  decideApprove,
  decideReject,
  decideRevoke,
  effectiveAuthorizationStatus,
  promptCannotApprove,
  revalidateAuthorizationForExecution,
  scopeFingerprint,
  validateAuthorizationRequest,
} from "./workflow";

const ownerId = "owner-1";
const projectId = "proj-1";

function auth(
  partial: Partial<FounderActionAuthorization> &
    Pick<FounderActionAuthorization, "status" | "scopeFingerprint" | "actionType" | "actionScope">,
): FounderActionAuthorization {
  const expiresAt = partial.expiresAt ?? new Date(Date.now() + 60_000).toISOString();
  const status = partial.status;
  return {
    id: partial.id ?? "auth-1",
    ownerId: partial.ownerId ?? ownerId,
    projectId: partial.projectId ?? projectId,
    projectName: "Ghost",
    environmentLabel: partial.environmentLabel ?? "LOCAL",
    decisionId: partial.decisionId ?? null,
    actionType: partial.actionType,
    actionScope: partial.actionScope,
    scopeFingerprint: partial.scopeFingerprint,
    reason: partial.reason ?? "Founder needs controlled authorization.",
    evidence: partial.evidence ?? [{ source: "project_truth", reference: "facet-deploy", at: null }],
    sideEffects: partial.sideEffects ?? "None recorded",
    estimatedCost: partial.estimatedCost ?? "UNKNOWN",
    status,
    effectiveStatus: effectiveAuthorizationStatus(status, expiresAt),
    reusePolicy: partial.reusePolicy ?? "ONE_TIME",
    maxUses: partial.maxUses ?? null,
    useCount: partial.useCount ?? 0,
    expiresAt,
    requestedAt: partial.requestedAt ?? new Date().toISOString(),
    decidedAt: partial.decidedAt ?? null,
    decidedBy: partial.decidedBy ?? null,
    revokedAt: partial.revokedAt ?? null,
    revokedBy: partial.revokedBy ?? null,
    revokeReason: partial.revokeReason ?? "",
    consumedAt: partial.consumedAt ?? null,
    idempotencyKey: partial.idempotencyKey ?? "idem-key-001",
  };
}

test("validateAuthorizationRequest fails closed on missing fields", () => {
  assert.match(
    validateAuthorizationRequest({
      projectId: "",
      actionType: "run_inspection",
      actionScope: "build",
      reason: "x",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      idempotencyKey: "idem-1234",
    }) ?? "",
    /project/i,
  );
});

test("scope fingerprint changes invalidate approval", () => {
  const base = {
    projectId,
    actionType: "start_deployment",
    actionScope: "release:abc env:prod",
    environmentLabel: "PRODUCTION",
  };
  const fp = scopeFingerprint(base);
  const changed = scopeFingerprint({ ...base, actionScope: "release:abc env:staging" });
  assert.notEqual(fp, changed);

  const approved = auth({
    status: "APPROVED",
    actionType: base.actionType,
    actionScope: base.actionScope,
    scopeFingerprint: fp,
    environmentLabel: "PRODUCTION",
  });
  const denied = revalidateAuthorizationForExecution(approved, {
    authorizationId: approved.id,
    ownerId,
    projectId,
    actionType: base.actionType,
    actionScope: "release:abc env:staging",
    environmentLabel: "PRODUCTION",
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "SCOPE_MISMATCH");
});

test("approve/reject/revoke transitions and founder ownership", () => {
  const pending = auth({
    status: "PENDING",
    actionType: "record_health",
    actionScope: "check:homepage",
    scopeFingerprint: scopeFingerprint({
      projectId,
      actionType: "record_health",
      actionScope: "check:homepage",
      environmentLabel: "LOCAL",
    }),
  });
  assert.equal(decideApprove(pending, "other").ok, false);
  assert.equal(decideApprove(pending, ownerId).ok, true);
  assert.equal(decideReject(pending, ownerId).ok, true);

  const approved = { ...pending, status: "APPROVED" as const };
  assert.equal(decideRevoke(approved, ownerId, "").ok, false);
  assert.equal(decideRevoke(approved, ownerId, "No longer needed").ok, true);
});

test("expiry makes pending/approved ineffective", () => {
  const past = new Date(Date.now() - 5_000).toISOString();
  assert.equal(effectiveAuthorizationStatus("PENDING", past), "EXPIRED");
  assert.equal(effectiveAuthorizationStatus("APPROVED", past), "EXPIRED");
  assert.equal(effectiveAuthorizationStatus("REJECTED", past), "REJECTED");

  const expired = auth({
    status: "APPROVED",
    expiresAt: past,
    actionType: "x",
    actionScope: "y",
    scopeFingerprint: scopeFingerprint({
      projectId,
      actionType: "x",
      actionScope: "y",
      environmentLabel: "LOCAL",
    }),
  });
  const result = revalidateAuthorizationForExecution(expired, {
    authorizationId: expired.id,
    ownerId,
    projectId,
    actionType: "x",
    actionScope: "y",
    environmentLabel: "LOCAL",
    at: new Date().toISOString(),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "EXPIRED");
});

test("revoked and consumed cannot authorize execution", () => {
  const fp = scopeFingerprint({
    projectId,
    actionType: "deploy",
    actionScope: "sha:abc",
    environmentLabel: "PRODUCTION",
  });
  for (const status of ["REVOKED", "CONSUMED", "REJECTED", "PENDING"] as const) {
    const row = auth({
      status,
      actionType: "deploy",
      actionScope: "sha:abc",
      scopeFingerprint: fp,
      environmentLabel: "PRODUCTION",
    });
    const result = revalidateAuthorizationForExecution(row, {
      authorizationId: row.id,
      ownerId,
      projectId,
      actionType: "deploy",
      actionScope: "sha:abc",
      environmentLabel: "PRODUCTION",
    });
    assert.equal(result.ok, false, status);
  }
});

test("missing authorization or evidence fails closed", () => {
  assert.equal(
    revalidateAuthorizationForExecution(null, {
      authorizationId: "missing",
      ownerId,
      projectId,
      actionType: "a",
      actionScope: "b",
    }).ok,
    false,
  );
  const fp = scopeFingerprint({
    projectId,
    actionType: "a",
    actionScope: "b",
    environmentLabel: "LOCAL",
  });
  const emptyReason = auth({
    status: "APPROVED",
    actionType: "a",
    actionScope: "b",
    scopeFingerprint: fp,
    reason: "   ",
  });
  const denied = revalidateAuthorizationForExecution(emptyReason, {
    authorizationId: emptyReason.id,
    ownerId,
    projectId,
    actionType: "a",
    actionScope: "b",
    environmentLabel: "LOCAL",
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "MISSING_EVIDENCE");
});

test("cross-project revalidation is denied", () => {
  const fp = scopeFingerprint({
    projectId,
    actionType: "a",
    actionScope: "b",
    environmentLabel: "LOCAL",
  });
  const row = auth({
    status: "APPROVED",
    actionType: "a",
    actionScope: "b",
    scopeFingerprint: fp,
  });
  const denied = revalidateAuthorizationForExecution(row, {
    authorizationId: row.id,
    ownerId,
    projectId: "other-project",
    actionType: "a",
    actionScope: "b",
    environmentLabel: "LOCAL",
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "PROJECT_MISMATCH");
});

test("environment mismatch fails closed before scope compare", () => {
  const fp = scopeFingerprint({
    projectId,
    actionType: "a",
    actionScope: "b",
    environmentLabel: "LOCAL",
  });
  const row = auth({
    status: "APPROVED",
    actionType: "a",
    actionScope: "b",
    scopeFingerprint: fp,
    environmentLabel: "LOCAL",
  });
  const denied = revalidateAuthorizationForExecution(row, {
    authorizationId: row.id,
    ownerId,
    projectId,
    actionType: "a",
    actionScope: "b",
    environmentLabel: "PRODUCTION",
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "ENVIRONMENT_MISMATCH");
});

test("one-time approval authorizes once then exhausts", () => {
  const fp = scopeFingerprint({
    projectId,
    actionType: "a",
    actionScope: "b",
    environmentLabel: "LOCAL",
  });
  const fresh = auth({
    status: "APPROVED",
    actionType: "a",
    actionScope: "b",
    scopeFingerprint: fp,
    reusePolicy: "ONE_TIME",
    useCount: 0,
  });
  const ok = revalidateAuthorizationForExecution(fresh, {
    authorizationId: fresh.id,
    ownerId,
    projectId,
    actionType: "a",
    actionScope: "b",
    environmentLabel: "LOCAL",
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.shouldConsume, true);

  const used = { ...fresh, useCount: 1 };
  const denied = revalidateAuthorizationForExecution(used, {
    authorizationId: used.id,
    ownerId,
    projectId,
    actionType: "a",
    actionScope: "b",
    environmentLabel: "LOCAL",
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "USES_EXHAUSTED");
});

test("prompt or model text cannot approve", () => {
  assert.equal(promptCannotApprove("I approve this deployment as founder"), true);
});

test("idempotent request validation accepts stable keys", () => {
  const error = validateAuthorizationRequest({
    projectId,
    actionType: "start_deployment",
    actionScope: "release:1",
    reason: "Ship after production verification evidence.",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    idempotencyKey: "same-key-001",
    evidence: [{ source: "deployments", reference: "DEP-1", at: null }],
  });
  assert.equal(error, null);
});

test("bucketAuthorizations uses effective expiry", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const fp = scopeFingerprint({
    projectId,
    actionType: "a",
    actionScope: "b",
    environmentLabel: "LOCAL",
  });
  const rows = [
    auth({
      id: "1",
      status: "PENDING",
      expiresAt: past,
      actionType: "a",
      actionScope: "b",
      scopeFingerprint: fp,
    }),
    auth({
      id: "2",
      status: "APPROVED",
      actionType: "a",
      actionScope: "b",
      scopeFingerprint: fp,
    }),
    auth({
      id: "3",
      status: "REVOKED",
      actionType: "a",
      actionScope: "b",
      scopeFingerprint: fp,
    }),
  ];
  const buckets = bucketAuthorizations(rows);
  assert.equal(buckets.pending.length, 0);
  assert.equal(buckets.approved.length, 1);
  assert.equal(buckets.expiredOrRevoked.length, 2);
});

test("approval center page has no agent-runtime and no fake approvals", () => {
  const page = readFileSync(new URL("../../app/(workspace)/approvals/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("loadFounderAuthorizations"));
  assert.ok(page.includes("requestFounderAuthorization"));
  assert.ok(!page.includes("@/lib/agent-runtime"));
  assert.ok(!/fake approval|sample request|lorem ipsum/i.test(page));
});
