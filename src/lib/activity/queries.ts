import type { GhostClient } from "@/lib/auth/session";
import { isMissingRelation, loose } from "@/lib/db/loose";
import { fromError, type QueryResult } from "@/lib/result";
import {
  mergeTimeline,
  presenceToTimelineEntry,
  type PresenceEvent,
  type PresenceEventType,
  type TimelineEntry,
} from "@/lib/activity/format";

export {
  formatPresenceEvent,
  formatRelativeTime,
  mergeTimeline,
  presenceLabel,
  presenceSummaryLines,
  summarizePresence,
  type PresenceEvent,
  type PresenceEventType,
  type PresenceSummary,
  type TimelineEntry,
} from "@/lib/activity/format";

const ACTIVITY_COLUMNS =
  "id, company_id, project_id, actor_kind, actor_user_id, actor_label, action, summary, record_type, record_id, external_unconnected, created_at";

type ActivityRow = {
  id: string;
  project_id: string | null;
  actor_kind: "PERSON" | "AI" | "SYSTEM";
  actor_label: string;
  action: string;
  summary: string;
  record_type: string | null;
  record_id: string | null;
  external_unconnected: boolean;
  created_at: string;
};

function mapActivity(row: ActivityRow): TimelineEntry {
  return {
    id: `activity:${row.id}`,
    source: "activity",
    at: row.created_at,
    actorKind: row.actor_kind,
    actorLabel: row.actor_label,
    action: row.action,
    summary: row.summary,
    recordType: row.record_type,
    recordId: row.record_id,
    externalUnconnected: row.external_unconnected,
    projectId: row.project_id,
  };
}

/** Recorded activity for one project, newest first. RLS limits what the caller can see. */
export async function loadProjectTimeline(
  supabase: GhostClient,
  projectId: string,
  options?: { limit?: number },
): Promise<QueryResult<TimelineEntry[]>> {
  const { data, error } = await loose(supabase)
    .from("project_activity_events")
    .select(ACTIVITY_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 60);

  if (error) {
    if (isMissingRelation(error.message)) return { status: "ok", data: [] };
    return fromError(error);
  }
  return { status: "ok", data: ((data ?? []) as ActivityRow[]).map(mapActivity) };
}

/**
 * Company-wide timeline: recorded activity plus presence (sign-in / sign-out / last active)
 * rows the caller may read — the founder sees everyone's, others only their own.
 */
export async function loadCompanyTimeline(
  supabase: GhostClient,
  companyId: string,
  options?: { limit?: number; includePresence?: boolean },
): Promise<QueryResult<TimelineEntry[]>> {
  const limit = options?.limit ?? 80;
  const client = loose(supabase);

  const activity = await client
    .from("project_activity_events")
    .select(ACTIVITY_COLUMNS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (activity.error) {
    if (isMissingRelation(activity.error.message)) return { status: "ok", data: [] };
    return fromError(activity.error);
  }
  const activityEntries = ((activity.data ?? []) as ActivityRow[]).map(mapActivity);

  let presenceEntries: TimelineEntry[] = [];
  if (options?.includePresence !== false) {
    const presence = await client
      .from("user_presence_events")
      .select("id, user_id, company_id, event_type, observed_at")
      .eq("company_id", companyId)
      .order("observed_at", { ascending: false })
      .limit(limit);
    if (!presence.error) {
      presenceEntries = (
        (presence.data ?? []) as Array<{
          id: string;
          user_id: string;
          company_id: string | null;
          event_type: PresenceEventType;
          observed_at: string;
        }>
      ).map((row) =>
        presenceToTimelineEntry({
          id: row.id,
          userId: row.user_id,
          companyId: row.company_id,
          eventType: row.event_type,
          observedAt: row.observed_at,
        } satisfies PresenceEvent),
      );
    }
  }

  return { status: "ok", data: mergeTimeline(activityEntries, presenceEntries).slice(0, limit) };
}

/** Recent presence events for one user (own rows, or any user's for a company owner). */
export async function loadUserPresence(
  supabase: GhostClient,
  userId: string,
  options?: { limit?: number },
): Promise<QueryResult<PresenceEvent[]>> {
  const { data, error } = await loose(supabase)
    .from("user_presence_events")
    .select("id, user_id, company_id, event_type, observed_at")
    .eq("user_id", userId)
    .order("observed_at", { ascending: false })
    .limit(options?.limit ?? 30);
  if (error) {
    if (isMissingRelation(error.message)) return { status: "ok", data: [] };
    return fromError(error);
  }
  return {
    status: "ok",
    data: (
      (data ?? []) as Array<{
        id: string;
        user_id: string;
        company_id: string | null;
        event_type: PresenceEventType;
        observed_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      userId: row.user_id,
      companyId: row.company_id,
      eventType: row.event_type,
      observedAt: row.observed_at,
    })),
  };
}
