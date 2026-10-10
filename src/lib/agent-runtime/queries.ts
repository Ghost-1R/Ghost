import type { SupabaseClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";
import type {
  AgentAuthorizationKind,
  AgentTask,
  AgentTaskAuditEvent,
  AgentTaskCheckpoint,
  AgentTaskLease,
  AgentTaskStatus,
} from "./types";

type TaskRow = {
  id: string;
  owner_id: string;
  project_id: string;
  status: string;
  authorization_id: string;
  authorization_kind: string;
  action_type: string;
  action_scope: string;
  environment_label: string;
  scope_fingerprint: string;
  lease_holder_id: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  checkpoint_sequence: number;
  last_checkpoint_id: string | null;
  last_step_idempotency_key: string;
  idempotency_key: string;
  block_reason: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  completed_at: string | null;
};

type EventRow = {
  id: string;
  task_id: string;
  event_type: string;
  detail: string;
  authorization_id: string;
  scope_fingerprint: string;
  actor_id: string | null;
  created_at: string;
};

function db(supabase: GhostClient): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

function isMissingTable(message: string): boolean {
  return /agent_tasks|agent_task_events|agent_task_checkpoints|schema cache|does not exist/i.test(
    message,
  );
}

function mapLease(row: TaskRow): AgentTaskLease | null {
  if (!row.lease_holder_id || !row.lease_token || !row.lease_expires_at) return null;
  return {
    holderId: row.lease_holder_id,
    token: row.lease_token,
    expiresAt: row.lease_expires_at,
  };
}

export function mapAgentTaskRow(row: TaskRow): AgentTask {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    status: row.status as AgentTaskStatus,
    binding: {
      authorizationId: row.authorization_id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      actionType: row.action_type,
      actionScope: row.action_scope,
      environmentLabel: row.environment_label,
      scopeFingerprint: row.scope_fingerprint,
      authorizationKind: row.authorization_kind as AgentAuthorizationKind,
    },
    lease: mapLease(row),
    checkpointSequence: row.checkpoint_sequence,
    lastCheckpointId: row.last_checkpoint_id,
    lastStepIdempotencyKey: row.last_step_idempotency_key ?? "",
    idempotencyKey: row.idempotency_key,
    blockReason: row.block_reason ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
  };
}

function mapEvent(row: EventRow): AgentTaskAuditEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type,
    detail: row.detail,
    authorizationId: row.authorization_id,
    scopeFingerprint: row.scope_fingerprint,
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

export async function appendAgentTaskEvent(
  supabase: GhostClient,
  event: Omit<AgentTaskAuditEvent, "id" | "createdAt"> & { ownerId: string },
): Promise<QueryResult<AgentTaskAuditEvent>> {
  const { data, error } = await db(supabase)
    .from("agent_task_events")
    .insert({
      task_id: event.taskId,
      owner_id: event.ownerId,
      event_type: event.eventType,
      detail: event.detail,
      authorization_id: event.authorizationId,
      scope_fingerprint: event.scopeFingerprint,
      actor_id: event.actorId,
    })
    .select("id, task_id, event_type, detail, authorization_id, scope_fingerprint, actor_id, created_at")
    .single();

  if (error) {
    if (isMissingTable(error.message)) {
      return {
        status: "error",
        message: "agent_task_events table is not available in this environment.",
      };
    }
    return fromError(error);
  }
  return { status: "ok", data: mapEvent(data as EventRow) };
}

/**
 * Persist a newly bound QUEUED agent task.
 * Never stores credentials. Requires matching founder authorization FK.
 */
export async function insertAgentTask(
  supabase: GhostClient,
  task: AgentTask,
): Promise<QueryResult<AgentTask>> {
  const { data, error } = await db(supabase)
    .from("agent_tasks")
    .insert({
      id: task.id,
      owner_id: task.ownerId,
      project_id: task.projectId,
      status: task.status,
      authorization_id: task.binding.authorizationId,
      authorization_kind: task.binding.authorizationKind,
      action_type: task.binding.actionType,
      action_scope: task.binding.actionScope,
      environment_label: task.binding.environmentLabel,
      scope_fingerprint: task.binding.scopeFingerprint,
      checkpoint_sequence: task.checkpointSequence,
      last_checkpoint_id: task.lastCheckpointId,
      last_step_idempotency_key: task.lastStepIdempotencyKey,
      idempotency_key: task.idempotencyKey,
      block_reason: task.blockReason,
      claimed_at: task.claimedAt,
      completed_at: task.completedAt,
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingTable(error.message)) {
      return { status: "error", message: "agent_tasks table is not available in this environment." };
    }
    if (/duplicate|unique/i.test(error.message)) {
      const existing = await loadAgentTaskByIdempotencyKey(supabase, task.ownerId, task.idempotencyKey);
      if (existing.status === "ok" && existing.data) {
        return { status: "ok", data: existing.data };
      }
    }
    return fromError(error);
  }

  const mapped = mapAgentTaskRow(data as TaskRow);
  await appendAgentTaskEvent(supabase, {
    taskId: mapped.id,
    ownerId: mapped.ownerId,
    eventType: "CREATED",
    detail: `Bound to authorization ${mapped.binding.authorizationId} (${mapped.binding.authorizationKind}).`,
    authorizationId: mapped.binding.authorizationId,
    scopeFingerprint: mapped.binding.scopeFingerprint,
    actorId: mapped.ownerId,
  });

  return { status: "ok", data: mapped };
}

export async function loadAgentTaskById(
  supabase: GhostClient,
  ownerId: string,
  taskId: string,
): Promise<QueryResult<AgentTask | null>> {
  const { data, error } = await db(supabase)
    .from("agent_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error.message)) {
      return { status: "error", message: "agent_tasks table is not available in this environment." };
    }
    return fromError(error);
  }
  return { status: "ok", data: data ? mapAgentTaskRow(data as TaskRow) : null };
}

export async function loadAgentTaskByIdempotencyKey(
  supabase: GhostClient,
  ownerId: string,
  idempotencyKey: string,
): Promise<QueryResult<AgentTask | null>> {
  const { data, error } = await db(supabase)
    .from("agent_tasks")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error.message)) {
      return { status: "error", message: "agent_tasks table is not available in this environment." };
    }
    return fromError(error);
  }
  return { status: "ok", data: data ? mapAgentTaskRow(data as TaskRow) : null };
}

export async function persistAgentTaskState(
  supabase: GhostClient,
  task: AgentTask,
): Promise<QueryResult<AgentTask>> {
  const { data, error } = await db(supabase)
    .from("agent_tasks")
    .update({
      status: task.status,
      lease_holder_id: task.lease?.holderId ?? null,
      lease_token: task.lease?.token ?? null,
      lease_expires_at: task.lease?.expiresAt ?? null,
      checkpoint_sequence: task.checkpointSequence,
      last_checkpoint_id: task.lastCheckpointId,
      last_step_idempotency_key: task.lastStepIdempotencyKey,
      block_reason: task.blockReason,
      claimed_at: task.claimedAt,
      completed_at: task.completedAt,
      updated_at: task.updatedAt,
    })
    .eq("id", task.id)
    .eq("owner_id", task.ownerId)
    .select("*")
    .single();

  if (error) {
    if (isMissingTable(error.message)) {
      return { status: "error", message: "agent_tasks table is not available in this environment." };
    }
    return fromError(error);
  }
  return { status: "ok", data: mapAgentTaskRow(data as TaskRow) };
}

export async function insertAgentTaskCheckpoint(
  supabase: GhostClient,
  input: {
    ownerId: string;
    taskId: string;
    checkpoint: AgentTaskCheckpoint;
  },
): Promise<QueryResult<AgentTaskCheckpoint>> {
  const { data, error } = await db(supabase)
    .from("agent_task_checkpoints")
    .insert({
      id: input.checkpoint.id,
      task_id: input.taskId,
      owner_id: input.ownerId,
      sequence: input.checkpoint.sequence,
      label: input.checkpoint.label,
      progress_ref: input.checkpoint.progressRef,
      authorization_id: input.checkpoint.authorizationId,
      scope_fingerprint: input.checkpoint.scopeFingerprint,
      created_at: input.checkpoint.createdAt,
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingTable(error.message)) {
      return {
        status: "error",
        message: "agent_task_checkpoints table is not available in this environment.",
      };
    }
    return fromError(error);
  }

  const row = data as {
    id: string;
    sequence: number;
    label: string;
    progress_ref: string;
    created_at: string;
    authorization_id: string;
    scope_fingerprint: string;
  };

  return {
    status: "ok",
    data: {
      id: row.id,
      sequence: row.sequence,
      label: row.label,
      progressRef: row.progress_ref,
      createdAt: row.created_at,
      authorizationId: row.authorization_id,
      scopeFingerprint: row.scope_fingerprint,
    },
  };
}

export async function loadAgentTaskEvents(
  supabase: GhostClient,
  ownerId: string,
  taskId: string,
): Promise<QueryResult<AgentTaskAuditEvent[]>> {
  const { data, error } = await db(supabase)
    .from("agent_task_events")
    .select("id, task_id, event_type, detail, authorization_id, scope_fingerprint, actor_id, created_at")
    .eq("task_id", taskId)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingTable(error.message)) {
      return {
        status: "error",
        message: "agent_task_events table is not available in this environment.",
      };
    }
    return fromError(error);
  }
  return { status: "ok", data: ((data ?? []) as EventRow[]).map(mapEvent) };
}
