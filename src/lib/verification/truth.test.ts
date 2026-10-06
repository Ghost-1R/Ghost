import assert from "node:assert/strict";
import test from "node:test";
import {
  answerVerificationTruthQuestion,
  doesVerifiedMeanDeployed,
  isDeployed,
  isImplemented,
  isProgramVerified,
} from "./truth";

test("VERIFIED status is verification evidence, not deployment", () => {
  const yes = isProgramVerified("VERIFIED");
  assert.equal(yes.answer, "YES");
  assert.equal(yes.kind, "VERIFICATION_EVIDENCE");

  const no = isProgramVerified("TESTING");
  assert.equal(no.answer, "NO");
});

test("deployed is always NO; VERIFIED does not mean deployed", () => {
  assert.equal(isDeployed().answer, "NO");
  assert.equal(isDeployed().kind, "NOT_DEPLOYED");
  assert.equal(doesVerifiedMeanDeployed().answer, "NO");
});

test("implemented reflects execution status only", () => {
  assert.equal(isImplemented("IMPLEMENTED").answer, "YES");
  assert.equal(isImplemented("EXECUTING").answer, "NO");
});

test("truth questions respect verification boundaries", () => {
  const cases = [
    {
      id: "c1",
      humanId: "TC-001",
      title: "Login happy path",
      status: "READY" as const,
      isRequired: true,
      requirementId: "r1",
      actualResult: "",
    },
    {
      id: "c2",
      humanId: "TC-002",
      title: "RLS denied",
      status: "FAILED" as const,
      isRequired: true,
      requirementId: "r1",
      actualResult: "policy allowed anon",
    },
    {
      id: "c3",
      humanId: "TC-003",
      title: "Dashboard",
      status: "PASSED" as const,
      isRequired: true,
      requirementId: "r2",
      actualResult: "ok",
    },
  ];
  const defects = [
    {
      humanId: "DEF-001",
      title: "RLS leak",
      status: "OPEN" as const,
      severity: "HIGH" as const,
      blocking: true,
    },
  ];

  const needs = answerVerificationTruthQuestion("does this still need testing?", {
    program: { status: "TESTING" },
    cases,
  });
  assert.equal(needs?.answer, "YES");

  const failed = answerVerificationTruthQuestion("what failed?", {
    program: { status: "TESTING" },
    cases,
  });
  assert.equal(failed?.answer, "YES");
  assert.match(failed?.reason ?? "", /TC-002/);

  const why = answerVerificationTruthQuestion("why is it not verified?", {
    program: { status: "TESTING" },
    executionStatus: "IMPLEMENTED",
    cases,
    defects,
  });
  assert.equal(why?.answer, "YES");
  assert.equal(why?.kind, "NOT_VERIFIED");

  const blocking = answerVerificationTruthQuestion("what blocking defects?", {
    program: { status: "TESTING" },
    defects,
  });
  assert.equal(blocking?.answer, "YES");

  const retest = answerVerificationTruthQuestion("needs retest?", {
    program: { status: "TESTING" },
    defects: [{ ...defects[0], status: "RETEST_REQUIRED" }],
  });
  assert.equal(retest?.answer, "YES");

  const next = answerVerificationTruthQuestion("what to test next?", {
    program: { status: "TESTING" },
    cases,
  });
  assert.equal(next?.answer, "YES");
  assert.match(next?.reason ?? "", /TC-001/);

  const implemented = answerVerificationTruthQuestion("is implementation complete?", {
    program: { status: "TESTING" },
    executionStatus: "IMPLEMENTED",
  });
  assert.equal(implemented?.answer, "YES");

  const verified = answerVerificationTruthQuestion("is it verified?", {
    program: { status: "VERIFIED" },
  });
  assert.equal(verified?.answer, "YES");

  const deployed = answerVerificationTruthQuestion("is it deployed?", {
    program: { status: "VERIFIED" },
  });
  assert.equal(deployed?.answer, "NO");
  assert.equal(deployed?.kind, "NOT_DEPLOYED");

  const past = answerVerificationTruthQuestion("ghost said it was verified earlier", {
    program: { status: "TESTING" },
  });
  assert.equal(past?.answer, "NO");
  assert.equal(past?.kind, "MODEL_SUGGESTION");

  const proves = answerVerificationTruthQuestion("does this prove the requirement?", {
    program: { status: "TESTING" },
    cases,
    evidence: [{ caseId: "c3" }],
  });
  assert.equal(proves?.answer, "YES");

  const reqs = answerVerificationTruthQuestion("which requirements are verified?", {
    program: { status: "TESTING" },
    cases,
    requirements: [
      { id: "r1", humanId: "REQ-001", title: "Auth" },
      { id: "r2", humanId: "REQ-002", title: "Dashboard" },
    ],
  });
  assert.equal(reqs?.answer, "YES");
  assert.match(reqs?.reason ?? "", /REQ-002/);
  assert.doesNotMatch(reqs?.reason ?? "", /REQ-001/);
});
