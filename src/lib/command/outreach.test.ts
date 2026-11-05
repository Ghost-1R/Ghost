import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canOutreachAction,
  isMockSourceUrl,
  nextOutreachStage,
} from "./outreach";

test("valid stage transitions for outreach pipeline", () => {
  assert.equal(nextOutreachStage("new", "move_to_review"), "waiting");
  assert.equal(nextOutreachStage("new", "close"), "closed");
  assert.equal(nextOutreachStage("waiting", "mark_sent"), "sent");
  assert.equal(nextOutreachStage("waiting", "save_email"), "waiting");
  assert.equal(nextOutreachStage("sent", "mark_replied"), "replied");
  assert.equal(nextOutreachStage("replied", "mark_won"), "won");
  assert.equal(nextOutreachStage("new", "mark_sent"), null);
  assert.equal(canOutreachAction("won", "close"), false);
});

test("mock source URLs are detected for outreach blocking", () => {
  assert.equal(isMockSourceUrl("https://example.com/mock/norcross-fresh"), true);
  assert.equal(isMockSourceUrl("https://manta.com/listing/abc"), false);
  assert.equal(isMockSourceUrl(""), false);
});
