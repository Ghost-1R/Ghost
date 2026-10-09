export const RESPONSE_STYLES = ["DIRECT", "WARM", "FORMAL"] as const;
export type ResponseStyle = (typeof RESPONSE_STYLES)[number];

export const RESPONSE_DETAILS = ["BRIEF", "BALANCED", "DETAILED"] as const;
export type ResponseDetail = (typeof RESPONSE_DETAILS)[number];

export const APPEARANCES = ["DARK", "LIGHT", "SYSTEM"] as const;
export type AppearancePreference = (typeof APPEARANCES)[number];

export type FounderPreferences = {
  responseStyle: ResponseStyle;
  responseDetail: ResponseDetail;
  soundEnabled: boolean;
  soundVolume: number;
  reduceMotion: boolean;
  appearance: AppearancePreference;
};

export const DEFAULT_FOUNDER_PREFERENCES: FounderPreferences = {
  responseStyle: "DIRECT",
  responseDetail: "BALANCED",
  soundEnabled: true,
  soundVolume: 0.35,
  reduceMotion: false,
  appearance: "DARK",
};

export type FounderPreferencesRow = {
  owner_id: string;
  response_style: ResponseStyle;
  response_detail: ResponseDetail;
  sound_enabled: boolean;
  sound_volume: number | string;
  reduce_motion: boolean;
  appearance: AppearancePreference;
  updated_at?: string;
};
