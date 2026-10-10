import type { SupabaseClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";
import type {
  AuthorizationEvent,
  AuthorizationEvidenceItem,
  AuthorizationRequestInput,
  AuthorizationReusePolicy,
  AuthorizationStatus,
  FounderActionAuthorization,
} from "./types";
import {
  effectiveAuthorizationStatus,
  scopeFingerprint,
  validateAuthorizationRequest,
} from "./workflow";

type AuthRow = {
  id: string;
  owner_id: string;
  project_id: string;
  environment_label: string;
  decision_id: string | null;
  action_type: string;
  action_scope: string;
  scope_fingerprint: string;
  reason: string;
  evidence: unknown;
  side_effects: string;
  estimated_cost: string;
  status: string;
  reuse_policy: string;
  max_uses: number | null;
  use_count: number;
  expires_at: string;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string;
  consumed_at: string | null;
  idempotency_key: string;
};

type EventRow = {
  id: string;
  authorization_id: string;
  event_type: string;
  detail: string;
  scope_fingerprint: string;
  actor_id: string | null;
  created_at: string;
};

function db(supabase: GhostClient): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

function isMissingTable(message: string): boolean {
  return /founder_action_authorizations|founder_authorization_events|schema cache|does not exist/i.test(
    message,
  );
}

function parseEvidence(value: unknown): AuthorizationEvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const source = typeof row.source === "string" ? row.source : "";
      const reference = typeof row.reference === "string" ? row.reference : "";
      if (!source || !reference) return null;
      return {
        source,
        reference,
        at: typeof row.at === "string" ? row.at : null,
      };
    })
    .filter((item): item is AuthorizationEvidenceItem => item != null);
}

function mapAuthorization(row: AuthRow, projectName: string): FounderActionAuthorization {
  const status = row.status as AuthorizationStatus;
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    projectName,
    environmentLabel: row.environment_label,
    decisionId: row.decision_id,
    actionType: row.action_type,
    actionScope: row.action_scope,
    scopeFingerprint: row.scope_fingerprint,
    reason: row.reason,
    evidence: parseEvidence(row.evidence),
    sideEffects: row.side_effects ?? "",
    estimatedCost: row.estimated_cost || "UNKNOWN",
    status,
    effectiveStatus: effectiveAuthorizationStatus(status, row.expires_at),
    reusePolicy: row.reuse_policy as AuthorizationReusePolicy,
    maxUses: row.max_uses,
    useCount: row.use_count,
    expiresAt: row.expires_at,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revokeReason: row.revoke_reason ?? "",
    consumedAt: row.consumed_at,
    idempotencyKey: row.idempotency_key,
  };
}

async function appendEvent(
  supabase: GhostClient,
  input: {
    authorizationId: string;
    ownerId: string;
    eventType: string;
    detail: string;
    scopeFingerprint: string;
    actorId: string | null;
  },
): Promise<void> {
  await db(supabase).from("founder_authorization_events").insert({
    authorization_id: input.authorizationId,
    owner_id: input.ownerId,
    event_type: input.eventType,
    detail: input.detail,
    scope_fingerprint: input.scopeFingerprint,
    actor_id: input.actorId,
  });
}

export async function loadFounderAuthorizations(
  supabase: GhostClient,
  ownerId: string,
): Promise<QueryResult<FounderActionAuthorization[]>> {
  const projects = await supabase.from("projects").select("id, name");
  if (projects.error) return fromError(projects.error);
  const names = new Map((projects.data ?? []).map((row) => [row.id, row.name]));

  const result = await db(supabase)
    .from("founder_action_authorizations")
    .select("*")
    .eq("owner_id", ownerId)
    .order("requested_at", { ascending: false })
    .limit(100);

  if (result.error) {
    if (isMissingTable(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }

  const rows = (result.data ?? []) as AuthRow[];
  return {
    status: "ok",
    data: rows
      .filter((row) => names.has(row.project_id))
      .map((row) => mapAuthorization(row, names.get(row.project_id) ?? "Project")),
  };
}

export async function loadAuthorizationById(
  supabase: GhostClient,
  ownerId: string,
  authorizationId: string,
): Promise<QueryResult<FounderActionAuthorization | null>> {
  const result = await db(supabase)
    .from("founder_action_authorizations")
    .select("*")
    .eq("id", authorizationId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (result.error) {
    if (isMissingTable(result.error.message)) return { status: "ok", data: null };
    return fromError(result.error);
  }
  if (!result.data) return { status: "ok", data: null };

  const row = result.data as AuthRow;
  const project = await supabase.from("projects").select("id, name").eq("id", row.project_id).maybeSingle();
  if (project.error) return fromError(project.error);
  if (!project.data) return { status: "ok", data: null };
  return { status: "ok", data: mapAuthorization(row, project.data.name) };
}

export async function loadAuthorizationEvents(
  supabase: GhostClient,
  ownerId: string,
  authorizationId: string,
): Promise<QueryResult<AuthorizationEvent[]>> {
  const result = await db(supabase)
    .from("founder_authorization_events")
    .select("id, authorization_id, event_type, detail, scope_fingerprint, actor_id, created_at")
    .eq("owner_id", ownerId)
    .eq("authorization_id", authorizationId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (result.error) {
    if (isMissingTable(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }

  const rows = (result.data ?? []) as EventRow[];
  return {
    status: "ok",
    data: rows.map((row) => ({
      id: row.id,
      authorizationId: row.authorization_id,
      eventType: row.event_type,
      detail: row.detail,
      scopeFingerprint: row.scope_fingerprint,
      actorId: row.actor_id,
      createdAt: row.created_at,
    })),
  };
}

export async function createFounderAuthorization(
  supabase: GhostClient,
  ownerId: string,
  input: AuthorizationRequestInput,
): Promise<QueryResult<FounderActionAuthorization>> {
  const validation = validateAuthorizationRequest(input);
  if (validation) return { status: "error", message: validation };

  const project = await supabase.from("projects").select("id, name").eq("id", input.projectId).maybeSingle();
  if (project.error) return fromError(project.error);
  if (!project.data) return { status: "error", message: "That project is not visible." };

  if (input.decisionId) {
    const decision = await supabase
      .from("project_decisions")
      .select("id, project_id, status")
      .eq("id", input.decisionId)
      .maybeSingle();
    if (decision.error && !/project_decisions|does not exist/i.test(decision.error.message)) {
      return fromError(decision.error);
    }
    if (decision.data && decision.data.project_id !== input.projectId) {
      return { status: "error", message: "Decision does not belong to the selected project." };
    }
  }

  const environmentLabel = (input.environmentLabel ?? "UNKNOWN").trim() || "UNKNOWN";
  const fingerprint = scopeFingerprint({
    projectId: input.projectId,
    actionType: input.actionType,
    actionScope: input.actionScope,
    environmentLabel,
  });

  const existing = await db(supabase)
    .from("founder_action_authorizations")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("idempotency_key", input.idempotencyKey.trim())
    .maybeSingle();

  if (existing.error && !isMissingTable(existing.error.message)) {
    return fromError(existing.error);
  }
  if (existing.data) {
    return {
      status: "ok",
      data: mapAuthorization(existing.data as AuthRow, project.data.name),
    };
  }

  const inserted = await db(supabase)
    .from("founder_action_authorizations")
    .insert({
      owner_id: ownerId,
      project_id: input.projectId,
      environment_label: environmentLabel,
      decision_id: input.decisionId || null,
      action_type: input.actionType.trim(),
      action_scope: input.actionScope.trim(),
      scope_fingerprint: fingerprint,
      reason: input.reason.trim(),
      evidence: input.evidence ?? [],
      side_effects: (input.sideEffects ?? "").trim(),
      estimated_cost: (input.estimatedCost ?? "UNKNOWN").trim() || "UNKNOWN",
      status: "PENDING",
      reuse_policy: input.reusePolicy ?? "ONE_TIME",
      max_uses: input.reusePolicy === "BOUNDED" ? input.maxUses : null,
      use_count: 0,
      expires_at: input.expiresAt,
      idempotency_key: input.idempotencyKey.trim(),
    })
    .select("*")
    .single();

  if (inserted.error) {
    if (isMissingTable(inserted.error.message)) {
      return {
        status: "error",
        message:
          "Approval storage is not available yet. Apply the local founder_action_authorizations migration first.",
      };
    }
    if (/duplicate|unique/i.test(inserted.error.message)) {
      const retry = await db(supabase)
        .from("founder_action_authorizations")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("idempotency_key", input.idempotencyKey.trim())
        .maybeSingle();
      if (retry.data) {
        return {
          status: "ok",
          data: mapAuthorization(retry.data as AuthRow, project.data.name),
        };
      }
    }
    return fromError(inserted.error);
  }

  const row = inserted.data as AuthRow;
  await appendEvent(supabase, {
    authorizationId: row.id,
    ownerId,
    eventType: "REQUESTED",
    detail: `Requested ${row.action_type} for project ${input.projectId}.`,
    scopeFingerprint: fingerprint,
    actorId: ownerId,
  });

  return { status: "ok", data: mapAuthorization(row, project.data.name) };
}

export async function transitionFounderAuthorization(
  supabase: GhostClient,
  ownerId: string,
  authorizationId: string,
  next: {
    status: AuthorizationStatus;
    eventType: string;
    detail: string;
    revokeReason?: string;
  },
): Promise<QueryResult<FounderActionAuthorization>> {
  const current = await loadAuthorizationById(supabase, ownerId, authorizationId);
  if (current.status === "error") return current;
  if (!current.data) return { status: "error", message: "That authorization is not visible." };

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    status: next.status,
  };
  if (next.status === "APPROVED" || next.status === "REJECTED") {
    payload.decided_at = now;
    payload.decided_by = ownerId;
  }
  if (next.status === "REVOKED") {
    payload.revoked_at = now;
    payload.revoked_by = ownerId;
    payload.revoke_reason = (next.revokeReason ?? next.detail).trim();
  }

  const updated = await db(supabase)
    .from("founder_action_authorizations")
    .update(payload)
    .eq("id", authorizationId)
    .eq("owner_id", ownerId)
    .select("*")
    .single();

  if (updated.error) {
    if (isMissingTable(updated.error.message)) {
      return {
        status: "error",
        message:
          "Approval storage is not available yet. Apply the local founder_action_authorizations migration first.",
      };
    }
    return fromError(updated.error);
  }

  const row = updated.data as AuthRow;
  await appendEvent(supabase, {
    authorizationId,
    ownerId,
    eventType: next.eventType,
    detail: next.detail,
    scopeFingerprint: row.scope_fingerprint,
    actorId: ownerId,
  });

  return {
    status: "ok",
    data: mapAuthorization(row, current.data.projectName),
  };
}

/**
 * Atomically record one use. Fails closed if status is no longer APPROVED or
 * use_count changed (concurrent consumer won the race).
 */
export async function markAuthorizationConsumed(
  supabase: GhostClient,
  ownerId: string,
  authorizationId: string,
): Promise<QueryResult<FounderActionAuthorization>> {
  const current = await loadAuthorizationById(supabase, ownerId, authorizationId);
  if (current.status === "error") return current;
  if (!current.data) return { status: "error", message: "That authorization is not visible." };
  if (current.data.effectiveStatus !== "APPROVED" || current.data.status !== "APPROVED") {
    return { status: "error", message: "Authorization is not APPROVED for consumption." };
  }

  const nextUse = current.data.useCount + 1;
  const consumeFully =
    current.data.reusePolicy === "ONE_TIME" ||
    (current.data.reusePolicy === "BOUNDED" &&
      current.data.maxUses != null &&
      nextUse >= current.data.maxUses);

  const updated = await db(supabase)
    .from("founder_action_authorizations")
    .update({
      use_count: nextUse,
      status: consumeFully ? "CONSUMED" : "APPROVED",
      consumed_at: consumeFully ? new Date().toISOString() : current.data.consumedAt,
    })
    .eq("id", authorizationId)
    .eq("owner_id", ownerId)
    .eq("status", "APPROVED")
    .eq("use_count", current.data.useCount)
    .select("*")
    .maybeSingle();

  if (updated.error) return fromError(updated.error);
  if (!updated.data) {
    return {
      status: "error",
      message: "Concurrent consumption or status change blocked this use.",
    };
  }
  const row = updated.data as AuthRow;
  await appendEvent(supabase, {
    authorizationId,
    ownerId,
    eventType: consumeFully ? "CONSUMED" : "USE_RECORDED",
    detail: `Executor recorded use ${nextUse}.`,
    scopeFingerprint: row.scope_fingerprint,
    actorId: ownerId,
  });
  return { status: "ok", data: mapAuthorization(row, current.data.projectName) };
}
