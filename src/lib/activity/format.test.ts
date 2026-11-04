import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPresenceEvent,
  formatRelativeTime,
  mergeTimeline,
  presenceSummaryLines,
  presenceToTimelineEntry,
  summarizePresence,
} from "./format";
import { STATE_TILES } from "../sales-map/state-grid";

const now = new Date("2026-11-04T18:00:00Z");

test("formatPresenceEvent labels SIGN_IN / SIGN_OUT / LAST_ACTIVE", () => {
  assert.match(formatPresenceEvent({ eventType: "SIGN_IN", observedAt: "2026-11-04T17:00:00Z" }), /^Signed in · /);
  assert.match(formatPresenceEvent({ eventType: "SIGN_OUT", observedAt: "2026-11-04T17:00:00Z" }), /^Signed out · /);
  assert.match(formatPresenceEvent({ eventType: "LAST_ACTIVE", observedAt: "2026-11-04T17:00:00Z" }), /^Last active · /);
});

test("formatRelativeTime", () => {
  assert.equal(formatRelativeTime("2026-11-04T17:59:50Z", now), "just now");
  assert.equal(formatRelativeTime("2026-11-04T17:30:00Z", now), "30 min ago");
  assert.equal(formatRelativeTime("2026-11-04T15:00:00Z", now), "3 hr ago");
  assert.equal(formatRelativeTime("2026-11-03T18:00:00Z", now), "yesterday");
});

test("summarizePresence tracks signed-in state and latest events", () => {
  const summary = summarizePresence([
    { eventType: "SIGN_IN", observedAt: "2026-11-04T10:00:00Z" },
    { eventType: "SIGN_OUT", observedAt: "2026-11-04T11:00:00Z" },
    { eventType: "SIGN_IN", observedAt: "2026-11-04T12:00:00Z" },
    { eventType: "LAST_ACTIVE", observedAt: "2026-11-04T12:30:00Z" },
  ]);
  assert.equal(summary.signedIn, true);
  assert.equal(summary.lastSignIn, "2026-11-04T12:00:00Z");
  assert.equal(summary.lastActive, "2026-11-04T12:30:00Z");
  assert.equal(summarizePresence([]).signedIn, false);
  const lines = presenceSummaryLines(summarizePresence([]), now);
  assert.deepEqual(lines, [
    "Last sign-in: never recorded",
    "Last sign-out: never recorded",
    "Last active: never recorded",
  ]);
});

test("mergeTimeline sorts newest first across sources", () => {
  const presence = presenceToTimelineEntry({
    id: "p1",
    userId: "u",
    companyId: "c",
    eventType: "SIGN_IN",
    observedAt: "2026-11-04T12:00:00Z",
  });
  const activity = { ...presence, id: "activity:a1", source: "activity" as const, at: "2026-11-04T13:00:00Z" };
  assert.deepEqual(mergeTimeline([presence], [activity]).map((entry) => entry.id), ["activity:a1", "presence:p1"]);
});

test("state grid has 50 states plus DC with unique cells", () => {
  assert.equal(STATE_TILES.length, 51);
  assert.equal(new Set(STATE_TILES.map((tile) => tile.code)).size, 51);
  assert.equal(new Set(STATE_TILES.map((tile) => `${tile.col},${tile.row}`)).size, 51);
});
