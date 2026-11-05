import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeMapScope } from "./types";
import {
  AI_CHARGE_LABEL,
  buildAssignmentPanelPreview,
  canCompleteReview,
  canHandOff,
  canSubmitForReview,
  canUpdateProgress,
  nextStatusAfterReview,
  validateAssignmentText,
} from "./workflow";

test("status gates for progress, submit, review, and hand-off", () => {
  assert.equal(canUpdateProgress("ASSIGNED"), true);
  assert.equal(canUpdateProgress("COMPLETED"), false);
  assert.equal(canSubmitForReview("IN_PROGRESS"), true);
  assert.equal(canSubmitForReview("SUBMITTED"), false);
  assert.equal(canCompleteReview("SUBMITTED"), true);
  assert.equal(canCompleteReview("ASSIGNED"), false);
  assert.equal(canHandOff("AI", "SUBMITTED"), true);
  assert.equal(canHandOff("AI", "ASSIGNED"), false);
  assert.equal(canHandOff("HUMAN", "SUBMITTED"), false);
  assert.equal(nextStatusAfterReview("APPROVE"), "COMPLETED");
  assert.equal(nextStatusAfterReview("REQUEST_CHANGES"), "IN_PROGRESS");
});

test("validateAssignmentText trims, bounds, and normalizes due date", () => {
  const ok = validateAssignmentText({ title: "  Call lead ", instructions: " do it ", dueAt: "2026-12-01" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.title, "Call lead");
    assert.equal(ok.instructions, "do it");
    assert.ok(ok.dueAt?.startsWith("2026-12-01"));
  }
  assert.equal(validateAssignmentText({ title: "  ", instructions: "" }).ok, false);
  assert.equal(validateAssignmentText({ title: "x".repeat(201), instructions: "" }).ok, false);
  assert.equal(validateAssignmentText({ title: "x", instructions: "", dueAt: "nope" }).ok, false);
});

test("AI preview states MOCK and $0; human preview has no charge label", () => {
  const base = {
    projectName: "Ivoire",
    taskTitle: null,
    title: "Review",
    instructions: "",
    dueAt: null,
    assigneeLabel: null,
    mapScope: null,
  };
  assert.equal(buildAssignmentPanelPreview({ ...base, kind: "AI" }).chargeLabel, AI_CHARGE_LABEL);
  assert.match(AI_CHARGE_LABEL, /MOCK/);
  assert.equal(buildAssignmentPanelPreview({ ...base, kind: "HUMAN" }).chargeLabel, null);
});

test("sanitizeMapScope keeps only aggregate fields and drops empty scopes", () => {
  const scope = sanitizeMapScope({
    states: ["ny", "NYC", 5],
    zips: ["10001", "1000", "10001"],
    radius: { centerZip: "10001", miles: 25 },
    dateFrom: "2026-01-01",
    address: "1 Main St",
    customerKey: "secret",
  });
  assert.deepEqual(scope, {
    states: ["NY"],
    zips: ["10001"],
    radius: { centerZip: "10001", miles: 25 },
    dateFrom: "2026-01-01",
    dateTo: null,
  });
  assert.equal(JSON.stringify(scope).includes("Main St"), false);
  assert.equal(sanitizeMapScope({ states: [], zips: [] }), null);
  assert.equal(sanitizeMapScope(null), null);
});
