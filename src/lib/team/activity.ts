import type { GhostClient } from "@/lib/auth/session";
import type { Json } from "@/lib/database.types";

/**
 * Record a project activity event via record_project_activity.
 * Soft-fails: a missing RPC (migration not applied) or a denied write never
 * blocks the primary action. Returns whether the event was written.
 */
export async function recordActivitySoft(
  supabase: GhostClient,
  input: {
    companyId: string;
    projectId?: string | null;
    action: string;
    summary: string;
    recordType?: string | null;
    recordId?: string | null;
    metadata?: Json;
    externalUnconnected?: boolean;
  },
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("record_project_activity", {
      p_company_id: input.companyId,
      p_project_id: input.projectId ?? null,
      p_actor_kind: "PERSON",
      p_action: input.action,
      p_summary: input.summary,
      p_record_type: input.recordType ?? null,
      p_record_id: input.recordId ?? null,
      p_metadata: input.metadata ?? {},
      p_external_unconnected: input.externalUnconnected ?? false,
    });
    return !error;
  } catch {
    return false;
  }
}
