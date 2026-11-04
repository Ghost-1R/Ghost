import assert from "node:assert/strict";
import test from "node:test";
import {
  answerIdeaTruthQuestion,
  didCustomersConfirmProblem,
  isDeployed,
  isIdeaValidated,
  isProductBuilt,
  isStrategyApproved,
} from "./truth";
import type { IdeaEvidence, IdeaRecord, IdeaStrategy, IdeaValidation } from "./types";

const idea = (overrides: Partial<IdeaRecord> = {}): IdeaRecord => ({
  id: "idea-1",
  ownerId: "u1",
  title: "Receipt helper",
  rawIdea: "Help freelancers categorize receipts.",
  summary: "",
  problem: "Receipt chaos",
  targetUser: "Freelancers",
  proposedSolution: "Lightweight categorizer",
  valueProposition: "",
  assumptions: [],
  risks: [],
  opportunities: [],
  constraints: [],
  openQuestions: [],
  recommendation: null,
  status: "EXPLORING",
  readiness: "EARLY",
  note: "",
  promotedProjectId: null,
  createdAt: "2026-10-05T00:00:00Z",
  updatedAt: "2026-10-05T00:00:00Z",
  ...overrides,
});

test("AI analysis alone does not validate an idea", () => {
  const answer = isIdeaValidated({ idea: idea(), validations: [], evidence: [] });
  assert.equal(answer.answer, "NO");
  assert.match(answer.reason, /not validation/i);
});

test("customer confirmation requires customer feedback evidence", () => {
  assert.equal(didCustomersConfirmProblem([]).answer, "UNKNOWN");
  assert.equal(
    didCustomersConfirmProblem([{ evidenceType: "CUSTOMER_FEEDBACK" } as IdeaEvidence]).answer,
    "YES",
  );
});

test("strategy approval requires founder approved_at", () => {
  assert.equal(isStrategyApproved(null).answer, "NO");
  assert.equal(isStrategyApproved({ approvedAt: null } as IdeaStrategy).answer, "NO");
  assert.equal(isStrategyApproved({ approvedAt: "2026-10-05T00:00:00Z" } as IdeaStrategy).answer, "YES");
});

test("promotion is not implementation or deployment", () => {
  assert.equal(isProductBuilt({ idea: idea({ status: "PROMOTED", promotedProjectId: "p1" }) }).answer, "NO");
  assert.equal(isDeployed(null).answer, "NO");
  assert.equal(isDeployed("NOT_VERIFIED").answer, "NO");
  assert.equal(isDeployed("VERIFIED").answer, "YES");
});

test("truth question router covers the V5 regression prompts", () => {
  const validations: IdeaValidation[] = [];
  const evidence: IdeaEvidence[] = [];
  assert.equal(
    answerIdeaTruthQuestion("Is this idea validated?", {
      idea: idea(),
      strategy: null,
      validations,
      evidence,
    })?.answer,
    "NO",
  );
  assert.equal(
    answerIdeaTruthQuestion("Did customers confirm this problem?", {
      idea: idea(),
      strategy: null,
      validations,
      evidence,
    })?.answer,
    "UNKNOWN",
  );
  assert.equal(
    answerIdeaTruthQuestion("Is this strategy approved?", {
      idea: idea(),
      strategy: null,
      validations,
      evidence,
    })?.answer,
    "NO",
  );
  assert.equal(
    answerIdeaTruthQuestion("Is this product built?", {
      idea: idea({ status: "PROMOTED", promotedProjectId: "p1" }),
      strategy: null,
      validations,
      evidence,
    })?.answer,
    "NO",
  );
  assert.equal(
    answerIdeaTruthQuestion("Is this deployed?", {
      idea: idea({ status: "PROMOTED" }),
      strategy: null,
      validations,
      evidence,
      productionVerification: null,
    })?.answer,
    "NO",
  );
});
