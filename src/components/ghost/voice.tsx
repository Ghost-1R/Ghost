"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  autoReadTarget,
  DEFAULT_VOICE,
  getVoicePreference,
  IDLE_VOICE,
  localVoices,
  speechText,
  subscribeVoicePreference,
  VOICE_RATES,
  VOICE_TEST_ID,
  voiceController,
  writeVoicePreference,
  type PlayResult,
  type VoiceLike,
} from "@/lib/experience/voice";

const noop = () => () => undefined;
const EMPTY_VOICES: VoiceLike[] = [];
let voiceCache: VoiceLike[] = EMPTY_VOICES;

function useSpeechSupported(): boolean {
  return useSyncExternalStore(noop, () => "speechSynthesis" in window, () => false);
}

function useVoicePreference() {
  return useSyncExternalStore(subscribeVoicePreference, getVoicePreference, () => DEFAULT_VOICE);
}

function useVoiceSnapshot() {
  const controller = voiceController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => IDLE_VOICE);
}

function subscribeVoices(listener: () => void): () => void {
  if (!("speechSynthesis" in window)) return () => undefined;
  const update = () => {
    voiceCache = localVoices(window.speechSynthesis.getVoices());
    listener();
  };
  update();
  window.speechSynthesis.addEventListener("voiceschanged", update);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
}

function useLocalVoices(): VoiceLike[] {
  return useSyncExternalStore(subscribeVoices, () => voiceCache, () => EMPTY_VOICES);
}

const NOTICES: Partial<Record<PlayResult, string>> = {
  no_local_voice: "No on-device voice is available in this browser.",
  empty: "This answer has nothing to read aloud.",
};

function Icon({ name }: { name: "play" | "pause" | "stop" }) {
  const paths = {
    play: "M4 2.5v11l9-5.5z",
    pause: "M4 2.5h3v11H4zm5 0h3v11H9z",
    stop: "M3.5 3.5h9v9h-9z",
  };
  return (
    <svg className="voice-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={paths[name]} fill="currentColor" />
    </svg>
  );
}

export function VoiceControls({ messageId, source }: { messageId: string; source: string }) {
  const supported = useSpeechSupported();
  const preference = useVoicePreference();
  const snapshot = useVoiceSnapshot();
  const [notice, setNotice] = useState<string | null>(null);

  if (!supported || !preference.enabled) {
    return null;
  }

  const controller = voiceController();
  const status = snapshot.messageId === messageId ? snapshot.status : "idle";
  const play = () => setNotice(NOTICES[controller.play(messageId, speechText(source), getVoicePreference())] ?? null);

  return (
    <div className="voice-controls" role="group" aria-label="Read this answer aloud" data-status={status}>
      {status === "idle" ? (
        <button className="voice-button" type="button" onClick={play} aria-label="Play answer">
          <Icon name="play" />
          <span>Listen</span>
        </button>
      ) : null}
      {status === "playing" ? (
        <>
          <span className="voice-wave" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <button className="voice-button" type="button" onClick={() => controller.pause()} aria-label="Pause reading">
            <Icon name="pause" />
            <span>Pause</span>
          </button>
        </>
      ) : null}
      {status === "paused" ? (
        <button className="voice-button" type="button" onClick={() => controller.resume()} aria-label="Resume reading">
          <Icon name="play" />
          <span>Resume</span>
        </button>
      ) : null}
      {status !== "idle" ? (
        <button className="voice-button" type="button" onClick={() => controller.stop(messageId)} aria-label="Stop reading">
          <Icon name="stop" />
          <span>Stop</span>
        </button>
      ) : null}
      {notice ? (
        <span className="voice-notice" role="status">
          {notice}
        </span>
      ) : null}
    </div>
  );
}

export function useVoiceReader(
  contextKey: string,
  messages: ReadonlyArray<{ id: string; role: string; content: string }>,
): void {
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant") ?? null;
  const seen = useRef<string | null>(latestAssistant?.id ?? null);

  useEffect(() => {
    return () => voiceController().stop();
  }, [contextKey]);

  useEffect(() => {
    const target = autoReadTarget(seen.current, messages, getVoicePreference());
    seen.current = latestAssistant?.id ?? null;
    if (target) {
      voiceController().play(target.id, speechText(target.content), getVoicePreference());
    }
  }, [latestAssistant?.id, messages]);
}

export function VoiceSettings() {
  const supported = useSpeechSupported();
  const preference = useVoicePreference();
  const voices = useLocalVoices();
  const [notice, setNotice] = useState<string | null>(null);

  if (!supported) {
    return <p className="quiet">This browser has no speech synthesis, so the reader stays hidden.</p>;
  }

  return (
    <div className="stack">
      <label className="field">
        <span>Voice reader</span>
        <select
          value={preference.enabled ? "on" : "off"}
          onChange={(event) => writeVoicePreference({ ...preference, enabled: event.target.value === "on" })}
        >
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label className="field">
        <span>Voice</span>
        <select
          value={preference.voiceURI ?? ""}
          disabled={!preference.enabled}
          onChange={(event) => writeVoicePreference({ ...preference, voiceURI: event.target.value || null })}
        >
          <option value="">Browser default</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Playback speed</span>
        <select
          value={String(preference.rate)}
          disabled={!preference.enabled}
          onChange={(event) => writeVoicePreference({ ...preference, rate: Number(event.target.value) })}
        >
          {VOICE_RATES.map((rate) => (
            <option key={rate} value={String(rate)}>
              {rate}×
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={preference.autoRead}
          disabled={!preference.enabled}
          onChange={(event) => writeVoicePreference({ ...preference, autoRead: event.target.checked })}
        />
        <span>Auto-read new responses</span>
      </label>
      <div className="actions">
        <button
          className="button-secondary"
          type="button"
          disabled={!preference.enabled}
          onClick={() =>
            setNotice(NOTICES[voiceController().play(VOICE_TEST_ID, "Ghost voice check. This is how answers will sound.", getVoicePreference())] ?? null)
          }
        >
          Test voice
        </button>
        <button className="button-secondary" type="button" onClick={() => voiceController().stop()}>
          Stop
        </button>
      </div>
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      <p className="quiet">
        Ghost reads only the visible answer, using on-device voices from this browser. Sources, project context,
        and Founder Rules are never spoken, and no text is sent to a speech service. Auto-read is off unless you turn it on.
      </p>
    </div>
  );
}
