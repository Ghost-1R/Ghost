export const SOUND_EVENTS = [
  "ghost.ready",
  "ghost.notification",
  "ghost.success",
  "ghost.warning",
  "ghost.blocked",
  "ghost.approval_required",
  "ghost.inspection_complete",
  "ghost.presentation_ready",
] as const;

export type GhostSoundEvent = (typeof SOUND_EVENTS)[number];

export type SoundPreference = {
  enabled: boolean;
  volume: number;
};

export const SOUND_STORAGE_KEY = "ghost.sound";
export const DEFAULT_SOUND: SoundPreference = { enabled: true, volume: 0.35 };

type Tone = { frequency: number; duration: number; delay: number; gain: number };

const TONES: Record<GhostSoundEvent, Tone[]> = {
  "ghost.ready": [
    { frequency: 392, duration: 0.09, delay: 0, gain: 0.05 },
    { frequency: 523.25, duration: 0.14, delay: 0.08, gain: 0.045 },
  ],
  "ghost.notification": [{ frequency: 659.25, duration: 0.07, delay: 0, gain: 0.04 }],
  "ghost.success": [
    { frequency: 440, duration: 0.08, delay: 0, gain: 0.045 },
    { frequency: 554.37, duration: 0.12, delay: 0.07, gain: 0.04 },
  ],
  "ghost.warning": [{ frequency: 311.13, duration: 0.16, delay: 0, gain: 0.05 }],
  "ghost.blocked": [
    { frequency: 196, duration: 0.12, delay: 0, gain: 0.05 },
    { frequency: 164.81, duration: 0.16, delay: 0.1, gain: 0.045 },
  ],
  "ghost.approval_required": [
    { frequency: 349.23, duration: 0.08, delay: 0, gain: 0.045 },
    { frequency: 415.3, duration: 0.1, delay: 0.12, gain: 0.04 },
  ],
  "ghost.inspection_complete": [
    { frequency: 523.25, duration: 0.06, delay: 0, gain: 0.04 },
    { frequency: 659.25, duration: 0.06, delay: 0.07, gain: 0.04 },
    { frequency: 783.99, duration: 0.12, delay: 0.14, gain: 0.035 },
  ],
  "ghost.presentation_ready": [
    { frequency: 392, duration: 0.1, delay: 0, gain: 0.04 },
    { frequency: 493.88, duration: 0.1, delay: 0.1, gain: 0.04 },
    { frequency: 587.33, duration: 0.16, delay: 0.2, gain: 0.035 },
  ],
};

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SOUND.volume;
  }
  return Math.min(1, Math.max(0, value));
}

export function readSoundPreference(raw: string | null): SoundPreference {
  if (!raw) {
    return DEFAULT_SOUND;
  }
  try {
    const parsed = JSON.parse(raw) as { enabled?: unknown; volume?: unknown };
    return {
      enabled: parsed.enabled !== false,
      volume: clampVolume(typeof parsed.volume === "number" ? parsed.volume : DEFAULT_SOUND.volume),
    };
  } catch {
    return DEFAULT_SOUND;
  }
}

export function shouldEmitSound(
  previous: { event: GhostSoundEvent; at: number } | null,
  event: GhostSoundEvent,
  at: number,
): boolean {
  return !(previous && previous.event === event && at - previous.at < 700);
}

let preference = DEFAULT_SOUND;
let hydrated = false;
const preferenceListeners = new Set<() => void>();

function emitPreference(): void {
  for (const listener of preferenceListeners) {
    listener();
  }
}

export function subscribeSoundPreference(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => preferenceListeners.delete(listener);
}

export function getSoundPreference(): SoundPreference {
  if (!hydrated && typeof window !== "undefined") {
    hydrated = true;
    preference = readSoundPreference(window.localStorage.getItem(SOUND_STORAGE_KEY));
  }
  return preference;
}

export function writeSoundPreference(next: SoundPreference): void {
  preference = { enabled: next.enabled, volume: clampVolume(next.volume) };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(preference));
  }
  emitPreference();
}

const MAX_QUEUE_SECONDS = 0.6;
const SOUND_GAP_SECONDS = 0.04;

export function soundLength(event: GhostSoundEvent): number {
  return Math.max(...TONES[event].map((tone) => tone.delay + tone.duration));
}

export function nextSoundStart(now: number, busyUntil: number): number | null {
  const start = Math.max(now, busyUntil);
  return start - now > MAX_QUEUE_SECONDS ? null : start;
}

let context: AudioContext | null = null;
let unlocked = false;
let last: { event: GhostSoundEvent; at: number } | null = null;
let busyUntil = 0;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    return null;
  }
  context ??= new window.AudioContext();
  return context;
}

export function unlockSound(): void {
  const ctx = audioContext();
  if (!ctx) {
    return;
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  unlocked = true;
}

export function playSound(event: GhostSoundEvent, preference: SoundPreference, at = Date.now()): boolean {
  if (!preference.enabled || preference.volume <= 0 || !unlocked) {
    return false;
  }
  if (!shouldEmitSound(last, event, at)) {
    return false;
  }
  const ctx = audioContext();
  if (!ctx) {
    return false;
  }
  const offset = nextSoundStart(ctx.currentTime, busyUntil);
  if (offset === null) {
    return false;
  }
  last = { event, at };
  busyUntil = offset + soundLength(event) + SOUND_GAP_SECONDS;
  for (const tone of TONES[event]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = tone.frequency;
    const start = offset + tone.delay;
    const peak = Math.max(0.0001, tone.gain * preference.volume);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + tone.duration + 0.02);
  }
  return true;
}
