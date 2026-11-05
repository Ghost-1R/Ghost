import assert from "node:assert/strict";
import { test } from "node:test";
import { runBuildPlanReviewStep } from "./build-plan-review";
import { BUILD_PLAN_REVIEW_STEPS } from "./types";

const base = {
  projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  projectName: "PR9 Watch Project",
  idempotencyKey: "uw-shift-bpr-test-plan-1",
  buildPlan: {
    id: "plan-1",
    status: "APPROVED",
    summary: "Walkthrough plan",
    updatedAt: "2026-11-05T00:00:00.000Z",
  },
  risks: [
    {
      id: "r1",
      severity: "HIGH",
      description: "Checkout latency under load",
      mitigation: "Cache",
    },
  ],
  verifications: [
    {
      id: "v1",
      state: "NOT_VERIFIED",
      category: "APPLICATION",
      target: "Watch Room migrated target",
    },
  ],
};

test("build plan review advances through deterministic read-only steps", () => {
  const s1 = runBuildPlanReviewStep(base, 0);
  assert.equal(s1.step, 1);
  assert.equal(s1.done, false);
  const s2 = runBuildPlanReviewStep(base, 1);
  assert.equal(s2.step, 2);
  const s3 = runBuildPlanReviewStep(base, 2);
  assert.equal(s3.step, 3);
  const s4 = runBuildPlanReviewStep(base, 3);
  assert.equal(s4.step, BUILD_PLAN_REVIEW_STEPS);
  assert.equal(s4.done, true);
  assert.ok(s4.resultFingerprint);
  assert.match(s4.summary, /Read-only/);
  assert.ok(s4.evidence.some((link) => link.href.includes("/build-plan")));
});

test("missing build plan finishes immediately without inventing work", () => {
  const result = runBuildPlanReviewStep({ ...base, buildPlan: null }, 0);
  assert.equal(result.done, true);
  assert.match(result.summary, /No saved build plan/);
});
