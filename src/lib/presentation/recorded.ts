import type { SupabaseClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import type { PresentationResult, PresentationReview } from "./types";

const RESULTS = new Set<PresentationResult>(["READY", "READY_WITH_GAPS", "NOT_READY"]);

type ReviewRow = {
  id: string;
  project_id: string;
  commit_sha: string;
  tree_hash: string;
  environment: string;
  created_at: string;
  evidence_ids: string[] | null;
  result: string;
  report: Partial<Pick<PresentationReview, "gaps" | "findings" | "traceability" | "fixQueue" | "overrides">> | null;
};

export function reviewFromRow(row: ReviewRow, ownerId: string): PresentationReview | null {
  if (!RESULTS.has(row.result as PresentationResult) || (row.environment !== "local" && row.environment !== "production")) {
    return null;
  }
  return {
    id: row.id,
    ownerId,
    projectId: row.project_id,
    commitSha: row.commit_sha,
    treeHash: row.tree_hash,
    environment: row.environment,
    createdAt: row.created_at,
    evidenceIds: row.evidence_ids ?? [],
    findings: row.report?.findings ?? [],
    traceability: row.report?.traceability ?? [],
    result: row.result as PresentationResult,
    gaps: row.report?.gaps ?? [],
    fixQueue: row.report?.fixQueue ?? [],
    overrides: row.report?.overrides ?? [],
  };
}

export async function loadRecordedReview(
  client: GhostClient,
  ownerId: string,
  projectId: string,
  environment: "local" | "production",
): Promise<PresentationReview | null> {
  const { data, error } = await (client as unknown as SupabaseClient)
    .from("presentation_reviews")
    .select("id, project_id, commit_sha, tree_hash, environment, created_at, evidence_ids, result, report")
    .eq("project_id", projectId)
    .eq("environment", environment)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ReviewRow>();
  if (error || !data) {
    return null;
  }
  return reviewFromRow(data, ownerId);
}
