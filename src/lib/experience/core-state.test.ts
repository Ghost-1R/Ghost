import assert from "node:assert/strict";
import test from "node:test";
import { presentationCoreState } from "./core-state";

test("the core shows ready or verified only from a fresh review", () => {
  assert.equal(presentationCoreState("READY", "fresh"), "READY");
  assert.equal(presentationCoreState("READY_WITH_GAPS", "fresh"), "VERIFIED");
  assert.equal(presentationCoreState("NOT_READY", "fresh"), "BLOCKED");
  assert.equal(presentationCoreState("READY", "stale"), "IDLE");
  assert.equal(presentationCoreState("NOT_READY", "stale"), "IDLE");
  assert.equal(presentationCoreState(null, null), "IDLE");
});
