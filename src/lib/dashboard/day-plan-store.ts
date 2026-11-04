import type { GhostClient } from "@/lib/auth/session";
import {
  DAY_PLAN_BUCKETS,
  type DayPlanBucket,
  type DayPlanPlacement,
  type SavedDayPlan,
} from "@/lib/dashboard/day-plan";
import { fromError, type QueryResult } from "@/lib/result";

function isBucket(value: unknown): value is DayPlanBucket {
  return typeof value === "string" && (DAY_PLAN_BUCKETS as readonly string[]).includes(value);
}

export function parseDayPlanPlacements(raw: unknown): DayPlanPlacement[] {
  if (!Array.isArray(raw)) return [];
  const out: DayPlanPlacement[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = "id" in entry && typeof entry.id === "string" ? entry.id.trim() : "";
    const bucket = "bucket" in entry ? entry.bucket : null;
    if (!id || !isBucket(bucket)) continue;
    out.push({ id, bucket });
  }
  return out;
}

export function founderPlanDate(timeZone: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export async function loadSavedDayPlan(
  supabase: GhostClient,
  ownerId: string,
  planDate: string,
): Promise<QueryResult<SavedDayPlan | null>> {
  const result = await supabase
    .from("founder_day_plans")
    .select("plan_date, items, saved_at")
    .eq("owner_id", ownerId)
    .eq("plan_date", planDate)
    .maybeSingle();

  if (result.error) {
    if (/founder_day_plans|schema cache|does not exist/i.test(result.error.message)) {
      return { status: "ok", data: null };
    }
    return fromError(result.error);
  }
  if (!result.data) return { status: "ok", data: null };

  const row = result.data as { plan_date: string; items: unknown; saved_at: string };
  return {
    status: "ok",
    data: {
      planDate: row.plan_date,
      placements: parseDayPlanPlacements(row.items),
      savedAt: row.saved_at,
    },
  };
}

export async function saveDayPlanPlacements(
  supabase: GhostClient,
  ownerId: string,
  planDate: string,
  placements: readonly DayPlanPlacement[],
): Promise<QueryResult<SavedDayPlan>> {
  const payload = {
    owner_id: ownerId,
    plan_date: planDate,
    items: placements.map((item) => ({ id: item.id, bucket: item.bucket })),
    saved_at: new Date().toISOString(),
  };

  const result = await supabase
    .from("founder_day_plans")
    .upsert(payload, { onConflict: "owner_id,plan_date" })
    .select("plan_date, items, saved_at")
    .single();

  if (result.error || !result.data) {
    return {
      status: "error",
      message: result.error?.message ?? "Day plan was not saved.",
    };
  }

  const row = result.data as { plan_date: string; items: unknown; saved_at: string };
  return {
    status: "ok",
    data: {
      planDate: row.plan_date,
      placements: parseDayPlanPlacements(row.items),
      savedAt: row.saved_at,
    },
  };
}
