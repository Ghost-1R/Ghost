import assert from "node:assert/strict";
import test from "node:test";
import { answerBuildPlanTruthQuestion } from "./truth";
import type { BuildPlanStatus, WorkPackageStatus } from "./types";

const ask = (
  question: string,
  status: BuildPlanStatus | null = "PLANNING",
  packageStatuses: WorkPackageStatus[] = ["PLANNED"],
) =>
  answerBuildPlanTruthQuestion(question, {
    plan: status ? { status } : null,
    packageStatuses,
  });

test("past Ghost answers are not evidence", () => {
  const answer = ask("Did Ghost say the build plan was ready in a past response?");
  assert.ok(answer);
  assert.equal(answer.answer, "NO");
  assert.equal(answer.kind, "MODEL_SUGGESTION");
  assert.match(answer.reason, /not authoritative/i);
});

test("planned packages are not implemented", () => {
  for (const status of ["PLANNED", "READY", "BLOCKED"] as const) {
    const answer = ask("Is the work package implemented?", "BUILD_PLAN_READY", [status]);
    assert.equal(answer?.answer, "NO");
    assert.equal(answer?.kind, "PLANNED_WORK");
  }
});

test("migrations are not applied by a plan", () => {
  const answer = ask("Is the migration applied?", "BUILD_PLAN_READY");
  assert.equal(answer?.answer, "NO");
  assert.equal(answer?.kind, "NOT_IMPLEMENTED");
});

test("features are not built by a plan", () => {
  const answer = ask("Is the feature built?", "BUILD_PLAN_READY");
  assert.equal(answer?.answer, "NO");
  assert.equal(answer?.kind, "NOT_IMPLEMENTED");
});

test("planned verification is not a passing test", () => {
  const answer = ask("Did the tests pass?", "BUILD_PLAN_READY");
  assert.equal(answer?.answer, "NO");
  assert.equal(answer?.kind, "PLANNED_WORK");
});

test("build plan is not deployed", () => {
  const answer = ask("Is the product deployed?", "BUILD_PLAN_READY");
  assert.equal(answer?.answer, "NO");
  assert.equal(answer?.kind, "NOT_IMPLEMENTED");
});

test("ready to code only at BUILD_PLAN_READY", () => {
  assert.equal(ask("Is this ready to code?", "APPROVED")?.answer, "NO");
  assert.equal(ask("Is this ready to code?", "REVIEW")?.answer, "NO");
  assert.equal(ask("Is this ready to code?", "BUILD_PLAN_READY")?.answer, "YES");
  assert.equal(ask("Is this ready to code?", null)?.answer, "UNKNOWN");
});

test("BUILD_PLAN_READY never means production", () => {
  const answer = ask("Does BUILD_PLAN_READY mean production?", "BUILD_PLAN_READY");
  assert.equal(answer?.answer, "NO");
  assert.match(answer?.reason ?? "", /never means/i);
});

test("unrelated questions fall through", () => {
  assert.equal(ask("What colour is the logo?"), null);
});
