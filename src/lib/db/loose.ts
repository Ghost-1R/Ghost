import type { SupabaseClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";

/**
 * Untyped client for tables added by 20261104210000_companies_team_assignments_sales.sql
 * (work_assignments, project_activity_events, company_orders, ...). The generated
 * `database.types.ts` has not been regenerated for those tables yet, so these
 * modules query through a loose client and map rows explicitly.
 */
export function loose(supabase: GhostClient): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

/** True when the error means the migration has not been applied to this database. */
export function isMissingRelation(message: string): boolean {
  return /does not exist|schema cache|could not find the (table|function)/i.test(message);
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
