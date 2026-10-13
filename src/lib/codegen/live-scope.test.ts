import assert from "node:assert/strict";
import test from "node:test";
import { makeApprovedCodingAuth } from "./test-fixtures";
import {
  buildCodegenTaskContract,
  encodeCodegenScopeFragment,
} from "./request-contract";
import {
  isUncertainBillingReason,
  verifyPilot03LiveFounderScope,
} from "./live-scope";

function liveScope(): string {
  const built = buildCodegenTaskContract({
    providerId: "openai",
    model: "gpt-5-mini",
    classification: "PUBLIC",
    maxSpendUsd: 1,
  });
  assert.equal(built.ok, true);
  if (!built.ok) throw new Error("contract");
  return `repo:Ghost-1R/Ghost@cursor/pilot-03|obj:vehicle|${encodeCodegenScopeFragment(built.contract)}`;
}

test("verifyPilot03LiveFounderScope accepts exact openai gpt-5-mini PUBLIC $1 ONE_TIME consumed", () => {
  const auth = makeApprovedCodingAuth({
    status: "CONSUMED",
    environmentLabel: "LOCAL_PILOT_03",
  });
  const ok = verifyPilot03LiveFounderScope({
    actionScope: liveScope(),
    environmentLabel: "LOCAL_PILOT_03",
    authorization: auth,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.match(ok.detail, /openai:gpt-5-mini/);
    assert.match(ok.detail, /deploy=false/);
  }
});

test("verifyPilot03LiveFounderScope refuses mock provider and APPROVED-only auth", () => {
  const mockBuilt = buildCodegenTaskContract({
    providerId: "mock",
    model: "mock-codegen-v1",
    maxSpendUsd: 1,
  });
  assert.equal(mockBuilt.ok, true);
  if (!mockBuilt.ok) return;
  const mockScope = `repo:x@y|obj:z|${encodeCodegenScopeFragment(mockBuilt.contract)}`;
  const auth = makeApprovedCodingAuth({ status: "CONSUMED", environmentLabel: "LOCAL_PILOT_03" });
  const mockDenied = verifyPilot03LiveFounderScope({
    actionScope: mockScope,
    environmentLabel: "LOCAL_PILOT_03",
    authorization: auth,
  });
  assert.equal(mockDenied.ok, false);
  if (!mockDenied.ok) assert.equal(mockDenied.reason, "PROVIDER_MISMATCH");

  const approvedOnly = makeApprovedCodingAuth({
    status: "APPROVED",
    environmentLabel: "LOCAL_PILOT_03",
  });
  const pending = verifyPilot03LiveFounderScope({
    actionScope: liveScope(),
    environmentLabel: "LOCAL_PILOT_03",
    authorization: approvedOnly,
  });
  assert.equal(pending.ok, false);
  if (!pending.ok) assert.equal(pending.reason, "AUTH_NOT_CONSUMED");
});

test("verifyPilot03LiveFounderScope refuses wrong environment and missing deploy=false", () => {
  const auth = makeApprovedCodingAuth({ status: "CONSUMED", environmentLabel: "REMOTE_DEV" });
  const env = verifyPilot03LiveFounderScope({
    actionScope: liveScope(),
    environmentLabel: "REMOTE_DEV",
    authorization: auth,
  });
  assert.equal(env.ok, false);
  if (!env.ok) assert.equal(env.reason, "ENVIRONMENT_MISMATCH");
});

test("verifyPilot03LiveFounderScope accepts LOCAL_PILOT_04 with 99¢ remaining allowance ceiling", () => {
  const built = buildCodegenTaskContract({
    providerId: "openai",
    model: "gpt-5-mini",
    classification: "PUBLIC",
    maxSpendUsd: 0.99,
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const scope = `repo:Ghost-1R/Ghost@cursor/pilot-04|obj:vehicle|${encodeCodegenScopeFragment(built.contract)}`;
  const auth = makeApprovedCodingAuth({
    status: "CONSUMED",
    environmentLabel: "LOCAL_PILOT_04",
  });
  const ok = verifyPilot03LiveFounderScope({
    actionScope: scope,
    environmentLabel: "LOCAL_PILOT_04",
    authorization: auth,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.match(ok.detail, /max\$0\.99/);
});

test("uncertain billing reasons preserve reservation semantics", () => {
  assert.equal(isUncertainBillingReason("UNCERTAIN_BILLING"), true);
  assert.equal(isUncertainBillingReason("RATE_LIMITED"), true);
  assert.equal(isUncertainBillingReason("EMPTY_PROVIDER_CONTENT"), true);
  assert.equal(isUncertainBillingReason("TRUNCATED_OUTPUT"), true);
  assert.equal(isUncertainBillingReason("AUTH_FAILED"), false);
  assert.equal(isUncertainBillingReason("MISSING_API_KEY"), false);
});
