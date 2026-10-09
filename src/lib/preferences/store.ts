import type { SupabaseClient } from "@supabase/supabase-js";
import { clampVolume } from "@/lib/experience/sound";
import {
  APPEARANCES,
  DEFAULT_FOUNDER_PREFERENCES,
  RESPONSE_DETAILS,
  RESPONSE_STYLES,
  type AppearancePreference,
  type FounderPreferences,
  type FounderPreferencesRow,
  type ResponseDetail,
  type ResponseStyle,
} from "./types";

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function normalizePreferences(input: Partial<FounderPreferences> | null | undefined): FounderPreferences {
  const base = DEFAULT_FOUNDER_PREFERENCES;
  return {
    responseStyle: isOneOf(input?.responseStyle, RESPONSE_STYLES) ? input.responseStyle : base.responseStyle,
    responseDetail: isOneOf(input?.responseDetail, RESPONSE_DETAILS)
      ? input.responseDetail
      : base.responseDetail,
    soundEnabled: input?.soundEnabled !== false,
    soundVolume: clampVolume(typeof input?.soundVolume === "number" ? input.soundVolume : base.soundVolume),
    reduceMotion: input?.reduceMotion === true,
    appearance: isOneOf(input?.appearance, APPEARANCES) ? input.appearance : base.appearance,
  };
}

export function preferencesFromRow(row: FounderPreferencesRow | null | undefined): FounderPreferences {
  if (!row) {
    return { ...DEFAULT_FOUNDER_PREFERENCES };
  }
  const volume = typeof row.sound_volume === "string" ? Number(row.sound_volume) : row.sound_volume;
  return normalizePreferences({
    responseStyle: row.response_style,
    responseDetail: row.response_detail,
    soundEnabled: row.sound_enabled,
    soundVolume: volume,
    reduceMotion: row.reduce_motion,
    appearance: row.appearance,
  });
}

export function parsePreferencesForm(formData: FormData): FounderPreferences | { error: string } {
  const style = formData.get("responseStyle");
  const detail = formData.get("responseDetail");
  const appearance = formData.get("appearance");
  const volumeRaw = formData.get("soundVolume");
  const volume = typeof volumeRaw === "string" ? Number(volumeRaw) : Number.NaN;

  if (!isOneOf(style, RESPONSE_STYLES)) {
    return { error: "Choose a valid response style." };
  }
  if (!isOneOf(detail, RESPONSE_DETAILS)) {
    return { error: "Choose a valid detail level." };
  }
  if (!isOneOf(appearance, APPEARANCES)) {
    return { error: "Choose a valid appearance preference." };
  }
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    return { error: "Sound volume must be between 0 and 1." };
  }

  return normalizePreferences({
    responseStyle: style as ResponseStyle,
    responseDetail: detail as ResponseDetail,
    soundEnabled: formData.get("soundEnabled") === "on" || formData.get("soundEnabled") === "true",
    soundVolume: volume,
    reduceMotion: formData.get("reduceMotion") === "on" || formData.get("reduceMotion") === "true",
    appearance: appearance as AppearancePreference,
  });
}

export async function loadFounderPreferences(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<{ status: "ok"; data: FounderPreferences } | { status: "error"; message: string }> {
  const result = await supabase
    .from("founder_preferences")
    .select(
      "owner_id, response_style, response_detail, sound_enabled, sound_volume, reduce_motion, appearance, updated_at",
    )
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (result.error) {
    // Table missing locally until migration is applied — fail soft with defaults.
    if (/founder_preferences|schema cache|does not exist/i.test(result.error.message)) {
      return { status: "ok", data: { ...DEFAULT_FOUNDER_PREFERENCES } };
    }
    return { status: "error", message: result.error.message };
  }

  return { status: "ok", data: preferencesFromRow(result.data as FounderPreferencesRow | null) };
}

export async function upsertFounderPreferences(
  supabase: SupabaseClient,
  ownerId: string,
  preferences: FounderPreferences,
): Promise<{ status: "ok"; data: FounderPreferences } | { status: "error"; message: string }> {
  const normalized = normalizePreferences(preferences);
  const result = await supabase
    .from("founder_preferences")
    .upsert(
      {
        owner_id: ownerId,
        response_style: normalized.responseStyle,
        response_detail: normalized.responseDetail,
        sound_enabled: normalized.soundEnabled,
        sound_volume: normalized.soundVolume,
        reduce_motion: normalized.reduceMotion,
        appearance: normalized.appearance,
      },
      { onConflict: "owner_id" },
    )
    .select(
      "owner_id, response_style, response_detail, sound_enabled, sound_volume, reduce_motion, appearance, updated_at",
    )
    .single();

  if (result.error || !result.data) {
    return {
      status: "error",
      message: result.error?.message ?? "Preferences were not saved.",
    };
  }

  return { status: "ok", data: preferencesFromRow(result.data as FounderPreferencesRow) };
}
