import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalRecord, EvidenceRecord, OverrideRecord, PresentationReview } from "./types";

export type RemoteWrite = { status: "blocked"; reason: string } | { status: "rejected"; reason: string } | { status: "written"; id: string };

export function remoteWriterStatus(input: { url: string; serviceRoleKey: string }): "CONFIGURED" | "NOT_CONFIGURED" {
  if (!input.url.trim() || !input.serviceRoleKey.trim()) {
    return "NOT_CONFIGURED";
  }
  return "CONFIGURED";
}

function credentials(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (remoteWriterStatus({ url, serviceRoleKey: key }) !== "CONFIGURED") {
    return null;
  }
  return { url, key };
}

function serviceClient(): SupabaseClient | null {
  const secret = credentials();
  if (!secret) {
    return null;
  }
  return createClient(secret.url, secret.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function blocked(): RemoteWrite {
  return { status: "blocked", reason: "Service-role secret is not configured." };
}

function publicReason(message: string): string {
  return message.replace(/eyJ[A-Za-z0-9_-]{8,}/g, "[redacted]").slice(0, 180);
}

async function founderOwnsProject(client: SupabaseClient, ownerId: string, projectId: string): Promise<boolean> {
  const project = await client.from("projects").select("id, company_id").eq("id", projectId).maybeSingle();
  if (project.error || !project.data?.company_id) {
    return false;
  }
  const company = await client.from("companies").select("id").eq("id", project.data.company_id).eq("owner_id", ownerId).maybeSingle();
  return !company.error && Boolean(company.data);
}

export async function persistEvidence(record: Omit<EvidenceRecord, "id">): Promise<RemoteWrite> {
  const client = serviceClient();
  if (!client) {
    return blocked();
  }
  if (!(await founderOwnsProject(client, record.ownerId, record.projectId))) {
    return { status: "rejected", reason: "That project is not visible." };
  }
  const inserted = await client
    .from("inspection_evidence")
    .insert({
      project_id: record.projectId,
      run_id: record.runId,
      check_type: record.checkType,
      commit_sha: record.commitSha,
      tree_hash: record.treeHash,
      command: record.command,
      exit_code: record.exitCode,
      duration_ms: record.durationMs,
      output_hash: record.outputHash,
      log_excerpt: record.logExcerpt,
      runner: "inspector",
      environment: record.environment,
      status: record.status,
      created_at: record.createdAt,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data?.id) {
    return { status: "rejected", reason: publicReason(inserted.error?.message ?? "Evidence was not stored.") };
  }
  return { status: "written", id: inserted.data.id };
}

export async function persistApproval(record: Omit<ApprovalRecord, "id">): Promise<RemoteWrite> {
  const client = serviceClient();
  if (!client) {
    return blocked();
  }
  if (!(await founderOwnsProject(client, record.approvedBy, record.projectId))) {
    return { status: "rejected", reason: "That project is not visible." };
  }
  const inserted = await client
    .from("presentation_approvals")
    .insert({
      project_id: record.projectId,
      operation: record.operation,
      target: record.target,
      commit_sha: record.commitSha,
      risk_level: record.riskLevel,
      evidence_ids_shown: record.evidenceIdsShown,
      approved_by: record.approvedBy,
      approved_at: record.approvedAt,
      expires_at: record.expiresAt,
      fingerprint: record.fingerprint,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data?.id) {
    return { status: "rejected", reason: publicReason(inserted.error?.message ?? "Approval was not stored.") };
  }
  return { status: "written", id: inserted.data.id };
}

export async function persistOverride(record: Omit<OverrideRecord, "id">): Promise<RemoteWrite> {
  const client = serviceClient();
  if (!client) {
    return blocked();
  }
  if (!(await founderOwnsProject(client, record.founderId, record.projectId))) {
    return { status: "rejected", reason: "That project is not visible." };
  }
  const inserted = await client
    .from("presentation_overrides")
    .insert({
      project_id: record.projectId,
      reason: record.reason,
      founder_id: record.founderId,
      created_at: record.createdAt,
      target: record.target,
      commit_sha: record.commitSha,
      affected_checks: record.affectedChecks,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data?.id) {
    return { status: "rejected", reason: publicReason(inserted.error?.message ?? "Override was not stored.") };
  }
  return { status: "written", id: inserted.data.id };
}

export async function persistReview(review: PresentationReview): Promise<RemoteWrite> {
  const client = serviceClient();
  if (!client) {
    return blocked();
  }
  if (!(await founderOwnsProject(client, review.ownerId, review.projectId))) {
    return { status: "rejected", reason: "That project is not visible." };
  }
  const inserted = await client
    .from("presentation_reviews")
    .insert({
      project_id: review.projectId,
      commit_sha: review.commitSha,
      tree_hash: review.treeHash,
      environment: review.environment,
      created_at: review.createdAt,
      evidence_ids: review.evidenceIds,
      result: review.result,
      report: {
        gaps: review.gaps,
        findings: review.findings,
        traceability: review.traceability,
        fixQueue: review.fixQueue,
        overrides: review.overrides,
      },
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data?.id) {
    return { status: "rejected", reason: publicReason(inserted.error?.message ?? "Review was not stored.") };
  }
  return { status: "written", id: inserted.data.id };
}
