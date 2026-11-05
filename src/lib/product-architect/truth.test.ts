import assert from "node:assert/strict";
import test from "node:test";
import { answerProductTruthQuestion, isFeatureApproved, isRequirementAuthoritative } from "./truth";
import type { ProductArchitecture, ProductFeature, ProductRequirement } from "./types";

const architecture = (overrides: Partial<ProductArchitecture> = {}): ProductArchitecture => ({
  id: "a1",
  projectId: "p1",
  ideaId: null,
  strategyId: null,
  what: "A receipt capture tool",
  why: "Freelancers lose time",
  who: "Freelancers",
  outcome: "Faster categorization",
  nonGoals: [],
  assumptions: [],
  risks: [],
  constraints: [],
  status: "DEFINING",
  note: "",
  approvedAt: null,
  approvedBy: null,
  createdAt: "",
  updatedAt: "",
  ...overrides,
});

test("proposed requirements are not authoritative", () => {
  const answer = isRequirementAuthoritative({ humanId: "REQ-001", approvalStatus: "PROPOSED" });
  assert.equal(answer.answer, "NO");
  assert.match(answer.reason, /PROPOSED/i);
});

test("accepted requirements are authoritative", () => {
  const answer = isRequirementAuthoritative({ humanId: "REQ-002", approvalStatus: "ACCEPTED" });
  assert.equal(answer.answer, "YES");
  assert.equal(answer.kind, "ACCEPTED_REQUIREMENT");
});

test("proposed features are not approved", () => {
  const answer = isFeatureApproved({ humanId: "FEAT-001", status: "PROPOSED" });
  assert.equal(answer.answer, "NO");
});

test("past Ghost answers are not evidence", () => {
  const answer = answerProductTruthQuestion("Did Ghost say this was approved in a past response?", {
    architecture: architecture(),
    requirements: [],
    features: [],
    buildReady: false,
    readinessReasons: ["missing"],
  });
  assert.ok(answer);
  assert.equal(answer.answer, "NO");
  assert.match(answer.reason, /not authoritative/i);
});

test("build readiness comes from records only", () => {
  const no = answerProductTruthQuestion("Is this ready for architecture?", {
    architecture: architecture(),
    requirements: [{ approvalStatus: "PROPOSED" } as ProductRequirement],
    features: [{ status: "PROPOSED" } as ProductFeature],
    buildReady: false,
    readinessReasons: ["No accepted requirements yet."],
  });
  assert.equal(no?.answer, "NO");
  const yes = answerProductTruthQuestion("Is this build ready?", {
    architecture: architecture({ status: "BUILD_READY" }),
    requirements: [],
    features: [],
    buildReady: true,
    readinessReasons: [],
  });
  assert.equal(yes?.answer, "YES");
});
