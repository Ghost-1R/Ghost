import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlanReviewIdempotencyKey,
  buildPlanReviewScope,
  decideReleaseAfterApproval,
  decideShiftJobTransition,
  fingerprintReviewResult,
} from "./workflow";

test("shift job transitions stay within the persisted state machine", () => {
  assert.equal(decideShiftJobTransition({ status: "AWAITING_APPROVAL" }, "QUEUED").ok, true);
  assert.equal(decideShiftJobTransition({ status: "QUEUED" }, "WORKING").ok, true);
  assert.equal(decideShiftJobTransition({ status: "WORKING" }, "COMPLETE").ok, true);
  assert.equal(decideShiftJobTransition({ status: "COMPLETE" }, "QUEUED").ok, false);
});

test("approval release only promotes awaiting jobs", () => {
  assert.deepEqual(
    decideReleaseAfterApproval({ jobStatus: "AWAITING_APPROVAL", authorizationStatus: "APPROVED" }),
    { ok: true, next: "QUEUED", idempotent: false },
  );
  assert.equal(
    decideReleaseAfterApproval({ jobStatus: "AWAITING_APPROVAL", authorizationStatus: "PENDING" }).ok,
    false,
  );
});

test("idempotency and result fingerprints are stable", () => {
  const key = buildPlanReviewIdempotencyKey("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", "plan-1");
  assert.match(key, /^uw-shift-bpr-/);
  assert.equal(buildPlanReviewScope("proj").includes("read_only"), true);
  const fp = fingerprintReviewResult({
    projectId: "p1",
    buildPlanId: "b1",
    summary: "ok",
    evidenceHrefs: ["/b", "/a"],
    idempotencyKey: "job-1",
  });
  const fp2 = fingerprintReviewResult({
    projectId: "p1",
    buildPlanId: "b1",
    summary: "ok",
    evidenceHrefs: ["/a", "/b"],
    idempotencyKey: "job-1",
  });
  const fpOtherJob = fingerprintReviewResult({
    projectId: "p1",
    buildPlanId: "b1",
    summary: "ok",
    evidenceHrefs: ["/a", "/b"],
    idempotencyKey: "job-2",
  });
  assert.equal(fp, fp2);
  assert.notEqual(fp, fpOtherJob);
  assert.equal(fp.length, 64);
});
