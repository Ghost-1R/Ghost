import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionIdea, computeIdeaReadiness, workingTitleFromRaw } from "./workflow";

test("idea transitions stay inside the finite workflow", () => {
  assert.equal(canTransitionIdea("CAPTURED", "EXPLORING"), true);
  assert.equal(canTransitionIdea("CAPTURED", "APPROVED"), false);
  assert.equal(canTransitionIdea("NEEDS_DECISION", "APPROVED"), true);
  assert.equal(canTransitionIdea("APPROVED", "PROMOTED"), true);
  assert.equal(canTransitionIdea("PROMOTED", "APPROVED"), false);
});

test("readiness is transparent labels, never a success percentage", () => {
  const early = computeIdeaReadiness({
    problem: "",
    targetUser: "",
    proposedSolution: "",
    evidenceCount: 0,
    openValidationCount: 0,
    supportedValidationCount: 0,
    assumptionCount: 0,
    riskCount: 0,
  });
  assert.equal(early.readiness, "EARLY");

  const needs = computeIdeaReadiness({
    problem: "Freelancers lose hours sorting receipts every month.",
    targetUser: "Independent freelancers",
    proposedSolution: "A lightweight receipt categorizer.",
    evidenceCount: 0,
    openValidationCount: 1,
    supportedValidationCount: 0,
    assumptionCount: 2,
    riskCount: 0,
  });
  assert.equal(needs.readiness, "NEEDS_EVIDENCE");
  assert.ok(needs.reasons.some((reason) => /evidence|validation|risk/i.test(reason)));

  const ready = computeIdeaReadiness({
    problem: "Freelancers lose hours sorting receipts every month.",
    targetUser: "Independent freelancers",
    proposedSolution: "A lightweight receipt categorizer.",
    evidenceCount: 1,
    openValidationCount: 0,
    supportedValidationCount: 1,
    assumptionCount: 2,
    riskCount: 1,
  });
  assert.equal(ready.readiness, "DECISION_READY");
  assert.ok(ready.reasons.some((reason) => /not a prediction/i.test(reason)));
  assert.ok(!JSON.stringify(ready).includes("%"));
});

test("working titles stay short and useful from rough capture", () => {
  assert.equal(workingTitleFromRaw(""), "Untitled idea");
  assert.match(
    workingTitleFromRaw("An app that automatically organizes receipts for small businesses."),
    /organizes receipts/i,
  );
});
