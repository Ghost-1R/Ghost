import assert from "node:assert/strict";
import test from "node:test";
import {
  decisionCreatesFollowUp,
  founderRemainsDecisionMaker,
  validateDecisionDraft,
  validateDecisionResolution,
} from "./workflow";

test("decision drafts require a real question and never invent options", () => {
  assert.match(validateDecisionDraft({ projectId: "p", title: "", question: "Which provider?" }) ?? "", /title/);
  assert.match(validateDecisionDraft({ projectId: "p", title: "Provider", question: "" }) ?? "", /question/);
  assert.equal(
    validateDecisionDraft({
      projectId: "p",
      title: "Provider",
      question: "Which payment provider?",
      options: [{ id: "square", label: "Square" }],
    }),
    null,
  );
});

test("resolution preserves founder judgment and can mint one follow-up action", () => {
  assert.equal(founderRemainsDecisionMaker("founder"), true);
  assert.equal(founderRemainsDecisionMaker("ghost"), false);
  assert.match(validateDecisionResolution({ status: "RESOLVED" }) ?? "", /selected option|response/);
  assert.equal(
    validateDecisionResolution({ status: "RESOLVED", selectedOption: "Square", followUpAction: { title: "Integrate Square" } }),
    null,
  );
  assert.equal(decisionCreatesFollowUp({ status: "RESOLVED", selectedOption: "Square", followUpAction: { title: "Integrate Square" } }), true);
  assert.equal(decisionCreatesFollowUp({ status: "CANCELLED", followUpAction: { title: "Nope" } }), false);
  assert.match(validateDecisionResolution({ status: "CANCELLED", followUpAction: { title: "Nope" } }) ?? "", /cannot create/);
});
