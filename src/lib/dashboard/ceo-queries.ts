import type { SupabaseClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import type { CeoSignal } from "@/lib/dashboard/ceo";
import {
  classifyDeploymentAttemptStatuses,
  type DeploymentAttemptInput,
} from "@/lib/project-truth";
import { fromError, type QueryResult } from "@/lib/result";

export type CeoSignalBundle = {
  signals: CeoSignal[];
  verifiedProjectIds: Set<string>;
  presentationReviews: Array<{
    id: string;
    projectId: string;
    projectName: string;
    result: string;
    createdAt: string;
  }>;
};

type ReviewRow = {
  id: string;
  project_id: string;
  result: string;
  created_at: string;
};

/**
 * Load RED/YELLOW-capable signals from existing Ghost tables only.
 * No client_events. Missing tables degrade gracefully.
 */
export async function loadCeoSignals(
  supabase: GhostClient,
  projects: readonly { id: string; name: string }[],
): Promise<QueryResult<CeoSignalBundle>> {
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length === 0) {
    return {
      status: "ok",
      data: { signals: [], verifiedProjectIds: new Set(), presentationReviews: [] },
    };
  }

  const [blockers, defects, health, deployments, verificationFailed, verified, reviews] =
    await Promise.all([
      supabase
        .from("blockers")
        .select("id, project_id, title, description, status, created_at")
        .in("project_id", projectIds)
        .eq("status", "OPEN"),
      supabase
        .from("verification_defects")
        .select("id, project_id, title, severity, status, blocking, created_at")
        .in("project_id", projectIds)
        .in("status", ["OPEN", "IN_PROGRESS", "RETEST_REQUIRED"])
        .in("severity", ["CRITICAL", "HIGH"]),
      supabase
        .from("deployment_health_checks")
        .select("id, project_id, check_name, status, updated_at")
        .in("project_id", projectIds)
        .eq("status", "FAILED"),
      // SUCCEEDED + FAILED so older failures can be marked SUPERSEDED by lineage.
      supabase
        .from("deployments")
        .select(
          "id, project_id, human_id, status, failure_reason, created_at, environment_id, expected_commit_sha",
        )
        .in("project_id", projectIds)
        .in("status", ["FAILED", "SUCCEEDED"])
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("verification_records")
        .select("id, project_id, category, target, state, checked_at, created_at")
        .in("project_id", projectIds)
        .eq("state", "FAILED"),
      supabase
        .from("verification_records")
        .select("project_id")
        .in("project_id", projectIds)
        .eq("state", "VERIFIED")
        .not("checked_at", "is", null),
      (supabase as unknown as SupabaseClient)
        .from("presentation_reviews")
        .select("id, project_id, result, created_at")
        .in("project_id", projectIds)
        .in("result", ["NOT_READY", "READY_WITH_GAPS"])
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (blockers.error) return fromError(blockers.error);

  const signals: CeoSignal[] = [];

  for (const row of blockers.data ?? []) {
    signals.push({
      id: `blocker-${row.id}`,
      projectId: row.project_id,
      projectName: names.get(row.project_id) ?? "Project",
      kind: "blocker",
      severity: "critical",
      title: row.title,
      detail: row.description?.trim() || row.title,
      at: row.created_at,
      href: `/projects/${row.project_id}`,
      clientFacing: true,
    });
  }

  if (!defects.error && defects.data) {
    for (const row of defects.data) {
      if (!names.has(row.project_id)) continue;
      const critical = row.severity === "CRITICAL" || row.blocking === true;
      signals.push({
        id: `defect-${row.id}`,
        projectId: row.project_id,
        projectName: names.get(row.project_id) ?? "Project",
        kind: "critical_defect",
        severity: critical ? "critical" : "high",
        title: row.title,
        detail: `${row.severity} verification defect (${row.status}).`,
        at: row.created_at,
        href: `/projects/${row.project_id}/verification`,
        clientFacing: true,
      });
    }
  }

  if (!deployments.error && deployments.data) {
    const attempts: DeploymentAttemptInput[] = deployments.data.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      status: String(row.status),
      createdAt: String(row.created_at),
      humanId: row.human_id != null ? String(row.human_id) : null,
      failureReason: row.failure_reason != null ? String(row.failure_reason) : null,
      environmentId: row.environment_id != null ? String(row.environment_id) : null,
      commitSha: row.expected_commit_sha != null ? String(row.expected_commit_sha) : null,
    }));
    const classified = classifyDeploymentAttemptStatuses(attempts);

    for (const row of classified) {
      if (!names.has(row.projectId)) continue;
      if (row.operationalState !== "FAILED") continue;
      signals.push({
        id: `deploy-${row.id}`,
        projectId: row.projectId,
        projectName: names.get(row.projectId) ?? "Project",
        kind: "failed_deployment",
        severity: "critical",
        title: `${row.humanId ?? row.id} failed`,
        detail: row.failureReason?.trim() || "Deployment attempt FAILED.",
        at: row.createdAt,
        href: `/projects/${row.projectId}/deploy`,
        clientFacing: true,
      });
    }
  }

  if (!health.error && health.data) {
    for (const row of health.data) {
      if (!names.has(row.project_id)) continue;
      signals.push({
        id: `health-${row.id}`,
        projectId: row.project_id,
        projectName: names.get(row.project_id) ?? "Project",
        kind: "failed_health",
        severity: "critical",
        title: `Health check failed: ${row.check_name}`,
        detail: `Production health check "${row.check_name}" is FAILED.`,
        at: row.updated_at,
        href: `/projects/${row.project_id}/deploy`,
        clientFacing: true,
      });
    }
  }

  if (!verificationFailed.error && verificationFailed.data) {
    for (const row of verificationFailed.data) {
      const security =
        String(row.category).toUpperCase() === "AUTHENTICATION" || /security/i.test(row.target);
      signals.push({
        id: `vfail-${row.id}`,
        projectId: row.project_id,
        projectName: names.get(row.project_id) ?? "Project",
        kind: "failed_verification",
        severity: security ? "critical" : "high",
        title: `Verification failed: ${row.target}`,
        detail: `${row.category} verification is FAILED.`,
        at: row.checked_at ?? row.created_at,
        href: `/projects/${row.project_id}`,
        clientFacing: security,
      });
    }
  }

  const verifiedProjectIds = new Set(
    !verified.error && verified.data ? verified.data.map((row) => row.project_id) : [],
  );

  const reviewRows = (!reviews.error && Array.isArray(reviews.data) ? reviews.data : []) as ReviewRow[];
  const presentationReviews = reviewRows
    .filter((row) => names.has(row.project_id))
    .map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: names.get(row.project_id) ?? "Project",
      result: String(row.result),
      createdAt: row.created_at,
    }));

  return {
    status: "ok",
    data: { signals, verifiedProjectIds, presentationReviews },
  };
}
