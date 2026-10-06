import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionCase,
  canTransitionVerificationProgram,
  computeRegressionCoverage,
  computeVerificationCompletion,
  isBlockingDefect,
  mapPlanVerificationKind,
  nextHumanId,
  rejectSecretEvidenceReference,
  suggestVerificationNextAction,
  type VerificationCompletionInput,
} from "./workflow";

test("verification program transitions match RPC", () => {
  assert.equal(canTransitionVerificationProgram("NOT_STARTED", "TESTING"), true);
  assert.equal(canTransitionVerificationProgram("NOT_STARTED", "VERIFIED"), false);
  assert.equal(canTransitionVerificationProgram("TESTING", "VERIFICATION_REVIEW"), true);
  assert.equal(canTransitionVerificationProgram("TESTING", "NOT_STARTED"), true);
  assert.equal(canTransitionVerificationProgram("VERIFICATION_REVIEW", "VERIFIED"), true);
  assert.equal(canTransitionVerificationProgram("VERIFIED", "VERIFICATION_REVIEW"), true);
  assert.equal(canTransitionVerificationProgram("VERIFIED", "NOT_STARTED"), false);
});

test("case transitions stay finite", () => {
  assert.equal(canTransitionCase("PLANNED", "READY"), true);
  assert.equal(canTransitionCase("READY", "RUNNING"), true);
  assert.equal(canTransitionCase("RUNNING", "PASSED"), true);
  assert.equal(canTransitionCase("RUNNING", "FAILED"), true);
  assert.equal(canTransitionCase("PASSED", "READY"), true);
  assert.equal(canTransitionCase("FAILED", "RUNNING"), true);
  assert.equal(canTransitionCase("PLANNED", "PASSED"), false);
  assert.equal(canTransitionCase("NOT_APPLICABLE", "PASSED"), false);
});

test("human ids increment for TC and DEF", () => {
  assert.equal(nextHumanId("TC", []), "TC-001");
  assert.equal(nextHumanId("TC", ["TC-001", "TC-004"]), "TC-005");
  assert.equal(nextHumanId("DEF", ["DEF-009"]), "DEF-010");
  assert.equal(nextHumanId("DEF", ["TC-007"]), "DEF-001");
});

test("secret-looking evidence references are rejected", () => {
  assert.equal(rejectSecretEvidenceReference("inspector:run-abc").ok, true);
  assert.equal(rejectSecretEvidenceReference("sk-abcdefghijklmnopqrstuvwxyz").ok, false);
  assert.equal(rejectSecretEvidenceReference("").ok, false);
});

test("plan verification kinds map to case kinds", () => {
  assert.equal(mapPlanVerificationKind("UNIT"), "AUTOMATED");
  assert.equal(mapPlanVerificationKind("INTEGRATION"), "INTEGRATION");
  assert.equal(mapPlanVerificationKind("SECURITY"), "SECURITY");
  assert.equal(mapPlanVerificationKind("RLS"), "DATABASE_RLS");
  assert.equal(mapPlanVerificationKind("E2E"), "ACCEPTANCE");
  assert.equal(mapPlanVerificationKind("RESPONSIVE"), "RESPONSIVE");
  assert.equal(mapPlanVerificationKind("MANUAL"), "MANUAL_FUNCTIONAL");
  assert.equal(mapPlanVerificationKind("PRODUCTION"), "ACCEPTANCE");
  assert.equal(mapPlanVerificationKind("BUILD"), "AUTOMATED");
  assert.equal(mapPlanVerificationKind("PROVIDER"), "INTEGRATION");
});

test("blocking defects: HIGH/CRITICAL always; MEDIUM/LOW only when flagged", () => {
  assert.equal(isBlockingDefect("CRITICAL", false), true);
  assert.equal(isBlockingDefect("HIGH", false), true);
  assert.equal(isBlockingDefect("MEDIUM", false), false);
  assert.equal(isBlockingDefect("MEDIUM", true), true);
  assert.equal(isBlockingDefect("LOW", true), true);
  assert.equal(isBlockingDefect("LOW", false), false);
});

function baseCompletion(overrides: Partial<VerificationCompletionInput> = {}): VerificationCompletionInput {
  return {
    executionStatus: "IMPLEMENTED",
    programStatus: "VERIFICATION_REVIEW",
    cases: [
      {
        id: "c1",
        humanId: "TC-001",
        status: "PASSED",
        isRequired: true,
        requirementId: "r1",
        featureId: "f1",
      },
    ],
    evidence: [{ caseId: "c1" }],
    defects: [],
    requirements: [
      {
        id: "r1",
        humanId: "REQ-001",
        title: "Auth",
        priority: "HIGH",
        approvalStatus: "ACCEPTED",
      },
    ],
    features: [{ id: "f1", humanId: "FEAT-001", name: "Login", status: "APPROVED" }],
    openDecisions: 0,
    ...overrides,
  };
}

test("VERIFIED gate requires evidence, no blocking defects, and review status", () => {
  const ok = computeVerificationCompletion(baseCompletion());
  assert.equal(ok.verificationComplete, true);

  const noEvidence = computeVerificationCompletion(baseCompletion({ evidence: [] }));
  assert.equal(noEvidence.verificationComplete, false);
  assert.ok(noEvidence.gaps.some((gap) => gap.code.startsWith("EVIDENCE_")));

  const blocking = computeVerificationCompletion(
    baseCompletion({
      defects: [{ humanId: "DEF-001", severity: "HIGH", blocking: false, status: "OPEN" }],
    }),
  );
  assert.equal(blocking.verificationComplete, false);
  assert.ok(blocking.gaps.some((gap) => gap.code === "OPEN_BLOCKING_DEFECTS"));

  const mediumNonBlocking = computeVerificationCompletion(
    baseCompletion({
      defects: [{ humanId: "DEF-002", severity: "MEDIUM", blocking: false, status: "OPEN" }],
    }),
  );
  assert.equal(mediumNonBlocking.verificationComplete, true);

  const notReview = computeVerificationCompletion(baseCompletion({ programStatus: "TESTING" }));
  assert.equal(notReview.verificationComplete, false);

  const notImplemented = computeVerificationCompletion(baseCompletion({ executionStatus: "EXECUTING" }));
  assert.equal(notImplemented.verificationComplete, false);

  const failedCase = computeVerificationCompletion(
    baseCompletion({
      cases: [
        {
          id: "c1",
          humanId: "TC-001",
          status: "FAILED",
          isRequired: true,
          requirementId: "r1",
          featureId: "f1",
        },
      ],
    }),
  );
  assert.equal(failedCase.verificationComplete, false);
});

test("retest-required defects block VERIFIED until closed", () => {
  const result = computeVerificationCompletion(
    baseCompletion({
      defects: [{ humanId: "DEF-003", severity: "HIGH", blocking: true, status: "RETEST_REQUIRED" }],
    }),
  );
  assert.equal(result.verificationComplete, false);
});

test("regression coverage includes is_regression and linked implemented packages", () => {
  const result = computeRegressionCoverage({
    cases: [
      {
        id: "c1",
        humanId: "TC-001",
        status: "PASSED",
        isRequired: true,
        isRegression: true,
        workPackageId: null,
      },
      {
        id: "c2",
        humanId: "TC-002",
        status: "READY",
        isRequired: true,
        isRegression: false,
        workPackageId: "wp1",
      },
    ],
    packageExecutions: [{ workPackageId: "wp1", status: "IMPLEMENTED" }],
  });
  assert.equal(result.requiredRegressionCases.length, 2);
  assert.equal(result.covered, false);
  assert.ok(result.gaps.some((gap) => gap.includes("TC-002")));
});

test("suggest next action prioritizes blocking defects then ready cases", () => {
  const completion = computeVerificationCompletion(baseCompletion({ programStatus: "TESTING" }));
  const defectAction = suggestVerificationNextAction({
    completion,
    programStatus: "TESTING",
    cases: [{ status: "READY", isRequired: true, humanId: "TC-002" }],
    defects: [{ status: "OPEN", severity: "HIGH", blocking: true, humanId: "DEF-001" }],
  });
  assert.equal(defectAction?.title, "Correct blocking verification defect");

  const nextCase = suggestVerificationNextAction({
    completion,
    programStatus: "TESTING",
    cases: [{ status: "READY", isRequired: true, humanId: "TC-002" }],
    defects: [],
  });
  assert.equal(nextCase?.title, "Run next required verification case");
});
