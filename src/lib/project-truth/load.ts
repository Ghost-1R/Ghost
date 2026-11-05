import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";
import { assembleProjectTruthSnapshot, type ProjectTruthSnapshot } from "./snapshot";
import type { DeploymentAttemptInput } from "./types";

function isMissingTable(message: string, table: string): boolean {
  return new RegExp(`${table}|does not exist|schema cache`, "i").test(message);
}

/**
 * Load a Project Truth snapshot for one project from existing Ghost tables.
 * Missing optional tables degrade to UNKNOWN facets — never fabricate.
 */
export async function loadProjectTruthSnapshot(
  supabase: GhostClient,
  input: {
    projectId: string;
    projectName: string;
    /** null = inspector not evaluated; true/false = known freshness. */
    hasFreshInspectorPass?: boolean | null;
  },
): Promise<QueryResult<ProjectTruthSnapshot>> {
  const projectId = input.projectId;

  const [deployments, release, blockers, defects, verified, decisions] = await Promise.all([
    supabase
      .from("deployments")
      .select(
        "id, project_id, human_id, status, failure_reason, created_at, environment_id, expected_commit_sha, live_commit_sha",
      )
      .eq("project_id", projectId)
      .in("status", ["FAILED", "SUCCEEDED"])
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("releases")
      .select("id, status, production_verified_at, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("blockers")
      .select("id, title, status, created_at")
      .eq("project_id", projectId)
      .eq("status", "OPEN"),
    supabase
      .from("verification_defects")
      .select("id, status, blocking, severity")
      .eq("project_id", projectId)
      .in("status", ["OPEN", "IN_PROGRESS", "RETEST_REQUIRED"])
      .eq("blocking", true),
    supabase
      .from("verification_records")
      .select("project_id")
      .eq("project_id", projectId)
      .eq("state", "VERIFIED")
      .not("checked_at", "is", null)
      .limit(1),
    supabase
      .from("project_decisions")
      .select("id, title, status, created_at")
      .eq("project_id", projectId)
      .eq("status", "OPEN")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (deployments.error && !isMissingTable(deployments.error.message, "deployments")) {
    return fromError(deployments.error);
  }
  if (blockers.error) return fromError(blockers.error);

  const attempts: DeploymentAttemptInput[] = !deployments.error
    ? (deployments.data ?? []).map((row) => ({
        id: String(row.id),
        projectId: String(row.project_id),
        status: String(row.status),
        createdAt: String(row.created_at),
        humanId: row.human_id != null ? String(row.human_id) : null,
        failureReason: row.failure_reason != null ? String(row.failure_reason) : null,
        environmentId: row.environment_id != null ? String(row.environment_id) : null,
        commitSha:
          (row.live_commit_sha && String(row.live_commit_sha).trim()) ||
          (row.expected_commit_sha && String(row.expected_commit_sha).trim()) ||
          null,
      }))
    : [];

  const releaseStatus =
    !release.error && release.data?.status != null ? String(release.data.status) : null;
  const productionVerified =
    releaseStatus === "PRODUCTION_VERIFIED" ||
    Boolean(!release.error && release.data?.production_verified_at);

  const openBlockingDefects =
    !defects.error && defects.data
      ? defects.data.length
      : 0;

  const legacyVerifiedRecord = !verified.error && (verified.data?.length ?? 0) > 0;

  const snapshot = assembleProjectTruthSnapshot({
    projectId,
    projectName: input.projectName,
    attempts,
    releaseStatus,
    productionVerified,
    hasFreshInspectorPass: input.hasFreshInspectorPass ?? null,
    legacyVerifiedRecord,
    openBlockingDefects,
    blockers: (blockers.data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      at: row.created_at != null ? String(row.created_at) : null,
      href: `/projects/${projectId}`,
    })),
    openDecisions:
      !decisions.error && decisions.data
        ? decisions.data.map((row) => ({
            id: String(row.id),
            title: String(row.title),
            at: row.created_at != null ? String(row.created_at) : null,
            href: `/projects/${projectId}`,
          }))
        : [],
  });

  return { status: "ok", data: snapshot };
}
