import { parseMarkdown, type Inline } from "@/lib/conversation/markdown";
import { splitAnswer } from "@/lib/conversation/queries";
import { redactSecrets } from "@/lib/security/redact";

export type VoicePreference = {
  enabled: boolean;
  voiceURI: string | null;
  rate: number;
  autoRead: boolean;
};

export const VOICE_STORAGE_KEY = "ghost.voice";
export const DEFAULT_VOICE: VoicePreference = { enabled: true, voiceURI: null, rate: 1, autoRead: false };
export const VOICE_RATES = [0.75, 1, 1.25, 1.5, 1.75] as const;
export const VOICE_TEST_ID = "ghost.voice-test";

export function clampRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_VOICE.rate;
  }
  return Math.round(Math.min(2, Math.max(0.5, value)) * 100) / 100;
}

export function readVoicePreference(raw: string | null): VoicePreference {
  if (!raw) {
    return DEFAULT_VOICE;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof VoicePreference, unknown>>;
    return {
      enabled: parsed.enabled !== false,
      voiceURI: typeof parsed.voiceURI === "string" && parsed.voiceURI.length > 0 && parsed.voiceURI.length <= 200 ? parsed.voiceURI : null,
      rate: clampRate(parsed.rate),
      autoRead: parsed.autoRead === true,
    };
  } catch {
    return DEFAULT_VOICE;
  }
}

const CITATION = /【[^】]*】/g;
const MAX_SPEECH_CHARS = 8000;
const MAX_CHUNK_CHARS = 220;

function inlineText(nodes: Inline[]): string {
  return nodes.map((node) => (node.type === "text" || node.type === "code" ? node.value : inlineText(node.children))).join("");
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return trimmed && !/[.!?:;]$/.test(trimmed) ? `${trimmed}.` : trimmed;
}

// Speaks only the visible answer: the sources footer, citation markers, and code are dropped.
export function speechText(content: string): string {
  const parts: string[] = [];
  for (const block of parseMarkdown(splitAnswer(content).answer)) {
    if (block.type === "paragraph") {
      parts.push(sentence(block.lines.map(inlineText).join(" ")));
    } else if (block.type === "heading") {
      parts.push(sentence(inlineText(block.children)));
    } else if (block.type === "list") {
      parts.push(block.items.map((item, index) => sentence(block.ordered ? `${block.start + index}. ${inlineText(item)}` : inlineText(item))).join(" "));
    } else {
      parts.push("Code block omitted.");
    }
  }
  const text = parts
    .join("\n")
    .replace(CITATION, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
  return redactSecrets(text).slice(0, MAX_SPEECH_CHARS);
}

export function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const piece of text.split(/(?<=[.!?])\s+|\n+/)) {
    const words = piece.trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      if (current && current.length + word.length + 1 > MAX_CHUNK_CHARS) push();
      current = current ? `${current} ${word}` : word.slice(0, MAX_CHUNK_CHARS);
    }
    if (current.length > MAX_CHUNK_CHARS * 0.6) push();
  }
  push();
  return chunks;
}

export type VoiceLike = { voiceURI: string; name: string; lang: string; localService: boolean; default: boolean };

// Only on-device voices are used, so answers are never sent to a network speech service.
export function localVoices<T extends VoiceLike>(voices: readonly T[]): T[] {
  return voices.filter((voice) => voice.localService);
}

export function pickVoice<T extends VoiceLike>(voices: readonly T[], voiceURI: string | null): T | null {
  const local = localVoices(voices);
  return (
    local.find((voice) => voice.voiceURI === voiceURI) ??
    local.find((voice) => voice.default) ??
    local.find((voice) => voice.lang.toLowerCase().startsWith("en")) ??
    local[0] ??
    null
  );
}

export type VoiceStatus = "idle" | "playing" | "paused";
export type VoiceSnapshot = { status: VoiceStatus; messageId: string | null };
export const IDLE_VOICE: VoiceSnapshot = { status: "idle", messageId: null };

export type PlayResult = "started" | "duplicate" | "resumed" | "disabled" | "unavailable" | "empty" | "no_local_voice";

type UtteranceLike = {
  text: string;
  rate: number;
  lang: string;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

export type SynthLike = {
  speak: (utterance: UtteranceLike) => void;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  getVoices: () => VoiceLike[];
};

export type VoiceController = ReturnType<typeof createVoiceController>;

export function createVoiceController(synth: SynthLike | null, makeUtterance: (text: string) => UtteranceLike) {
  let snapshot = IDLE_VOICE;
  let generation = 0;
  const listeners = new Set<() => void>();
  const set = (next: VoiceSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const halt = () => {
    generation += 1;
    synth?.cancel();
    if (snapshot.status !== "idle") set(IDLE_VOICE);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    play(messageId: string, text: string, preference: VoicePreference): PlayResult {
      if (!synth) return "unavailable";
      if (!preference.enabled) return "disabled";
      if (snapshot.messageId === messageId && snapshot.status === "playing") return "duplicate";
      if (snapshot.messageId === messageId && snapshot.status === "paused") {
        synth.resume();
        set({ status: "playing", messageId });
        return "resumed";
      }
      const chunks = speechChunks(text);
      if (chunks.length === 0) return "empty";
      const voice = pickVoice(synth.getVoices(), preference.voiceURI);
      if (!voice) return "no_local_voice";
      halt();
      const run = generation;
      chunks.forEach((chunk, index) => {
        const utterance = makeUtterance(chunk);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        utterance.rate = clampRate(preference.rate);
        utterance.onend = () => {
          if (run === generation && index === chunks.length - 1) set(IDLE_VOICE);
        };
        utterance.onerror = () => {
          if (run === generation) halt();
        };
        synth.speak(utterance);
      });
      set({ status: "playing", messageId });
      return "started";
    },
    pause() {
      if (!synth || snapshot.status !== "playing") return;
      synth.pause();
      set({ ...snapshot, status: "paused" });
    },
    resume() {
      if (!synth || snapshot.status !== "paused") return;
      synth.resume();
      set({ ...snapshot, status: "playing" });
    },
    stop(messageId?: string) {
      if (messageId && snapshot.messageId !== messageId) return;
      halt();
    },
  };
}

export function autoReadTarget<T extends { id: string; role: string; content: string }>(
  seenId: string | null,
  messages: readonly T[],
  preference: VoicePreference,
): T | null {
  if (!preference.enabled || !preference.autoRead) return null;
  const latest = [...messages].reverse().find((message) => message.role === "assistant");
  return latest && latest.id !== seenId ? latest : null;
}

let controller: VoiceController | null = null;

export function voiceController(): VoiceController {
  if (!controller) {
    const synth = typeof window !== "undefined" && "speechSynthesis" in window ? (window.speechSynthesis as unknown as SynthLike) : null;
    controller = createVoiceController(synth, (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike);
  }
  return controller;
}

let preference = DEFAULT_VOICE;
let hydrated = false;
const preferenceListeners = new Set<() => void>();

export function subscribeVoicePreference(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
}

export function getVoicePreference(): VoicePreference {
  if (!hydrated && typeof window !== "undefined") {
    hydrated = true;
    preference = readVoicePreference(window.localStorage.getItem(VOICE_STORAGE_KEY));
  }
  return preference;
}

export function writeVoicePreference(next: VoicePreference): void {
  preference = readVoicePreference(JSON.stringify(next));
  if (typeof window !== "undefined") {
    window.localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(preference));
  }
  if (!preference.enabled) voiceController().stop();
  for (const listener of preferenceListeners) listener();
}
