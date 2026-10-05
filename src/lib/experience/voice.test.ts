import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardHero, HERO_PATH } from "../../components/ghost/hero";
import { REDACTED } from "../security/redact";
import {
  autoReadTarget,
  createVoiceController,
  DEFAULT_VOICE,
  pickVoice,
  readVoicePreference,
  speechChunks,
  speechText,
  type SynthLike,
  type VoiceLike,
} from "./voice";

type FakeUtterance = Parameters<SynthLike["speak"]>[0];

const LOCAL: VoiceLike = { voiceURI: "local-en", name: "Local", lang: "en-US", localService: true, default: true };
const NETWORK: VoiceLike = { voiceURI: "net-en", name: "Google US English", lang: "en-US", localService: false, default: false };

function fakeSynth(voices: VoiceLike[] = [LOCAL]) {
  const spoken: FakeUtterance[] = [];
  const calls = { cancel: 0, pause: 0, resume: 0 };
  const synth: SynthLike = {
    speak: (utterance) => spoken.push(utterance),
    cancel: () => {
      calls.cancel += 1;
    },
    pause: () => {
      calls.pause += 1;
    },
    resume: () => {
      calls.resume += 1;
    },
    getVoices: () => voices,
  };
  const controller = createVoiceController(synth, (text) => ({ text, rate: 1, lang: "", voice: null, onend: null, onerror: null }));
  return { controller, spoken, calls };
}

const syntheticKey = () => ["gsk", "SyntheticFakeKeyValue0000000000000000000000000000"].join("_");

test("auto-read defaults OFF and only an explicit true turns it on", () => {
  assert.equal(DEFAULT_VOICE.autoRead, false);
  assert.equal(readVoicePreference(null).autoRead, false);
  assert.equal(readVoicePreference("{").autoRead, false);
  assert.equal(readVoicePreference(JSON.stringify({ autoRead: "true" })).autoRead, false);
  assert.equal(readVoicePreference(JSON.stringify({ autoRead: 1 })).autoRead, false);
  assert.equal(readVoicePreference(JSON.stringify({ autoRead: true })).autoRead, true);
  assert.equal(readVoicePreference(JSON.stringify({ rate: 9 })).rate, 2);
  assert.equal(readVoicePreference(JSON.stringify({ enabled: false })).enabled, false);
});

test("auto-read picks nothing unless the preference is on", () => {
  const messages = [
    { id: "u1", role: "user", content: "hi" },
    { id: "a1", role: "assistant", content: "Hello." },
  ];
  assert.equal(autoReadTarget(null, messages, DEFAULT_VOICE), null);
  const on = { ...DEFAULT_VOICE, autoRead: true };
  assert.equal(autoReadTarget(null, messages, on)?.id, "a1");
  assert.equal(autoReadTarget("a1", messages, on), null);
  assert.equal(autoReadTarget(null, messages, { ...on, enabled: false }), null);
});

test("playback moves through playing, paused, resumed, and idle", () => {
  const { controller, spoken, calls } = fakeSynth();
  const seen: string[] = [];
  controller.subscribe(() => seen.push(controller.getSnapshot().status));

  assert.equal(controller.play("a1", "First sentence. Second sentence.", DEFAULT_VOICE), "started");
  assert.deepEqual(controller.getSnapshot(), { status: "playing", messageId: "a1" });
  assert.equal(spoken[0].voice, LOCAL);
  assert.equal(spoken[0].rate, 1);

  controller.pause();
  assert.equal(controller.getSnapshot().status, "paused");
  controller.resume();
  assert.equal(controller.getSnapshot().status, "playing");
  assert.equal(calls.pause, 1);
  assert.equal(calls.resume, 1);

  spoken.at(-1)?.onend?.();
  assert.deepEqual(controller.getSnapshot(), { status: "idle", messageId: null });
  assert.deepEqual(seen, ["playing", "paused", "playing", "idle"]);
});

test("pressing play twice on the same answer does not queue duplicate speech", () => {
  const { controller, spoken, calls } = fakeSynth();
  controller.play("a1", "Only once.", DEFAULT_VOICE);
  const batch = spoken.length;
  assert.equal(controller.play("a1", "Only once.", DEFAULT_VOICE), "duplicate");
  assert.equal(spoken.length, batch);
  assert.equal(calls.cancel, 1);

  controller.pause();
  assert.equal(controller.play("a1", "Only once.", DEFAULT_VOICE), "resumed");
  assert.equal(spoken.length, batch);
  assert.equal(controller.getSnapshot().status, "playing");
});

test("selecting another answer cancels the first and ignores its stale events", () => {
  const { controller, spoken, calls } = fakeSynth();
  controller.play("a1", "First answer.", DEFAULT_VOICE);
  const first = spoken.at(-1);
  controller.play("a2", "Second answer.", DEFAULT_VOICE);
  assert.equal(calls.cancel, 2);
  assert.equal(controller.getSnapshot().messageId, "a2");

  first?.onend?.();
  first?.onerror?.();
  assert.deepEqual(controller.getSnapshot(), { status: "playing", messageId: "a2" });
});

test("stop halts playback, and stop for another answer is ignored", () => {
  const { controller, spoken } = fakeSynth();
  controller.play("a1", "Something to say.", DEFAULT_VOICE);
  controller.stop("a2");
  assert.equal(controller.getSnapshot().status, "playing");
  controller.stop("a1");
  assert.deepEqual(controller.getSnapshot(), { status: "idle", messageId: null });

  controller.play("a1", "Again.", DEFAULT_VOICE);
  const last = spoken.at(-1);
  controller.stop();
  assert.equal(controller.getSnapshot().status, "idle");
  last?.onend?.();
  assert.equal(controller.getSnapshot().status, "idle");
});

test("speech never falls back to a network voice", () => {
  assert.equal(pickVoice([NETWORK, LOCAL], "net-en"), LOCAL);
  assert.equal(pickVoice([NETWORK], null), null);

  const { controller, spoken } = fakeSynth([NETWORK]);
  assert.equal(controller.play("a1", "Private answer.", DEFAULT_VOICE), "no_local_voice");
  assert.equal(spoken.length, 0);
  assert.equal(controller.getSnapshot().status, "idle");
});

test("disabled or unsupported speech says nothing", () => {
  const { controller, spoken } = fakeSynth();
  assert.equal(controller.play("a1", "Hello.", { ...DEFAULT_VOICE, enabled: false }), "disabled");
  assert.equal(spoken.length, 0);
  const none = createVoiceController(null, (text) => ({ text, rate: 1, lang: "", voice: null, onend: null, onerror: null }));
  assert.equal(none.play("a1", "Hello.", DEFAULT_VOICE), "unavailable");
  assert.equal(controller.play("a1", "   ", DEFAULT_VOICE), "empty");
});

test("only the visible answer is spoken, with sources, citations, code, and secrets removed", () => {
  const key = syntheticKey();
  const content = [
    "## Next step",
    "",
    `Ship the **hero** first 【4:0†source】. Rotate ${key} later.`,
    "",
    "1. Plan",
    "2. Build",
    "",
    "```ts",
    "const secret = process.env.GROQ_API_KEY;",
    "```",
    "",
    "<script>alert(1)</script>",
    "",
    "Sources:",
    "- Founder Rule: never deploy Friday",
    "- project_memory: internal note",
  ].join("\n");
  const text = speechText(content);

  assert.match(text, /^Next step\./);
  assert.match(text, /Ship the hero first\./);
  assert.match(text, /1\. Plan\. 2\. Build\./);
  assert.match(text, /Code block omitted\./);
  assert.ok(text.includes(REDACTED));
  for (const forbidden of [key, "GROQ_API_KEY", "process.env", "Sources", "Founder Rule", "project_memory", "【", "**", "##"]) {
    assert.ok(!text.includes(forbidden), `speech leaked ${forbidden}`);
  }

  const { controller, spoken } = fakeSynth();
  controller.play("a1", text, DEFAULT_VOICE);
  const said = spoken.map((utterance) => utterance.text).join(" ");
  assert.ok(!said.includes(key));
  assert.ok(!said.includes("Founder Rule"));
});

test("long answers are chunked under the browser utterance limit without losing words", () => {
  const long = Array.from({ length: 120 }, (_, index) => `word${index}`).join(" ") + ". Done.";
  const chunks = speechChunks(long);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 220));
  assert.equal(chunks.join(" ").split(/\s+/).length, long.split(/\s+/).length);
});

test("conversation hands the reader only the final answer, and the reader has no network path", () => {
  const conversation = readFileSync(new URL("../../components/ghost/conversation.tsx", import.meta.url), "utf8");
  assert.match(conversation, /<VoiceControls messageId=\{message\.id\} source=\{splitAnswer\(message\.content\)\.answer\} \/>/);
  assert.equal(conversation.match(/<VoiceControls/g)?.length, 1);
  assert.match(conversation, /useVoiceReader\(`\$\{ideaId \?\? projectId \?\? "all"\}:\$\{conversationId \?\? "new"\}`, messages\)/);

  const component = readFileSync(new URL("../../components/ghost/voice.tsx", import.meta.url), "utf8");
  const library = readFileSync(new URL("./voice.ts", import.meta.url), "utf8");
  for (const source of [component, library]) {
    assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(source));
  }
  const plays = component.match(/\.play\([^;]*/g) ?? [];
  assert.ok(plays.length >= 2);
  for (const call of plays) {
    assert.ok(call.includes("speechText(") || call.includes("VOICE_TEST_ID"), call);
  }
  assert.match(component, /return \(\) => voiceController\(\)\.stop\(\);\s*\}, \[contextKey\]\)/);
});

test("the dashboard hero carries the brand copy and no invented numbers", () => {
  const html = renderToStaticMarkup(createElement(DashboardHero));
  const text = html.replace(/<[^>]+>/g, " ");
  assert.match(html, /<h1 class="hero-title" id="hero-title" aria-label="Ghost">/);
  assert.match(text.replace(/\s+/g, ""), /^GHOST/);
  assert.ok(text.includes("Your second mind"));
  assert.ok(text.includes("From idea to launch — built your way."));
  for (const step of HERO_PATH) assert.ok(text.includes(step));
  assert.deepEqual([...HERO_PATH], ["Plan", "Design", "Build", "Test", "Deploy", "Learn", "Grow"]);
  assert.match(html, /alt=""/);
  assert.match(html, /class="hero-art" aria-hidden="true"/);
  assert.ok(!/[0-9%]/.test(text), `hero text has numbers: ${text}`);
  assert.match(text, /Core\s+IDLE/);
});

test("the hero artwork ships at its native high resolution", () => {
  const webp = readFileSync(new URL("../../../public/ghost/hero.webp", import.meta.url));
  assert.equal(webp.toString("ascii", 0, 4), "RIFF");
  assert.equal(webp.toString("ascii", 8, 12), "WEBP");
  const chunk = webp.toString("ascii", 12, 16);
  const [width, height] =
    chunk === "VP8X"
      ? [1 + webp.readUIntLE(24, 3), 1 + webp.readUIntLE(27, 3)]
      : chunk === "VP8L"
        ? [1 + (webp.readUInt32LE(21) & 0x3fff), 1 + ((webp.readUInt32LE(21) >> 14) & 0x3fff)]
        : [webp.readUInt16LE(26) & 0x3fff, webp.readUInt16LE(28) & 0x3fff];
  assert.ok(width >= 1900, `hero is only ${width}px wide`);
  assert.ok(Math.abs(width / height - 2.5) < 0.05, `hero aspect ${width}x${height}`);
  assert.ok(webp.length < 350_000, `hero weighs ${webp.length} bytes`);
});

test("the hero recomposes for mobile and the motion stops under reduced motion", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const mobile = css.match(/@media \(max-width: 639px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(mobile, /\.hero \{[^}]*align-items: end/);
  assert.match(mobile, /\.hero-image \{[^}]*object-position:/);
  assert.match(mobile, /\.hero-title \{[^}]*font-size:/);
  assert.match(mobile, /\.voice-button \{[^}]*min-height: 2\.75rem/);
  assert.match(mobile, /\.command-dock \{[^}]*width: calc\(100% - 1rem\)/);

  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  for (const selector of [".hero-image", ".voice-wave span", ".ghost-core-ring", ".ghost-core-node"]) {
    assert.ok(reduced.includes(selector), `reduced motion misses ${selector}`);
  }
  assert.match(reduced, /animation: none/);
  assert.match(reduced, /\.hero-image \{\s*transform: none/);
});
