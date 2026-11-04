import type { GhostClient } from "@/lib/auth/session";
import { loose } from "@/lib/db/loose";

export type ActivityActorKind = "PERSON" | "AI" | "SYSTEM";

export type RecordActivityInput = {
  companyId: string;
  projectId: string | null;
  actorKind: ActivityActorKind;
  action: string;
  summary: string;
  recordType?: string | null;
  recordId?: string | null;
  metadata?: Record<string, unknown>;
  externalUnconnected?: boolean;
  actorLabel?: string;
};

/**
 * Record a timeline event through the `record_project_activity` RPC.
 * Best-effort: when the RPC is not available (migration not applied) or the
 * caller is not allowed, the primary action must still succeed, so this never throws.
 */
export async function recordActivity(
  supabase: GhostClient,
  input: RecordActivityInput,
): Promise<{ recorded: boolean; id: string | null; reason: string | null }> {
  try {
    const { data, error } = await loose(supabase).rpc("record_project_activity", {
      p_company_id: input.companyId,
      p_project_id: input.projectId,
      p_actor_kind: input.actorKind,
      p_action: input.action,
      p_summary: input.summary,
      p_record_type: input.recordType ?? null,
      p_record_id: input.recordId ?? null,
      p_metadata: input.metadata ?? {},
      p_external_unconnected: input.externalUnconnected ?? false,
      p_actor_label: input.actorLabel ?? "",
    });
    if (error) return { recorded: false, id: null, reason: error.message };
    return { recorded: true, id: typeof data === "string" ? data : null, reason: null };
  } catch (error) {
    return {
      recorded: false,
      id: null,
      reason: error instanceof Error ? error.message : "activity rpc failed",
    };
  }
}
