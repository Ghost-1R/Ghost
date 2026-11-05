import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  composeDraft,
  createVoiceInput,
  onDeviceRecognition,
  recognitionFailure,
  recognitionLanguage,
  transcriptFrom,
  type RecognitionAvailability,
  type RecognitionCtorLike,
  type RecognitionLike,
} from "./voice-input";

type Result = ArrayLike<{ transcript: string }> & { isFinal: boolean };

function result(transcript: string, isFinal = true): Result {
  return Object.assign([{ transcript }], { isFinal });
}

function fakeEngine(availability: RecognitionAvailability, installs = true) {
  const created: FakeRecognition[] = [];
  const calls: string[] = [];
  class FakeRecognition implements RecognitionLike {
    lang = "";
    interimResults = false;
    continuous = true;
    maxAlternatives = 5;
    local = false;
    get processLocally() {
      return this.local;
    }
    set processLocally(value: boolean) {
      this.local = value;
    }
    onresult: RecognitionLike["onresult"] = null;
    onerror: RecognitionLike["onerror"] = null;
    onend: RecognitionLike["onend"] = null;
    started = false;
    constructor() {
      created.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.onerror?.({ error: "aborted" });
      this.onend?.();
    }
    say(...parts: string[]) {
      this.onresult?.({ results: parts.map((part) => result(part)) });
    }
    static async available() {
      calls.push("available");
      return availability;
    }
    static async install() {
      calls.push("install");
      return installs;
    }
  }
  return { ctor: FakeRecognition as unknown as RecognitionCtorLike, created, calls };
}

test("only on-device capable recognition is offered", () => {
  function Cloud() {}
  assert.equal(onDeviceRecognition({ webkitSpeechRecognition: Cloud }), null);

  const noLocalFlag = Object.assign(function Partial() {}, { available: async () => "available", install: async () => true });
  assert.equal(onDeviceRecognition({ SpeechRecognition: noLocalFlag }), null);

  const { ctor } = fakeEngine("available");
  assert.equal(onDeviceRecognition({ SpeechRecognition: ctor }), ctor);
  assert.equal(onDeviceRecognition({ webkitSpeechRecognition: ctor }), ctor);
  assert.equal(onDeviceRecognition({}), null);
});

test("without an on-device engine the input reports unsupported and does nothing", async () => {
  const input = createVoiceInput(null);
  assert.equal(input.getSnapshot().status, "unsupported");
  await input.start("en-US");
  assert.equal(input.getSnapshot().status, "unsupported");
});

test("dictation always runs locally, fills the draft, and waits for an explicit send", async () => {
  const { ctor, created } = fakeEngine("available");
  const input = createVoiceInput(ctor);
  const heard: string[] = [];
  input.onTranscript((text) => heard.push(text));

  await input.start("en-US");
  assert.equal(input.getSnapshot().status, "listening");
  const [recognition] = created;
  assert.equal(recognition.processLocally, true);
  assert.equal(recognition.lang, "en-US");
  assert.equal(recognition.interimResults, true);
  assert.equal(recognition.continuous, false);
  assert.equal(recognition.started, true);

  recognition.say("what should");
  recognition.say("what should", "happen next");
  recognition.onend?.();
  assert.deepEqual(heard, ["what should", "what should happen next"]);
  assert.deepEqual(input.getSnapshot(), { status: "result", message: "Transcript ready. Edit it, then send." });
});

test("a downloadable language pack is installed on device before listening", async () => {
  const { ctor, calls, created } = fakeEngine("downloadable");
  const input = createVoiceInput(ctor);
  const seen: string[] = [];
  input.subscribe(() => seen.push(input.getSnapshot().status));
  await input.start("en-US");
  assert.deepEqual(calls, ["available", "install"]);
  assert.deepEqual(seen, ["preparing", "listening"]);
  assert.equal(created.length, 1);
});

test("an unavailable or failed install never falls back to cloud recognition", async () => {
  const unavailable = fakeEngine("unavailable");
  const first = createVoiceInput(unavailable.ctor);
  await first.start("en-US");
  assert.equal(first.getSnapshot().status, "unavailable");
  assert.equal(unavailable.created.length, 0);

  const failed = fakeEngine("downloadable", false);
  const second = createVoiceInput(failed.ctor);
  await second.start("en-US");
  assert.equal(second.getSnapshot().status, "unavailable");
  assert.equal(failed.created.length, 0);
});

test("stale recognition events after a reset are ignored", async () => {
  const { ctor, created } = fakeEngine("available");
  const input = createVoiceInput(ctor);
  const heard: string[] = [];
  input.onTranscript((text) => heard.push(text));
  await input.start("en-US");
  const [first] = created;
  input.reset();
  first.say("late words");
  first.onend?.();
  assert.deepEqual(heard, []);
  assert.equal(input.getSnapshot().status, "idle");
});

test("recognition errors map to calm states and nothing is sent", async () => {
  assert.deepEqual(recognitionFailure("no-speech"), { status: "idle", message: "No speech was heard." });
  assert.equal(recognitionFailure("aborted").status, "idle");
  assert.equal(recognitionFailure("not-allowed").status, "error");
  assert.equal(recognitionFailure("audio-capture").status, "error");
  assert.equal(recognitionFailure("language-not-supported").status, "unavailable");
  assert.equal(recognitionFailure("network").message, "Voice input stopped. Nothing was sent.");

  const { ctor, created } = fakeEngine("available");
  const input = createVoiceInput(ctor);
  await input.start("en-US");
  created[0].onerror?.({ error: "not-allowed" });
  created[0].onend?.();
  assert.equal(input.getSnapshot().status, "error");
});

test("transcripts are composed onto the typed draft and bounded", () => {
  assert.equal(composeDraft("", "  hello there "), "hello there");
  assert.equal(composeDraft("Summarise  ", "the project"), "Summarise the project");
  assert.equal(composeDraft("keep me", "   "), "keep me");
  assert.equal(composeDraft("", "x".repeat(5000)).length, 4000);
  assert.equal(transcriptFrom([result(" one "), result("two\n three")]), "one two three");
  assert.equal(recognitionLanguage("en"), "en-US");
  assert.equal(recognitionLanguage("fr-FR"), "fr-FR");
  assert.equal(recognitionLanguage("<script>"), "en-US");
  assert.equal(recognitionLanguage(undefined), "en-US");
});

test("voice input has no network path and never submits the form", () => {
  const library = readFileSync(new URL("./voice-input.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../../components/ghost/voice-input.tsx", import.meta.url), "utf8");
  for (const source of [library, component]) {
    assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(source));
    assert.ok(!/requestSubmit|\.submit\(/.test(source));
  }
  assert.match(library, /processLocally = true/);
  assert.match(component, /type="button"/);
});
