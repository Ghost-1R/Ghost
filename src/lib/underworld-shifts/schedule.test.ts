import assert from "node:assert/strict";
import { test } from "node:test";
import { isWithinShift, shouldClaimNewTasks, zonedParts } from "./schedule";

test("weekday daytime in America/New_York is inside the default shift", () => {
  // Wednesday 2026-11-04 14:00 UTC = 09:00 ET
  const at = new Date("2026-11-04T14:00:00.000Z");
  const parts = zonedParts(at, "America/New_York");
  assert.equal(parts.weekday, 3);
  assert.equal(parts.hour, 9);
  assert.equal(isWithinShift(at), true);
  assert.equal(shouldClaimNewTasks({ at }), true);
});

test("weekday evening is outside the default shift", () => {
  // Wednesday 2026-11-04 22:00 UTC = 17:00 ET (exclusive end)
  const at = new Date("2026-11-04T22:00:00.000Z");
  assert.equal(isWithinShift(at), false);
  assert.equal(shouldClaimNewTasks({ at }), false);
});

test("weekend is outside the default shift", () => {
  // Saturday 2026-11-07 15:00 UTC = 10:00 ET
  const at = new Date("2026-11-07T15:00:00.000Z");
  assert.equal(isWithinShift(at), false);
});

test("forceWithinShift bypasses the clock for local verification", () => {
  const at = new Date("2026-11-07T15:00:00.000Z");
  assert.equal(shouldClaimNewTasks({ at, forceWithinShift: true }), true);
});
