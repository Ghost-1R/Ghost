import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canSendInWindow, withinBusinessHours } from "./schedule";

describe("outreach business hours", () => {
  it("allows 9–17 ET window mid-day weekday", () => {
    // 2026-11-05 14:00 America/New_York = 19:00 UTC
    const at = new Date("2026-11-05T19:00:00.000Z");
    assert.equal(withinBusinessHours(at, 9, 17), true);
    assert.equal(canSendInWindow(at, 9, 17), true);
  });

  it("blocks outside window", () => {
    // 2026-11-05 08:00 ET = 13:00 UTC
    const at = new Date("2026-11-05T13:00:00.000Z");
    assert.equal(withinBusinessHours(at, 9, 17), false);
  });

  it("blocks weekends", () => {
    // Saturday 2026-11-07 15:00 ET = 20:00 UTC
    const at = new Date("2026-11-07T20:00:00.000Z");
    assert.equal(canSendInWindow(at, 9, 17), false);
  });
});
