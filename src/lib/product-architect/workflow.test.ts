import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionProductArchitecture,
  computeProductReadiness,
  nextHumanId,
  suggestProductNextAction,
} from "./workflow";

test("product architecture transitions stay finite", () => {
  assert.equal(canTransitionProductArchitecture("DRAFT", "DEFINING"), true);
  assert.equal(canTransitionProductArchitecture("DRAFT", "BUILD_READY"), false);
  assert.equal(canTransitionProductArchitecture("APPROVED", "BUILD_READY"), true);
});

test("human ids increment within a project architecture", () => {
  assert.equal(nextHumanId("REQ", []), "REQ-001");
  assert.equal(nextHumanId("REQ", ["REQ-001", "REQ-003"]), "REQ-004");
  assert.equal(nextHumanId("FEAT", ["FEAT-009"]), "FEAT-010");
});

test("readiness is deterministic and lists concrete gaps", () => {
  const result = computeProductReadiness({
    architecture: { what: "", why: "why", who: "who", outcome: "outcome", status: "DEFINING" },
    requirements: [
      { humanId: "REQ-001", approvalStatus: "ACCEPTED", acceptanceCriteria: [], priority: "HIGH" },
    ],
    features: [
      { humanId: "FEAT-001", status: "APPROVED", acceptanceCriteria: [], requirementIds: [] },
    ],
    openQuestions: [{ question: "Guest access?", status: "OPEN" }],
    openCriticalDecisions: 1,
  });
  assert.equal(result.buildReady, false);
  assert.ok(result.gaps.some((gap) => gap.code === "DEFINITION_WHAT"));
  assert.ok(result.gaps.some((gap) => gap.message.includes("FEAT-001")));
  assert.ok(result.gaps.some((gap) => gap.message.includes("REQ-001")));
  assert.ok(result.gaps.some((gap) => gap.code === "OPEN_DECISIONS"));
});

test("build ready requires definition, accepted requirements, approved features, and no blockers", () => {
  const result = computeProductReadiness({
    architecture: {
      what: "Capture receipts",
      why: "Save time",
      who: "Freelancers",
      outcome: "Categorized expenses",
      status: "APPROVED",
    },
    requirements: [
      {
        humanId: "REQ-001",
        approvalStatus: "ACCEPTED",
        acceptanceCriteria: ["User can upload a receipt image"],
        priority: "HIGH",
      },
    ],
    features: [
      {
        humanId: "FEAT-001",
        status: "APPROVED",
        acceptanceCriteria: ["Upload succeeds and shows category picker"],
        requirementIds: ["req-uuid"],
      },
    ],
    openQuestions: [],
    openCriticalDecisions: 0,
  });
  assert.equal(result.buildReady, true);
});

test("next action follows the first justified product gap", () => {
  const action = suggestProductNextAction({
    architectureStatus: "DEFINING",
    proposedRequirementCount: 2,
    proposedFeatureCount: 0,
    readiness: {
      buildReady: false,
      gaps: [{ code: "NO_ACCEPTED_REQUIREMENTS", message: "No accepted requirements yet." }],
      reasons: ["No accepted requirements yet."],
    },
  });
  assert.ok(action);
  assert.match(action.title, /Review proposed requirements/i);
});
