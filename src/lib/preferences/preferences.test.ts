import assert from "node:assert/strict";
import { test } from "node:test";
import { companionPersonalityGrounding } from "./personality";
import { normalizePreferences, parsePreferencesForm, preferencesFromRow } from "./store";
import { DEFAULT_FOUNDER_PREFERENCES } from "./types";

test("normalizePreferences rejects unknown enums and clamps volume", () => {
  const prefs = normalizePreferences({
    responseStyle: "hostile" as never,
    responseDetail: "BALANCED",
    soundEnabled: false,
    soundVolume: 9,
    reduceMotion: true,
    appearance: "neon" as never,
  });
  assert.equal(prefs.responseStyle, "DIRECT");
  assert.equal(prefs.appearance, "DARK");
  assert.equal(prefs.soundVolume, 1);
  assert.equal(prefs.soundEnabled, false);
  assert.equal(prefs.reduceMotion, true);
});

test("parsePreferencesForm requires checkbox presence for booleans", () => {
  const form = new FormData();
  form.set("responseStyle", "WARM");
  form.set("responseDetail", "BRIEF");
  form.set("appearance", "LIGHT");
  form.set("soundVolume", "0.2");
  const parsed = parsePreferencesForm(form);
  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;
  assert.equal(parsed.responseStyle, "WARM");
  assert.equal(parsed.responseDetail, "BRIEF");
  assert.equal(parsed.soundEnabled, false);
  assert.equal(parsed.reduceMotion, false);
  assert.equal(parsed.soundVolume, 0.2);
});

test("preferencesFromRow maps database columns", () => {
  const prefs = preferencesFromRow({
    owner_id: "a",
    response_style: "FORMAL",
    response_detail: "DETAILED",
    sound_enabled: true,
    sound_volume: "0.5",
    reduce_motion: false,
    appearance: "SYSTEM",
  });
  assert.deepEqual(prefs, {
    responseStyle: "FORMAL",
    responseDetail: "DETAILED",
    soundEnabled: true,
    soundVolume: 0.5,
    reduceMotion: false,
    appearance: "SYSTEM",
  });
});

test("personality grounding uses enums only and keeps hard boundaries", () => {
  const text = companionPersonalityGrounding({
    ...DEFAULT_FOUNDER_PREFERENCES,
    responseStyle: "WARM",
    responseDetail: "BRIEF",
  });
  assert.match(text, /warm/i);
  assert.match(text, /short/i);
  assert.match(text, /never override provider privacy/i);
  assert.ok(!/ignore previous|system prompt|jailbreak/i.test(text));
});

test("defaults are stable for missing rows", () => {
  assert.deepEqual(preferencesFromRow(null), DEFAULT_FOUNDER_PREFERENCES);
});
