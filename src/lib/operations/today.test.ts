import assert from "node:assert/strict";
import test from "node:test";
import { explainTodayPriority, isAuthoritativeAction, prioritizeTodayActions, type TodayAction } from "./today";

const action = (partial: Partial<TodayAction> & Pick<TodayAction, "id" | "title">): TodayAction => ({
  projectId: "p1",
  projectName: "GHOST",
  description: "",
  status: "OPEN",
  priority: "NORMAL",
  provenance: "FOUNDER_APPROVED_ACTION",
  requiresDecision: false,
  sourceKind: "founder_instruction",
  ...partial,
});

test("today prioritization is deterministic and never invents rows", () => {
  assert.deepEqual(prioritizeTodayActions([]), []);
  const ordered = prioritizeTodayActions([
    action({ id: "1", title: "Normal open" }),
    action({ id: "2", title: "Needs decision", requiresDecision: true }),
    action({ id: "3", title: "Blocked", status: "BLOCKED" }),
    action({ id: "4", title: "High", priority: "HIGH" }),
    action({ id: "5", title: "Active", status: "IN_PROGRESS" }),
    action({ id: "6", title: "Done", status: "DONE" }),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["2", "3", "4", "5", "1"],
  );
});

test("recommendations are visible but not authoritative project truth", () => {
  assert.equal(isAuthoritativeAction(action({ id: "a", title: "x", provenance: "RECOMMENDATION" })), false);
  assert.equal(isAuthoritativeAction(action({ id: "a", title: "x", provenance: "FACT" })), true);
  assert.equal(explainTodayPriority(action({ id: "a", title: "x", requiresDecision: true })), "Waiting on a founder decision.");
});
