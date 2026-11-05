import assert from "node:assert/strict";
import test from "node:test";
import { answerSystemTruthQuestion } from "./truth";
import type { SystemArchitectureStatus } from "./types";

const ask = (
  question: string,
  status: SystemArchitectureStatus | null = "DESIGNING",
  entities: Array<{ humanId: string; rlsExpectation: string; status: "PROPOSED" | "APPROVED" | "REJECTED" | "RETIRED" }> = [],
) =>
  answerSystemTruthQuestion(question, {
    architecture: status ? { status } : null,
    readinessReasons: ["No approved component yet."],
    entities,
  });

test("past Ghost answers are not evidence", () => {
  const answer = ask("Did Ghost say the architecture was approved in a past response?");
  assert.ok(answer);
  assert.equal(answer.answer, "NO");
  assert.equal(answer.kind, "MODEL_SUGGESTION");
  assert.match(answer.reason, /not authoritative/i);
});

test("designed architecture is never implemented", () => {
  for (const status of ["DRAFT", "APPROVED", "ARCHITECTURE_READY"] as const) {
    const answer = ask("Is the architecture implemented?", status);
    assert.equal(answer?.answer, "NO");
    assert.equal(answer?.kind, "NOT_IMPLEMENTED");
    assert.match(answer?.reason ?? "", /design only/i);
  }
  assert.equal(ask("Is the architecture implemented?", null)?.answer, "NO");
});

test("the database is not deployed by a design", () => {
  const answer = ask("Is the database deployed?", "ARCHITECTURE_READY");
  assert.equal(answer?.answer, "NO");
  assert.equal(answer?.kind, "NOT_IMPLEMENTED");
});

test("the API is not live by a design", () => {
  const answer = ask("Is the API live?", "ARCHITECTURE_READY");
  assert.equal(answer?.answer, "NO");
  assert.equal(answer?.kind, "NOT_IMPLEMENTED");
});

test("RLS is planned, not implemented", () => {
  const planned = ask("Does RLS protect the data?", "ARCHITECTURE_READY", [
    { humanId: "ENT-001", rlsExpectation: "Owner only", status: "APPROVED" },
  ]);
  assert.equal(planned?.answer, "NO");
  assert.equal(planned?.kind, "PLANNED_CONTROL");
  assert.match(planned?.reason ?? "", /designed\/planned/i);
  assert.match(planned?.reason ?? "", /ENT-001/);
  const none = ask("Is row level security protecting users?", "DESIGNING", []);
  assert.equal(none?.answer, "NO");
  assert.equal(none?.kind, "PLANNED_CONTROL");
});

test("architecture is approved only when APPROVED or ARCHITECTURE_READY", () => {
  assert.equal(ask("Is the architecture approved?", "REVIEW")?.answer, "NO");
  assert.equal(ask("Is the architecture approved?", "DESIGNING")?.answer, "NO");
  assert.equal(ask("Is the architecture approved?", "APPROVED")?.answer, "YES");
  assert.equal(ask("Is the architecture approved?", "ARCHITECTURE_READY")?.answer, "YES");
  assert.equal(ask("Is the architecture approved?", null)?.answer, "UNKNOWN");
});

test("ready for a build plan only at ARCHITECTURE_READY", () => {
  const approved = ask("Is this ready for a build plan?", "APPROVED");
  assert.equal(approved?.answer, "NO");
  assert.match(approved?.reason ?? "", /not ARCHITECTURE_READY/);
  assert.equal(ask("Is the architecture ready for a build plan?", "REVIEW")?.answer, "NO");
  assert.equal(ask("Is the architecture ready for a build plan?", "ARCHITECTURE_READY")?.answer, "YES");
  assert.equal(ask("Is the architecture ready for a build plan?", null)?.answer, "UNKNOWN");
});

test("architecture readiness never means the product is deployed", () => {
  const answer = ask("Is the product deployed?", "ARCHITECTURE_READY");
  assert.equal(answer?.answer, "NO");
  assert.match(answer?.reason ?? "", /never means the product is deployed/i);
});

test("unrelated questions fall through", () => {
  assert.equal(ask("What colour is the logo?"), null);
});
