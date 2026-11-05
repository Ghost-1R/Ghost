import type { SupabaseClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";
import type {
  ShiftEvidenceLink,
  UnderworldShiftJob,
  UnderworldShiftJobStatus,
  UnderworldShiftWorkflow,
} from "./types";

type JobRow = {
  id: string;
  owner_id: string;
  company_id: string;
  project_id: string;
  workflow: string;
  status: string;
  idempotency_key: string;
  authorization_id: string | null;
  agent_task_id: string | null;
  build_plan_id: string | null;
  checkpoint_step: number;
  checkpoint_label: string;
  result_fingerprint: string | null;
  review_summary: string;
  evidence: unknown;
  block_reason: string;
  lease_holder_id: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  timezone: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function db(supabase: GhostClient | SupabaseClient): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

function isMissing(message: string): boolean {
  return /underworld_shift_jobs|schema cache|does not exist/i.test(message);
}

function mapEvidence(value: unknown): ShiftEvidenceLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const label = typeof row.label === "string" ? row.label : "";
      const href = typeof row.href === "string" ? row.href : "";
      if (!label || !href) return null;
      return { label, href };
    })
    .filter((item): item is ShiftEvidenceLink => item != null);
}

export function mapShiftJobRow(row: JobRow): UnderworldShiftJob {
  return {
    id: row.id,
    ownerId: row.owner_id,
    companyId: row.company_id,
    projectId: row.project_id,
    workflow: row.workflow as UnderworldShiftWorkflow,
    status: row.status as UnderworldShiftJobStatus,
    idempotencyKey: row.idempotency_key,
    authorizationId: row.authorization_id,
    agentTaskId: row.agent_task_id,
    buildPlanId: row.build_plan_id,
    checkpointStep: row.checkpoint_step,
    checkpointLabel: row.checkpoint_label ?? "",
    resultFingerprint: row.result_fingerprint,
    reviewSummary: row.review_summary ?? "",
    evidence: mapEvidence(row.evidence),
    blockReason: row.block_reason ?? "",
    leaseHolderId: row.lease_holder_id,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    timezone: row.timezone,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertShiftJob(
  supabase: GhostClient | SupabaseClient,
  job: {
    id?: string;
    ownerId: string;
    companyId: string;
    projectId: string;
    workflow?: UnderworldShiftWorkflow;
    status: UnderworldShiftJobStatus;
    idempotencyKey: string;
    authorizationId?: string | null;
    buildPlanId?: string | null;
    timezone?: string;
  },
): Promise<QueryResult<UnderworldShiftJob>> {
  const { data, error } = await db(supabase)
    .from("underworld_shift_jobs")
    .insert({
      id: job.id,
      owner_id: job.ownerId,
      company_id: job.companyId,
      project_id: job.projectId,
      workflow: job.workflow ?? "BUILD_PLAN_REVIEW",
      status: job.status,
      idempotency_key: job.idempotencyKey,
      authorization_id: job.authorizationId ?? null,
      build_plan_id: job.buildPlanId ?? null,
      timezone: job.timezone ?? "America/New_York",
    })
    .select("*")
    .single();

  if (error) {
    if (isMissing(error.message)) {
      return { status: "error", message: "underworld_shift_jobs is not available." };
    }
    if (/duplicate|unique/i.test(error.message)) {
      const existing = await loadShiftJobByIdempotency(
        supabase,
        job.ownerId,
        job.idempotencyKey,
      );
      if (existing.status === "ok" && existing.data) {
        return { status: "ok", data: existing.data };
      }
    }
    return fromError(error);
  }
  return { status: "ok", data: mapShiftJobRow(data as JobRow) };
}

export async function loadShiftJobById(
  supabase: GhostClient | SupabaseClient,
  jobId: string,
): Promise<QueryResult<UnderworldShiftJob | null>> {
  const { data, error } = await db(supabase)
    .from("underworld_shift_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) {
    if (isMissing(error.message)) {
      return { status: "error", message: "underworld_shift_jobs is not available." };
    }
    return fromError(error);
  }
  return { status: "ok", data: data ? mapShiftJobRow(data as JobRow) : null };
}

export async function loadShiftJobByIdempotency(
  supabase: GhostClient | SupabaseClient,
  ownerId: string,
  idempotencyKey: string,
): Promise<QueryResult<UnderworldShiftJob | null>> {
  const { data, error } = await db(supabase)
    .from("underworld_shift_jobs")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) {
    if (isMissing(error.message)) {
      return { status: "error", message: "underworld_shift_jobs is not available." };
    }
    return fromError(error);
  }
  return { status: "ok", data: data ? mapShiftJobRow(data as JobRow) : null };
}

export async function listShiftJobsForOwner(
  supabase: GhostClient | SupabaseClient,
  ownerId: string,
  limit = 40,
): Promise<QueryResult<UnderworldShiftJob[]>> {
  const { data, error } = await db(supabase)
    .from("underworld_shift_jobs")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissing(error.message)) {
      return { status: "error", message: "underworld_shift_jobs is not available." };
    }
    return fromError(error);
  }
  return { status: "ok", data: (data as JobRow[]).map(mapShiftJobRow) };
}

export async function listShiftJobsForProject(
  supabase: GhostClient | SupabaseClient,
  projectId: string,
  limit = 20,
): Promise<QueryResult<UnderworldShiftJob[]>> {
  const { data, error } = await db(supabase)
    .from("underworld_shift_jobs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissing(error.message)) {
      return { status: "error", message: "underworld_shift_jobs is not available." };
    }
    return fromError(error);
  }
  return { status: "ok", data: (data as JobRow[]).map(mapShiftJobRow) };
}

export async function listClaimableShiftJobs(
  supabase: GhostClient | SupabaseClient,
  limit = 10,
): Promise<QueryResult<UnderworldShiftJob[]>> {
  const { data, error } = await db(supabase)
    .from("underworld_shift_jobs")
    .select("*")
    .eq("status", "QUEUED")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    if (isMissing(error.message)) {
      return { status: "error", message: "underworld_shift_jobs is not available." };
    }
    return fromError(error);
  }
  return { status: "ok", data: (data as JobRow[]).map(mapShiftJobRow) };
}

export async function listAwaitingApprovalJobs(
  supabase: GhostClient | SupabaseClient,
  limit = 20,
): Promise<QueryResult<UnderworldShiftJob[]>> {
  const { data, error } = await db(supabase)
    .from("underworld_shift_jobs")
    .select("*")
    .eq("status", "AWAITING_APPROVAL")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    if (isMissing(error.message)) {
      return { status: "error", message: "underworld_shift_jobs is not available." };
    }
    return fromError(error);
  }
  return { status: "ok", data: (data as JobRow[]).map(mapShiftJobRow) };
}

export async function claimShiftJob(
  supabase: GhostClient | SupabaseClient,
  input: { jobId: string; holderId: string; leaseToken: string; leaseSeconds?: number },
): Promise<QueryResult<UnderworldShiftJob | null>> {
  const { data, error } = await db(supabase).rpc("claim_underworld_shift_job", {
    p_job_id: input.jobId,
    p_lease_holder: input.holderId,
    p_lease_token: input.leaseToken,
    p_lease_seconds: input.leaseSeconds ?? 900,
  });
  if (error) {
    if (isMissing(error.message)) {
      return { status: "error", message: "underworld_shift_jobs is not available." };
    }
    return fromError(error);
  }
  if (!data) return { status: "ok", data: null };
  return loadShiftJobById(supabase, input.jobId);
}

export async function checkpointShiftJobAtBoundary(
  supabase: GhostClient | SupabaseClient,
  input: {
    jobId: string;
    holderId: string;
    leaseToken: string;
    checkpointStep: number;
    checkpointLabel: string;
  },
): Promise<QueryResult<UnderworldShiftJob | null>> {
  const { data, error } = await db(supabase).rpc("checkpoint_underworld_shift_job", {
    p_job_id: input.jobId,
    p_lease_holder: input.holderId,
    p_lease_token: input.leaseToken,
    p_checkpoint_step: input.checkpointStep,
    p_checkpoint_label: input.checkpointLabel,
  });
  if (error) {
    if (isMissing(error.message)) {
      return { status: "error", message: "underworld_shift_jobs is not available." };
    }
    return fromError(error);
  }
  if (!data) return { status: "ok", data: null };
  return loadShiftJobById(supabase, input.jobId);
}

export async function updateShiftJob(
  supabase: GhostClient | SupabaseClient,
  jobId: string,
  patch: Partial<{
    status: UnderworldShiftJobStatus;
    authorizationId: string | null;
    agentTaskId: string | null;
    buildPlanId: string | null;
    checkpointStep: number;
    checkpointLabel: string;
    resultFingerprint: string | null;
    reviewSummary: string;
    evidence: ShiftEvidenceLink[];
    blockReason: string;
    leaseHolderId: string | null;
    leaseToken: string | null;
    leaseExpiresAt: string | null;
    completedAt: string | null;
  }>,
): Promise<QueryResult<UnderworldShiftJob>> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.authorizationId !== undefined) row.authorization_id = patch.authorizationId;
  if (patch.agentTaskId !== undefined) row.agent_task_id = patch.agentTaskId;
  if (patch.buildPlanId !== undefined) row.build_plan_id = patch.buildPlanId;
  if (patch.checkpointStep !== undefined) row.checkpoint_step = patch.checkpointStep;
  if (patch.checkpointLabel !== undefined) row.checkpoint_label = patch.checkpointLabel;
  if (patch.resultFingerprint !== undefined) row.result_fingerprint = patch.resultFingerprint;
  if (patch.reviewSummary !== undefined) row.review_summary = patch.reviewSummary;
  if (patch.evidence !== undefined) row.evidence = patch.evidence;
  if (patch.blockReason !== undefined) row.block_reason = patch.blockReason;
  if (patch.leaseHolderId !== undefined) row.lease_holder_id = patch.leaseHolderId;
  if (patch.leaseToken !== undefined) row.lease_token = patch.leaseToken;
  if (patch.leaseExpiresAt !== undefined) row.lease_expires_at = patch.leaseExpiresAt;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;

  const { data, error } = await db(supabase)
    .from("underworld_shift_jobs")
    .update(row)
    .eq("id", jobId)
    .select("*")
    .single();

  if (error) {
    if (isMissing(error.message)) {
      return { status: "error", message: "underworld_shift_jobs is not available." };
    }
    if (/duplicate|unique/i.test(error.message) && patch.resultFingerprint) {
      const existing = await loadShiftJobById(supabase, jobId);
      if (existing.status === "ok" && existing.data?.status === "COMPLETE") {
        return { status: "ok", data: existing.data };
      }
    }
    return fromError(error);
  }
  return { status: "ok", data: mapShiftJobRow(data as JobRow) };
}
