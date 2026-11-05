import assert from "node:assert/strict";
import test from "node:test";
import {
  answerBuildExecutionTruthQuestion,
  doesImplementedMeanProduction,
  hasEvidenceForPackage,
  isDeployed,
  isExecutionImplemented,
  isVerified,
} from "./truth";

test("IMPLEMENTED status is recorded fact, not verification", () => {
  const yes = isExecutionImplemented("IMPLEMENTED");
  assert.equal(yes.answer, "YES");
  assert.equal(yes.kind, "IMPLEMENTATION_EVIDENCE");

  const no = isExecutionImplemented("EXECUTING");
  assert.equal(no.answer, "NO");
});

test("verified and deployed are always NO in V9", () => {
  assert.equal(isVerified().answer, "NO");
  assert.equal(isVerified().kind, "NOT_VERIFIED");
  assert.equal(isDeployed().answer, "NO");
  assert.equal(isDeployed().kind, "NOT_DEPLOYED");
  assert.equal(doesImplementedMeanProduction().answer, "NO");
});

test("hasEvidenceForPackage checks evidence rows", () => {
  assert.equal(hasEvidenceForPackage("e1", [{ packageExecutionId: "e1" }]), true);
  assert.equal(hasEvidenceForPackage("e1", [{ packageExecutionId: "e2" }]), false);
});

test("truth questions respect boundaries", () => {
  const packages = [
    { id: "e1", status: "IN_PROGRESS" as const },
    { id: "e2", status: "READY" as const },
    { id: "e3", status: "BLOCKED" as const },
    { id: "e4", status: "IMPLEMENTED" as const },
  ];

  const building = answerBuildExecutionTruthQuestion("what are we building now?", {
    execution: { status: "EXECUTING" },
    packageExecutions: packages,
  });
  assert.equal(building?.answer, "YES");

  const next = answerBuildExecutionTruthQuestion("what is next?", {
    execution: { status: "EXECUTING" },
    packageExecutions: packages,
  });
  assert.equal(next?.answer, "YES");

  const blocked = answerBuildExecutionTruthQuestion("why are we blocked?", {
    execution: { status: "EXECUTING" },
    packageExecutions: packages,
    openBlockerCount: 1,
  });
  assert.equal(blocked?.answer, "YES");

  const progress = answerBuildExecutionTruthQuestion("how much is implemented?", {
    execution: { status: "EXECUTING" },
    packageExecutions: packages,
  });
  assert.equal(progress?.answer, "NO");
  assert.match(progress?.reason ?? "", /1 of 4/);

  const proves = answerBuildExecutionTruthQuestion("does evidence prove the feature?", {
    execution: { status: "EXECUTING" },
    packageExecutions: packages,
    evidence: [{ packageExecutionId: "e4" }],
  });
  assert.equal(proves?.answer, "NO");
  assert.equal(proves?.kind, "NOT_VERIFIED");

  const implemented = answerBuildExecutionTruthQuestion("is execution implemented?", {
    execution: { status: "IMPLEMENTED" },
  });
  assert.equal(implemented?.answer, "YES");

  const verified = answerBuildExecutionTruthQuestion("is it verified?", {
    execution: { status: "IMPLEMENTED" },
  });
  assert.equal(verified?.answer, "NO");

  const deployed = answerBuildExecutionTruthQuestion("is it deployed?", {
    execution: { status: "IMPLEMENTED" },
  });
  assert.equal(deployed?.answer, "NO");

  const past = answerBuildExecutionTruthQuestion("ghost said it was done last week", {
    execution: { status: "EXECUTING" },
  });
  assert.equal(past?.answer, "NO");
  assert.equal(past?.kind, "MODEL_SUGGESTION");
});
