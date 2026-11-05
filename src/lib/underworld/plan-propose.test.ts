import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { proposeBoundedUnderworldPlan, reviewerIsIndependent } from "@/lib/underworld/plan-propose";

describe("underworld plan propose", () => {
  it("builds a deterministic planner → executor → reviewer plan", () => {
    const a = proposeBoundedUnderworldPlan({ title: "Ship map", objective: "Verify ZIP aggregates" });
    const b = proposeBoundedUnderworldPlan({ title: "Ship map", objective: "Verify ZIP aggregates" });
    assert.equal(a.steps.length, 3);
    assert.deepEqual(
      a.steps.map((s) => s.role),
      ["PLANNER", "EXECUTOR", "REVIEWER"],
    );
    assert.equal(a.scopeFingerprint, b.scopeFingerprint);
    assert.match(a.scopeSummary, /LIVE=0/);
  });

  it("requires independent reviewer", () => {
    assert.equal(reviewerIsIndependent("u1", "u2"), true);
    assert.equal(reviewerIsIndependent("u1", "u1"), false);
    assert.equal(reviewerIsIndependent(null, "u1"), true);
  });
});
