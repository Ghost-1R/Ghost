"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CoreState } from "@/lib/experience/core-state";
import {
  DEFAULT_SOUND,
  getSoundPreference,
  playSound,
  SOUND_EVENTS,
  subscribeSoundPreference,
  unlockSound,
  writeSoundPreference,
  type GhostSoundEvent,
  type SoundPreference,
} from "@/lib/experience/sound";

type ExperienceValue = {
  state: CoreState;
  setActivity: (state: CoreState | null) => void;
  setPageState: (state: CoreState | null) => void;
  play: (event: GhostSoundEvent) => void;
  preference: SoundPreference;
  setPreference: (preference: SoundPreference) => void;
};

const ExperienceContext = createContext<ExperienceValue | null>(null);

export function ExperienceProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<CoreState | null>(null);
  const [pageState, setPageState] = useState<CoreState | null>(null);
  const preference = useSyncExternalStore(subscribeSoundPreference, getSoundPreference, () => DEFAULT_SOUND);

  useEffect(() => {
    const unlock = () => {
      unlockSound();
      if (window.sessionStorage.getItem("ghost.ready.played") === "yes") {
        return;
      }
      window.sessionStorage.setItem("ghost.ready.played", "yes");
      playSound("ghost.ready", getSoundPreference());
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const setPreference = (next: SoundPreference) => {
    writeSoundPreference(next);
  };

  const value = useMemo<ExperienceValue>(
    () => ({
      state: activity ?? pageState ?? "IDLE",
      setActivity,
      setPageState,
      play: (event) => {
        playSound(event, preference);
      },
      preference,
      setPreference,
    }),
    [activity, pageState, preference],
  );

  return <ExperienceContext.Provider value={value}>{children}</ExperienceContext.Provider>;
}

export function useExperience(): ExperienceValue {
  return (
    useContext(ExperienceContext) ?? {
      state: "IDLE",
      setActivity: () => undefined,
      setPageState: () => undefined,
      play: () => undefined,
      preference: DEFAULT_SOUND,
      setPreference: () => undefined,
    }
  );
}

export function CoreSignal({ state }: { state: CoreState }) {
  const { setPageState } = useExperience();
  useEffect(() => {
    setPageState(state);
    return () => setPageState(null);
  }, [setPageState, state]);
  return null;
}

export function GhostCore({ state, size = "mark" }: { state?: CoreState; size?: "mark" | "stage" }) {
  const experience = useExperience();
  const resolved = state ?? experience.state;
  return (
    <span className={`ghost-core ghost-core-${size}`} data-state={resolved} role="img" aria-label={`Ghost core ${resolved.toLowerCase()}`}>
      <span className="ghost-core-ring ghost-core-ring-a" />
      <span className="ghost-core-ring ghost-core-ring-b" />
      <span className="ghost-core-ring ghost-core-ring-c" />
      <span className="ghost-core-node" />
    </span>
  );
}

export function SoundSettings() {
  const { preference, setPreference, play } = useExperience();
  const [preview, setPreview] = useState<GhostSoundEvent>("ghost.notification");
  return (
    <div className="stack">
      <label className="field">
        <span>Sound effects</span>
        <select
          value={preference.enabled ? "on" : "off"}
          onChange={(event) => setPreference({ ...preference, enabled: event.target.value === "on" })}
        >
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label className="field">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(preference.volume * 100)}
          onChange={(event) => setPreference({ ...preference, volume: Number(event.target.value) / 100 })}
        />
      </label>
      <label className="field">
        <span>Sound to test</span>
        <select value={preview} onChange={(event) => setPreview(event.target.value as GhostSoundEvent)}>
          {SOUND_EVENTS.map((event) => (
            <option key={event} value={event}>
              {event.replace("ghost.", "").replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button-secondary"
        type="button"
        onClick={() => {
          unlockSound();
          play(preview);
        }}
      >
        Test sound
      </button>
      <p className="quiet">Sound starts after you interact with the page. Warnings stay on screen when sound is off.</p>
    </div>
  );
}
