"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { APPEARANCE_COOKIE, REDUCE_MOTION_COOKIE } from "./cookies";
import { parsePreferencesForm, upsertFounderPreferences } from "./store";
import type { FounderPreferences } from "./types";

export async function writePreferenceCookies(preferences: FounderPreferences): Promise<void> {
  const jar = await cookies();
  jar.set(APPEARANCE_COOKIE, preferences.appearance, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });
  jar.set(REDUCE_MOTION_COOKIE, preferences.reduceMotion ? "1" : "0", {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function saveFounderPreferences(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "Sign in to save preferences.", notice: null };
  }

  const parsed = parsePreferencesForm(formData);
  if ("error" in parsed) {
    return { error: parsed.error, notice: null };
  }

  const saved = await upsertFounderPreferences(session.supabase, session.user.id, parsed);
  if (saved.status === "error") {
    return {
      error:
        /founder_preferences|schema cache|does not exist/i.test(saved.message)
          ? "Preferences storage is not available yet. Apply the local founder_preferences migration first."
          : saved.message,
      notice: null,
    };
  }

  await writePreferenceCookies(saved.data);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { error: null, notice: "Preferences saved for this account." };
}
