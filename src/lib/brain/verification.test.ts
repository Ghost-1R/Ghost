import assert from "node:assert/strict";
import test from "node:test";
import { displayVerificationState, groupVerification, isSupportedVerified } from "./verification";

test("verified without evidence is not treated as verified", () => {
  const record = { state: "VERIFIED", evidence: {}, checkedAt: "2026-09-28T00:00:00Z" };
  assert.equal(isSupportedVerified(record), false);
  assert.equal(displayVerificationState(record), "NOT_VERIFIED");
});

test("verified with evidence and checked time stays verified", () => {
  const record = {
    state: "VERIFIED",
    evidence: { source: "localhost:3001" },
    checkedAt: "2026-09-28T00:00:00Z",
  };
  assert.equal(isSupportedVerified(record), true);
  assert.equal(displayVerificationState(record), "VERIFIED");
});

test("verification groups stay distinct", () => {
  const groups = groupVerification([
    { category: "APPLICATION", target: "Claim", state: "CLAIMED", evidence: { note: "said so" }, checkedAt: null },
    { category: "APPLICATION", target: "Saw", state: "OBSERVED", evidence: { note: "saw it" }, checkedAt: null },
    {
      category: "DATABASE",
      target: "Schema",
      state: "VERIFIED",
      evidence: { source: "remote" },
      checkedAt: "2026-09-28T00:00:00Z",
    },
    { category: "PRODUCTION", target: "Host", state: "NOT_VERIFIED", evidence: {}, checkedAt: null },
    { category: "OTHER", target: "Broken", state: "FAILED", evidence: { source: "check" }, checkedAt: null },
  ]);

  assert.equal(groups.verified.length, 1);
  assert.equal(groups.claimed.length, 1);
  assert.equal(groups.observed.length, 1);
  assert.equal(groups.failed.length, 1);
  assert.equal(groups.notVerified.length, 1);
});
