import type { SupabaseClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";
import type { RemoteDevTask, RemoteDevTaskStatus } from "./types";

type TaskRow = {
  id: string;
  owner_id: string;
  project_id: string;
  objective: string;
  status: string;
  authorization_id: string;
  authorization_kind: string;
  action_type: string;
  action_scope: string;
  environment_label: string;
  scope_fingerprint: string;
  repository: string;
  approved_base_branch: string;
  base_commit_sha: string | null;
  task_branch: string | null;
  provider_kind: string;
  external_job_id: string | null;
  requires_independent_review: boolean;
  deployment_authorized: boolean;
  max_estimated_cost_usd: number | null;
  max_duration_ms: number;
  evidence: unknown;
  last_error: unknown;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  projects?: { name: string } | { name: string }[] | null;
};

function db(supabase: GhostClient): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

function isMissingTable(message: string): boolean {
  return /remote_development_tasks|schema cache|does not exist/i.test(message);
}

function projectName(value: TaskRow["projects"]): string {
  if (!value) return "Project";
  if (Array.isArray(value)) return value[0]?.name ?? "Project";
  return value.name || "Project";
}

export function mapRemoteDevTaskRow(row: TaskRow): RemoteDevTask {
  const evidence =
    row.evidence && typeof row.evidence === "object" ? (row.evidence as RemoteDevTask["evidence"]) : null;
  const lastError =
    row.last_error && typeof row.last_error === "object"
      ? (row.last_error as RemoteDevTask["lastError"])
      : null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    projectName: projectName(row.projects),
    objective: row.objective,
    status: row.status as RemoteDevTaskStatus,
    binding: {
      authorizationId: row.authorization_id,
      authorizationKind: row.authorization_kind as RemoteDevTask["binding"]["authorizationKind"],
      actionType: row.action_type,
      actionScope: row.action_scope,
      environmentLabel: row.environment_label,
      scopeFingerprint: row.scope_fingerprint,
    },
    spending: {
      maxEstimatedCostUsd: row.max_estimated_cost_usd,
      currency: "USD",
    },
    duration: { maxDurationMs: row.max_duration_ms },
    git: {
      repository: row.repository,
      approvedBaseBranch: row.approved_base_branch,
      baseCommitSha: row.base_commit_sha,
      taskBranch: row.task_branch,
    },
    providerKind: row.provider_kind as RemoteDevTask["providerKind"],
    externalJobId: row.external_job_id,
    requiresIndependentReview: row.requires_independent_review,
    deploymentAuthorized: false,
    checkpoints: [],
    lastError,
    evidence,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/**
 * Load remote development tasks for the authenticated founder.
 * Missing table → empty ok (schema not applied yet). Never invents rows.
 */
export async function loadRemoteDevTasks(
  supabase: GhostClient,
  options?: { limit?: number },
): Promise<QueryResult<RemoteDevTask[]>> {
  const limit = options?.limit ?? 50;
  const { data, error } = await db(supabase)
    .from("remote_development_tasks")
    .select(
      "id, owner_id, project_id, objective, status, authorization_id, authorization_kind, action_type, action_scope, environment_label, scope_fingerprint, repository, approved_base_branch, base_commit_sha, task_branch, provider_kind, external_job_id, requires_independent_review, deployment_authorized, max_estimated_cost_usd, max_duration_ms, evidence, last_error, idempotency_key, created_at, updated_at, queued_at, started_at, completed_at, projects(name)",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTable(error.message)) return { status: "ok", data: [] };
    return fromError(error);
  }
  return { status: "ok", data: ((data ?? []) as TaskRow[]).map(mapRemoteDevTaskRow) };
}

export async function insertRemoteDevTask(
  supabase: GhostClient,
  task: RemoteDevTask,
): Promise<QueryResult<RemoteDevTask>> {
  const { data, error } = await db(supabase)
    .from("remote_development_tasks")
    .insert({
      id: task.id,
      owner_id: task.ownerId,
      project_id: task.projectId,
      objective: task.objective,
      status: task.status,
      authorization_id: task.binding.authorizationId,
      authorization_kind: task.binding.authorizationKind,
      action_type: task.binding.actionType,
      action_scope: task.binding.actionScope,
      environment_label: task.binding.environmentLabel,
      scope_fingerprint: task.binding.scopeFingerprint,
      repository: task.git.repository,
      approved_base_branch: task.git.approvedBaseBranch,
      base_commit_sha: task.git.baseCommitSha,
      task_branch: task.git.taskBranch,
      provider_kind: task.providerKind,
      external_job_id: task.externalJobId,
      requires_independent_review: task.requiresIndependentReview,
      deployment_authorized: false,
      max_estimated_cost_usd: task.spending.maxEstimatedCostUsd,
      max_duration_ms: task.duration.maxDurationMs,
      evidence: task.evidence,
      last_error: task.lastError,
      idempotency_key: task.idempotencyKey,
      queued_at: task.queuedAt,
      started_at: task.startedAt,
      completed_at: task.completedAt,
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingTable(error.message)) {
      return {
        status: "error",
        message: "remote_development_tasks table is not available in this environment.",
      };
    }
    return fromError(error);
  }
  return { status: "ok", data: mapRemoteDevTaskRow(data as TaskRow) };
}
