import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionLifecycle,
  LEGAL_LIFECYCLE_TRANSITIONS,
  LIFECYCLE_STAGES,
  recommendLifecycleTransition,
  seedLifecycleFromProjectStatus,
} from "./stages";

test("every lifecycle stage has an explicit legal transition list", () => {
  for (const stage of LIFECYCLE_STAGES) {
    assert.ok(LEGAL_LIFECYCLE_TRANSITIONS[stage].length > 0, stage);
  }
});

test("legal transitions stay adjacent and never rewrite history", () => {
  assert.equal(canTransitionLifecycle("BUILD", "TEST"), true);
  assert.equal(canTransitionLifecycle("BUILD", "DEPLOY"), false);
  assert.equal(canTransitionLifecycle("IDEA", "DEPLOY"), false);
  assert.equal(canTransitionLifecycle("COMPLETED", "COMPLETED"), false);
  assert.equal(canTransitionLifecycle("TEST", "BUILD"), true);
});

test("deterministic recommendations require verified evidence and open no blockers", () => {
  assert.equal(
    recommendLifecycleTransition({ stage: "BUILD", openBlockers: 1, verifiedCategories: ["APPLICATION"] }),
    null,
  );
  assert.equal(
    recommendLifecycleTransition({ stage: "BUILD", openBlockers: 0, verifiedCategories: [] }),
    null,
  );
  assert.deepEqual(
    recommendLifecycleTransition({ stage: "BUILD", openBlockers: 0, verifiedCategories: ["APPLICATION"] }),
    {
      to: "TEST",
      reason: "Application verification is recorded and no blockers are open, so TEST is the next safe stage.",
      ruleId: "build-to-test-when-application-verified",
    },
  );
  assert.deepEqual(
    recommendLifecycleTransition({ stage: "TEST", openBlockers: 0, verifiedCategories: ["PRODUCTION"] }),
    {
      to: "DEPLOY",
      reason: "Production verification is recorded and no blockers are open, so DEPLOY is the next safe stage.",
      ruleId: "test-to-deploy-when-production-verified",
    },
  );
  assert.equal(
    recommendLifecycleTransition({ stage: "DEPLOY", openBlockers: 0, verifiedCategories: ["PRODUCTION"] }),
    null,
  );
});

test("status seed mapping never invents a later stage than the recorded status supports", () => {
  assert.equal(seedLifecycleFromProjectStatus("PLANNING"), "STRATEGY");
  assert.equal(seedLifecycleFromProjectStatus("BUILDING"), "BUILD");
  assert.equal(seedLifecycleFromProjectStatus("DEPLOYED"), "DEPLOY");
  assert.equal(seedLifecycleFromProjectStatus("COMPLETED"), "COMPLETED");
  assert.equal(seedLifecycleFromProjectStatus("UNKNOWN"), "IDEA");
});
