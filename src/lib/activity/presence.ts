import type { GhostClient } from "@/lib/auth/session";
import { isMissingRelation, loose } from "@/lib/db/loose";
import type { PresenceEventType } from "@/lib/activity/format";

/** Minimum gap between LAST_ACTIVE rows for the same user, so page views don't flood the table. */
export const LAST_ACTIVE_MIN_INTERVAL_MS = 5 * 60 * 1000;

export type PresenceWrite =
  | { recorded: true }
  | { recorded: false; reason: string };

async function insertPresence(
  supabase: GhostClient,
  userId: string,
  eventType: PresenceEventType,
  options?: { companyId?: string | null; metadata?: Record<string, unknown> },
): Promise<PresenceWrite> {
  try {
    const { error } = await loose(supabase)
      .from("user_presence_events")
      .insert({
        user_id: userId,
        company_id: options?.companyId ?? null,
        event_type: eventType,
        metadata: options?.metadata ?? {},
      });
    if (error) {
      return {
        recorded: false,
        reason: isMissingRelation(error.message) ? "presence table not available" : error.message,
      };
    }
    return { recorded: true };
  } catch (error) {
    return { recorded: false, reason: error instanceof Error ? error.message : "presence write failed" };
  }
}

/** Call after a successful sign-in. Best-effort; never blocks authentication. */
export function recordSignIn(
  supabase: GhostClient,
  userId: string,
  options?: { companyId?: string | null },
): Promise<PresenceWrite> {
  return insertPresence(supabase, userId, "SIGN_IN", options);
}

/** Call immediately before sign-out, while the session is still valid. */
export function recordSignOut(
  supabase: GhostClient,
  userId: string,
  options?: { companyId?: string | null },
): Promise<PresenceWrite> {
  return insertPresence(supabase, userId, "SIGN_OUT", options);
}

/** Throttled LAST_ACTIVE heartbeat. */
export async function touchLastActive(
  supabase: GhostClient,
  userId: string,
  options?: { companyId?: string | null; now?: Date },
): Promise<PresenceWrite> {
  const now = options?.now ?? new Date();
  const latest = await loose(supabase)
    .from("user_presence_events")
    .select("observed_at")
    .eq("user_id", userId)
    .eq("event_type", "LAST_ACTIVE")
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest.error && latest.data?.observed_at) {
    const age = now.getTime() - new Date(latest.data.observed_at as string).getTime();
    if (age >= 0 && age < LAST_ACTIVE_MIN_INTERVAL_MS) {
      return { recorded: false, reason: "throttled" };
    }
  }
  return insertPresence(supabase, userId, "LAST_ACTIVE", options);
}
