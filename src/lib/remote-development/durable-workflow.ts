import { randomUUID } from "node:crypto";
import {
  insertAgentTask,
  loadAgentTaskById,
  persistAgentTaskState,
} from "@/lib/agent-runtime/queries";
import type { AgentTask } from "@/lib/agent-runtime/types";
import { createBoundAgentTask } from "@/lib/agent-runtime/workflow";
import { authorizeLocalExecution } from "@/lib/approvals/execution-gate";
import {
  createFounderAuthorization,
  loadAuthorizationById,
  transitionFounderAuthorization,
} from "@/lib/approvals/queries";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { decideApprove, decideRevoke, scopeFingerprint } from "@/lib/approvals/workflow";
import type { GhostClient } from "@/lib/auth/session";
import {
  elapsedMsSinceTaskCreated,
  gateRemoteDevQueue,
  gateRemoteDevStep,
} from "./authorization-gate";
import { createRemoteDevTask, transitionRemoteDevTask } from "./contract";
import {
  appendRemoteDevReviewEvent,
  bindRemoteDevAgentTask,
  insertRemoteDevTask,
  loadRemoteDevTaskById,
  updateRemoteDevTaskState,
} from "./queries";
import { assertRemoteDevAgentLinkAllowed } from "./relationship";
import { projectDevelopmentState, type DevelopmentStateProjection } from "./state-projection";
import type { RemoteDevTask } from "./types";
import type { DevelopmentRequestInput } from "./workflow";

export type DurableWorkflowResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; message: string };

export type DurableDevelopmentBundle = {
  remote: RemoteDevTask;
  authorization: FounderActionAuthorization;
  agent: AgentTask | null;
  authorizationConsumed: boolean;
  projection: DevelopmentStateProjection;
};

function fail<T>(reason: string, message: string): DurableWorkflowResult<T> {
  return { ok: false, reason, message };
}

/**
 * Create a durable development request:
 * Founder Approval Center authorization row + remote_development_tasks row.
 * Never falls back to MEMORY_TEST_ONLY.
 */
export async function createDurableDevelopmentRequest(
  supabase: GhostClient,
  input: DevelopmentRequestInput,
): Promise<DurableWorkflowResult<DurableDevelopmentBundle>> {
  if (!input.ownerId.trim() || !input.projectId.trim()) {
    return fail("MISSING_IDENTITY", "Owner and project are required.");
  }
  if (!input.objective.trim() || input.objective.trim().length < 8) {
    return fail("MISSING_OBJECTIVE", "A concrete objective is required.");
  }
  if (!input.repository.includes("/")) {
    return fail("MISSING_REPOSITORY", "Repository owner/name is required.");
  }
  if (!input.approvedBaseBranch.trim()) {
    return fail("MISSING_BASE_BRANCH", "Approved base branch is required.");
  }
  if (!Number.isFinite(input.maxEstimatedCostUsd) || input.maxEstimatedCostUsd < 0 || input.maxEstimatedCostUsd > 500) {
    return fail("INVALID_BUDGET", "Spending budget must be between 0 and 500 USD.");
  }
  if (!Number.isFinite(input.maxDurationMs) || input.maxDurationMs < 60_000 || input.maxDurationMs > 86_400_000) {
    return fail("INVALID_DURATION", "Duration must be between 1 minute and 24 hours.");
  }

  const at = input.at ?? new Date().toISOString();
  const environmentLabel = (input.environmentLabel ?? "REMOTE_DEV").trim() || "REMOTE_DEV";
  const actionType = "agent_task.develop";
  const actionScope = `repo:${input.repository.trim()}@${input.approvedBaseBranch.trim()}|obj:${input.objective.trim().slice(0, 200)}`;
  const fingerprint = scopeFingerprint({
    projectId: input.projectId,
    actionType,
    actionScope,
    environmentLabel,
  });
  const hours = input.expiresInHours ?? 24;
  const expiresAt = new Date(Date.parse(at) + hours * 60 * 60 * 1000).toISOString();
  const idempotencyKey = input.idempotencyKey?.trim() || `devreq-${randomUUID()}`;

  const authCreated = await createFounderAuthorization(supabase, input.ownerId, {
    projectId: input.projectId,
    environmentLabel,
    actionType,
    actionScope,
    reason: input.requirements?.trim() || input.objective.trim(),
    evidence:
      input.evidenceSource && input.evidenceReference
        ? [{ source: input.evidenceSource, reference: input.evidenceReference, at }]
        : [{ source: "founder_request", reference: idempotencyKey, at }],
    sideEffects: "Durable remote development preparation only — no deployment permission. Workers disabled.",
    estimatedCost: `USD ${input.maxEstimatedCostUsd}`,
    reusePolicy: "ONE_TIME",
    expiresAt,
    idempotencyKey,
  });
  if (authCreated.status === "error") {
    return fail("DURABLE_AUTH_UNAVAILABLE", authCreated.message);
  }

  const created = createRemoteDevTask({
    ownerId: input.ownerId,
    projectId: input.projectId,
    projectName: input.projectName,
    objective: input.objective,
    authorizationId: authCreated.data.id,
    authorizationKind: "DEVELOPMENT",
    actionType,
    actionScope,
    environmentLabel,
    scopeFingerprint: fingerprint,
    repository: input.repository,
    approvedBaseBranch: input.approvedBaseBranch,
    maxEstimatedCostUsd: input.maxEstimatedCostUsd,
    maxDurationMs: input.maxDurationMs,
    idempotencyKey,
    at,
  });
  if (!created.ok) {
    return fail(created.reason, created.message);
  }

  const inserted = await insertRemoteDevTask(supabase, created.task);
  if (inserted.status === "error") {
    return fail("DURABLE_TASK_UNAVAILABLE", inserted.message);
  }

  await appendRemoteDevReviewEvent(supabase, {
    ownerId: inserted.data.ownerId,
    projectId: inserted.data.projectId,
    remoteDevelopmentTaskId: inserted.data.id,
    authorizationId: authCreated.data.id,
    eventType: "REQUEST_CREATED",
    detail: "Durable development request created; authorization PENDING in Approval Center.",
    scopeFingerprint: fingerprint,
  });

  return {
    ok: true,
    data: {
      remote: inserted.data,
      authorization: authCreated.data,
      agent: null,
      authorizationConsumed: false,
      projection: projectDevelopmentState({
        remote: inserted.data,
        authorization: authCreated.data,
        agent: null,
        persistenceMode: "DATABASE",
      }),
    },
  };
}

/** Approve via durable Approval Center transition — never memory fallback. */
export async function approveDurableDevelopmentRequest(
  supabase: GhostClient,
  input: { ownerId: string; remoteTaskId: string; actorId: string; at?: string },
): Promise<DurableWorkflowResult<DurableDevelopmentBundle>> {
  const loaded = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
  if (!loaded.ok) return loaded;

  const decision = decideApprove(loaded.data.authorization, input.actorId, input.at);
  if (!decision.ok) {
    return fail("APPROVAL_DENIED", decision.reason);
  }

  const transitioned = await transitionFounderAuthorization(
    supabase,
    input.ownerId,
    loaded.data.authorization.id,
    {
      status: "APPROVED",
      eventType: "APPROVED",
      detail: "Founder approved DEVELOPMENT authorization. Approval does not execute.",
    },
  );
  if (transitioned.status === "error") {
    return fail("DURABLE_AUTH_TRANSITION_FAILED", transitioned.message);
  }

  await appendRemoteDevReviewEvent(supabase, {
    ownerId: loaded.data.remote.ownerId,
    projectId: loaded.data.remote.projectId,
    remoteDevelopmentTaskId: loaded.data.remote.id,
    agentTaskId: loaded.data.remote.agentTaskId,
    authorizationId: transitioned.data.id,
    eventType: "AUTHORIZATION_APPROVED",
    detail: "Durable DEVELOPMENT authorization approved.",
    scopeFingerprint: loaded.data.remote.binding.scopeFingerprint,
  });

  return {
    ok: true,
    data: {
      ...loaded.data,
      authorization: transitioned.data,
      projection: projectDevelopmentState({
        remote: loaded.data.remote,
        authorization: transitioned.data,
        agent: loaded.data.agent,
        persistenceMode: "DATABASE",
      }),
    },
  };
}

/**
 * Queue after durable revalidation:
 * 1) gate authorization
 * 2) atomically consume ONE_TIME via Approval Center CAS
 * 3) create/bind agent_tasks execution row
 * 4) advance remote-dev to QUEUED
 *
 * Does not activate workers or dispatch real providers.
 */
export async function queueDurableDevelopmentTask(
  supabase: GhostClient,
  input: {
    ownerId: string;
    remoteTaskId: string;
    at?: string;
    estimatedCostUsd?: number | null;
  },
): Promise<DurableWorkflowResult<DurableDevelopmentBundle>> {
  const loaded = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
  if (!loaded.ok) return loaded;

  const { remote, authorization } = loaded.data;
  if (remote.status !== "AWAITING_APPROVAL") {
    return fail("INVALID_STATUS", `Durable queue requires AWAITING_APPROVAL, got ${remote.status}.`);
  }
  if (remote.agentTaskId) {
    return fail("ALREADY_BOUND", "Remote development task already linked to an agent_tasks row.");
  }

  const at = input.at ?? new Date().toISOString();
  const plannedCost =
    input.estimatedCostUsd !== undefined
      ? input.estimatedCostUsd
      : remote.spending.maxEstimatedCostUsd;

  const gate = gateRemoteDevQueue(authorization, remote, {
    at,
    estimatedCostUsd: plannedCost,
    elapsedMs: elapsedMsSinceTaskCreated(remote, at),
  });
  if (!gate.ok) {
    return fail(gate.reason, gate.message);
  }

  // Bind agent_tasks while authorization is still APPROVED (binding rejects CONSUMED).
  const bound = createBoundAgentTask({
    ownerId: remote.ownerId,
    projectId: remote.projectId,
    authorization,
    authorizationKind: "DEVELOPMENT",
    actionType: remote.binding.actionType,
    actionScope: remote.binding.actionScope,
    environmentLabel: remote.binding.environmentLabel,
    idempotencyKey: `agent-for-${remote.idempotencyKey}`,
    at,
  });
  if (!bound.ok) {
    return fail(bound.reason, bound.message);
  }

  const linkCheck = assertRemoteDevAgentLinkAllowed(remote, bound.task);
  if (!linkCheck.ok) {
    return fail(linkCheck.reason, linkCheck.message);
  }

  const insertedAgent = await insertAgentTask(supabase, bound.task);
  if (insertedAgent.status === "error") {
    return fail("DURABLE_AGENT_TASK_UNAVAILABLE", insertedAgent.message);
  }

  // Durable ONE_TIME consume after execution row exists — never memory fallback.
  const consumed = await authorizeLocalExecution(supabase, {
    authorizationId: remote.binding.authorizationId,
    ownerId: remote.ownerId,
    projectId: remote.projectId,
    actionType: remote.binding.actionType,
    actionScope: remote.binding.actionScope,
    environmentLabel: remote.binding.environmentLabel,
    at,
    recordConsumption: gate.shouldConsume,
  });
  if (!consumed.ok) {
    return fail(consumed.reason, consumed.message);
  }

  let agentRow = insertedAgent.data;
  if (gate.shouldConsume || consumed.consumed?.status === "CONSUMED") {
    const marked: AgentTask = {
      ...agentRow,
      authorizationConsumed: true,
      updatedAt: at,
    };
    const persisted = await persistAgentTaskState(supabase, marked);
    if (persisted.status === "error") {
      return fail("DURABLE_AGENT_TASK_UNAVAILABLE", persisted.message);
    }
    agentRow = persisted.data;
  }

  const authAfter = await loadAuthorizationById(supabase, remote.ownerId, remote.binding.authorizationId);
  if (authAfter.status === "error" || !authAfter.data) {
    return fail(
      "DURABLE_AUTH_RELOAD_FAILED",
      authAfter.status === "error" ? authAfter.message : "Authorization missing after consumption.",
    );
  }

  const linked = await bindRemoteDevAgentTask(supabase, {
    ownerId: remote.ownerId,
    remoteTaskId: remote.id,
    agentTaskId: agentRow.id,
    expectedStatus: "AWAITING_APPROVAL",
    nextStatus: "QUEUED",
    at,
  });
  if (linked.status === "error") {
    return fail("BIND_FAILED", linked.message);
  }

  await appendRemoteDevReviewEvent(supabase, {
    ownerId: linked.data.ownerId,
    projectId: linked.data.projectId,
    remoteDevelopmentTaskId: linked.data.id,
    agentTaskId: linked.data.agentTaskId,
    authorizationId: linked.data.binding.authorizationId,
    eventType: "QUEUED_AND_BOUND",
    detail: `Queued after durable authorization revalidation; bound agent_tasks ${agentRow.id}. Workers not activated.`,
    scopeFingerprint: linked.data.binding.scopeFingerprint,
  });

  return {
    ok: true,
    data: {
      remote: linked.data,
      authorization: authAfter.data,
      agent: agentRow,
      authorizationConsumed: agentRow.authorizationConsumed,
      projection: projectDevelopmentState({
        remote: linked.data,
        authorization: authAfter.data,
        agent: agentRow,
        persistenceMode: "DATABASE",
      }),
    },
  };
}

/** Revalidate durable auth before any dispatch/claim/resume/step boundary. */
export async function revalidateDurableDevelopmentStep(
  supabase: GhostClient,
  input: {
    ownerId: string;
    remoteTaskId: string;
    at?: string;
    estimatedCostUsd?: number | null;
  },
): Promise<DurableWorkflowResult<DurableDevelopmentBundle>> {
  const loaded = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
  if (!loaded.ok) return loaded;

  const at = input.at ?? new Date().toISOString();
  const gate = gateRemoteDevStep(loaded.data.authorization, loaded.data.remote, {
    authorizationConsumed: loaded.data.authorizationConsumed,
    at,
    estimatedCostUsd:
      input.estimatedCostUsd !== undefined
        ? input.estimatedCostUsd
        : loaded.data.remote.spending.maxEstimatedCostUsd,
    elapsedMs: elapsedMsSinceTaskCreated(loaded.data.remote, at),
  });
  if (!gate.ok) {
    return fail(gate.reason, gate.message);
  }

  // Second durable load — refuse if auth disappeared or was revoked mid-flight.
  const fresh = await loadAuthorizationById(
    supabase,
    input.ownerId,
    loaded.data.remote.binding.authorizationId,
  );
  if (fresh.status === "error") {
    return fail("DURABLE_AUTH_RELOAD_FAILED", fresh.message);
  }
  const again = gateRemoteDevStep(fresh.data, loaded.data.remote, {
    authorizationConsumed: loaded.data.authorizationConsumed,
    at,
    estimatedCostUsd:
      input.estimatedCostUsd !== undefined
        ? input.estimatedCostUsd
        : loaded.data.remote.spending.maxEstimatedCostUsd,
    elapsedMs: elapsedMsSinceTaskCreated(loaded.data.remote, at),
  });
  if (!again.ok) {
    return fail(again.reason, again.message);
  }

  return {
    ok: true,
    data: {
      ...loaded.data,
      authorization: fresh.data ?? loaded.data.authorization,
      projection: projectDevelopmentState({
        remote: loaded.data.remote,
        authorization: fresh.data ?? loaded.data.authorization,
        agent: loaded.data.agent,
        persistenceMode: "DATABASE",
        at,
      }),
    },
  };
}

export async function persistDurableRemoteStatus(
  supabase: GhostClient,
  input: {
    ownerId: string;
    remoteTaskId: string;
    toStatus: RemoteDevTask["status"];
    expectedStatus: RemoteDevTask["status"];
    detail: string;
    evidence?: RemoteDevTask["evidence"];
    lastError?: RemoteDevTask["lastError"];
    at?: string;
  },
): Promise<DurableWorkflowResult<RemoteDevTask>> {
  const current = await loadRemoteDevTaskById(supabase, input.ownerId, input.remoteTaskId);
  if (current.status === "error") return fail("LOAD_FAILED", current.message);
  if (!current.data) return fail("NOT_FOUND", "Remote development task is not visible.");
  if (current.data.ownerId !== input.ownerId) {
    return fail("OWNER_MISMATCH", "Owner mismatch.");
  }

  const transitioned = transitionRemoteDevTask(current.data, input.toStatus, {
    ownerId: input.ownerId,
    at: input.at,
  });
  if (!transitioned.ok) {
    return fail("ILLEGAL_TRANSITION", transitioned.reason);
  }

  const next: RemoteDevTask = {
    ...transitioned.task,
    evidence: input.evidence !== undefined ? input.evidence : transitioned.task.evidence,
    lastError: input.lastError !== undefined ? input.lastError : transitioned.task.lastError,
  };

  const saved = await updateRemoteDevTaskState(supabase, next, {
    expectedStatus: input.expectedStatus,
  });
  if (saved.status === "error") return fail("PERSIST_FAILED", saved.message);

  await appendRemoteDevReviewEvent(supabase, {
    ownerId: saved.data.ownerId,
    projectId: saved.data.projectId,
    remoteDevelopmentTaskId: saved.data.id,
    agentTaskId: saved.data.agentTaskId,
    authorizationId: saved.data.binding.authorizationId,
    eventType: `STATUS_${input.toStatus}`,
    detail: input.detail.slice(0, 4000),
    scopeFingerprint: saved.data.binding.scopeFingerprint,
  });

  return { ok: true, data: saved.data };
}

export async function revokeDurableDevelopmentAuthorization(
  supabase: GhostClient,
  input: { ownerId: string; remoteTaskId: string; actorId: string; reason: string },
): Promise<DurableWorkflowResult<DurableDevelopmentBundle>> {
  const loaded = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
  if (!loaded.ok) return loaded;

  const decision = decideRevoke(loaded.data.authorization, input.actorId, input.reason);
  if (!decision.ok) {
    // Post-consume: cancel remote-dev only (auth stays CONSUMED — durable identity rule).
    if (
      (loaded.data.authorization.status === "CONSUMED" || loaded.data.authorizationConsumed) &&
      (loaded.data.remote.status === "QUEUED" ||
        loaded.data.remote.status === "RUNNING" ||
        loaded.data.remote.status === "BLOCKED" ||
        loaded.data.remote.status === "AWAITING_FOUNDER_REVIEW")
    ) {
      const cancelled = await persistDurableRemoteStatus(supabase, {
        ownerId: input.ownerId,
        remoteTaskId: input.remoteTaskId,
        toStatus: "CANCELLED",
        expectedStatus: loaded.data.remote.status,
        detail: `Post-consume execution halt: ${input.reason.trim().slice(0, 500)}`,
      });
      if (!cancelled.ok) return cancelled;
      return {
        ok: true,
        data: {
          ...loaded.data,
          remote: cancelled.data,
          projection: projectDevelopmentState({
            remote: cancelled.data,
            authorization: loaded.data.authorization,
            agent: loaded.data.agent,
            persistenceMode: "DATABASE",
          }),
        },
      };
    }
    return fail("REVOKE_DENIED", decision.reason);
  }

  const transitioned = await transitionFounderAuthorization(
    supabase,
    input.ownerId,
    loaded.data.authorization.id,
    {
      status: "REVOKED",
      eventType: "REVOKED",
      detail: input.reason.trim().slice(0, 2000),
      revokeReason: input.reason,
    },
  );
  if (transitioned.status === "error") {
    return fail("DURABLE_AUTH_TRANSITION_FAILED", transitioned.message);
  }

  let remote = loaded.data.remote;
  if (remote.status === "AWAITING_APPROVAL" || remote.status === "QUEUED" || remote.status === "RUNNING") {
    const cancelled = await persistDurableRemoteStatus(supabase, {
      ownerId: input.ownerId,
      remoteTaskId: input.remoteTaskId,
      toStatus: "CANCELLED",
      expectedStatus: remote.status,
      detail: `Revoked: ${input.reason.trim().slice(0, 500)}`,
    });
    if (cancelled.ok) remote = cancelled.data;
  }

  return {
    ok: true,
    data: {
      ...loaded.data,
      remote,
      authorization: transitioned.data,
      projection: projectDevelopmentState({
        remote,
        authorization: transitioned.data,
        agent: loaded.data.agent,
        persistenceMode: "DATABASE",
      }),
    },
  };
}

export async function loadDurableDevelopmentBundle(
  supabase: GhostClient,
  ownerId: string,
  remoteTaskId: string,
): Promise<DurableWorkflowResult<DurableDevelopmentBundle>> {
  const remote = await loadRemoteDevTaskById(supabase, ownerId, remoteTaskId);
  if (remote.status === "error") return fail("LOAD_FAILED", remote.message);
  if (!remote.data) return fail("NOT_FOUND", "Remote development task is not visible.");
  if (remote.data.ownerId !== ownerId) {
    return fail("OWNER_MISMATCH", "Owner mismatch.");
  }

  const auth = await loadAuthorizationById(supabase, ownerId, remote.data.binding.authorizationId);
  if (auth.status === "error") return fail("DURABLE_AUTH_UNAVAILABLE", auth.message);
  if (!auth.data) {
    return fail(
      "MISSING_AUTHORIZATION",
      "Durable Founder Approval Center authorization is required. Memory approval is not a fallback.",
    );
  }

  let agent: AgentTask | null = null;
  if (remote.data.agentTaskId) {
    const loadedAgent = await loadAgentTaskById(supabase, ownerId, remote.data.agentTaskId);
    if (loadedAgent.status === "error") {
      return fail("DURABLE_AGENT_TASK_UNAVAILABLE", loadedAgent.message);
    }
    agent = loadedAgent.data;
    if (!agent) {
      return fail("ORPHAN_LINK", "agent_task_id points to a missing agent_tasks row.");
    }
    const link = assertRemoteDevAgentLinkAllowed(remote.data, agent);
    if (!link.ok) return fail(link.reason, link.message);
  }

  return {
    ok: true,
    data: {
      remote: remote.data,
      authorization: auth.data,
      agent,
      authorizationConsumed:
        Boolean(agent?.authorizationConsumed) || auth.data.status === "CONSUMED",
      projection: projectDevelopmentState({
        remote: remote.data,
        authorization: auth.data,
        agent,
        persistenceMode: "DATABASE",
      }),
    },
  };
}
