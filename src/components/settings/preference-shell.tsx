"use client";

import { useEffect } from "react";
import { writeSoundPreference } from "@/lib/experience/sound";
import type { FounderPreferences } from "@/lib/preferences/types";

function resolveAppearance(preference: FounderPreferences["appearance"]): "dark" | "light" {
  if (preference === "LIGHT") return "light";
  if (preference === "DARK") return "dark";
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

/** Applies account appearance / motion cookies to the document and hydrates sound localStorage. */
export function PreferenceShell({ preferences }: { preferences: FounderPreferences }) {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = resolveAppearance(preferences.appearance);
      root.dataset.reduceMotion = preferences.reduceMotion ? "1" : "0";
    };
    apply();
    writeSoundPreference({
      enabled: preferences.soundEnabled,
      volume: preferences.soundVolume,
    });

    if (preferences.appearance !== "SYSTEM") {
      return undefined;
    }
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preferences]);

  return null;
}
