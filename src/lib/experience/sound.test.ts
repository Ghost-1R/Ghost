import assert from "node:assert/strict";
import test from "node:test";
import { nextSoundStart, readSoundPreference, shouldEmitSound, soundLength, SOUND_EVENTS } from "./sound";

test("sound preference ignores malformed storage", () => {
  assert.equal(readSoundPreference(null).enabled, true);
  assert.equal(readSoundPreference("{").enabled, true);
  assert.equal(readSoundPreference(JSON.stringify({ enabled: false, volume: 4 })).volume, 1);
  assert.equal(readSoundPreference(JSON.stringify({ enabled: false, volume: 4 })).enabled, false);
});

test("the same sound does not retrigger during a rerender window", () => {
  assert.equal(shouldEmitSound(null, "ghost.notification", 1000), true);
  assert.equal(shouldEmitSound({ event: "ghost.notification", at: 1000 }, "ghost.notification", 1400), false);
  assert.equal(shouldEmitSound({ event: "ghost.notification", at: 1000 }, "ghost.warning", 1100), true);
  assert.equal(shouldEmitSound({ event: "ghost.success", at: 1000 }, "ghost.success", 1800), true);
});

test("every semantic event has a name and a short sound", () => {
  assert.equal(SOUND_EVENTS.length, 8);
  for (const event of SOUND_EVENTS) {
    assert.ok(soundLength(event) > 0 && soundLength(event) <= 0.4, event);
  }
});

test("a second sound waits for the first and a long backlog is dropped", () => {
  assert.equal(nextSoundStart(10, 0), 10);
  assert.equal(nextSoundStart(10, 10.3), 10.3);
  assert.equal(nextSoundStart(10, 11), null);
});
