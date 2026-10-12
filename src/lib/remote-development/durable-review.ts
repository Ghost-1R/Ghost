import { loadAgentTaskById } from "@/lib/agent-runtime/queries";
import type { GhostClient } from "@/lib/auth/session";
import { transitionRemoteDevTask } from "./contract";
import {
  appendRemoteDevReviewEvent,
  insertFounderDeliverableReview,
  loadFounderDeliverableReviewByIdempotency,
  loadRemoteDevTaskById,
  updateRemoteDevTaskState,
} from "./queries";
import type { FounderDeliverableDecision, RemoteDevTask } from "./types";

export type DurableReviewResult =
  | {
      ok: true;
      task: RemoteDevTask;
      decision: FounderDeliverableDecision;
      idempotent: boolean;
      resultingStatus: RemoteDevTask["status"];
    }
  | { ok: false; reason: string; message: string };

function decisionToStatus(decision: FounderDeliverableDecision): RemoteDevTask["status"] {
  if (decision === "ACCEPT") return "VERIFIED";
  if (decision === "REJECT") return "FAILED";
  return "CHANGES_REQUESTED";
}

/**
 * Authenticated durable founder deliverable review.
 * ACCEPT / REJECT / REQUEST_CHANGES. No deployment. No auth reuse.
 */
export async function reviewDurableDevelopmentDeliverable(
  supabase: GhostClient,
  input: {
    ownerId: string;
    remoteTaskId: string;
    decision: FounderDeliverableDecision;
    note?: string;
    idempotencyKey: string;
    at?: string;
  },
): Promise<DurableReviewResult> {
  if (!input.ownerId.trim()) {
    return { ok: false, reason: "MISSING_OWNER", message: "Owner is required." };
  }
  if (!input.idempotencyKey.trim() || input.idempotencyKey.trim().length < 8) {
    return { ok: false, reason: "MISSING_IDEMPOTENCY", message: "Idempotency key must be at least 8 characters." };
  }
  if (
    input.decision !== "ACCEPT" &&
    input.decision !== "REJECT" &&
    input.decision !== "REQUEST_CHANGES"
  ) {
    return { ok: false, reason: "INVALID_DECISION", message: "Decision must be ACCEPT, REJECT, or REQUEST_CHANGES." };
  }

  const prior = await loadFounderDeliverableReviewByIdempotency(
    supabase,
    input.ownerId,
    input.idempotencyKey.trim(),
  );
  if (prior.status === "error") {
    return { ok: false, reason: "LOAD_FAILED", message: prior.message };
  }
  if (prior.data) {
    const taskReload = await loadRemoteDevTaskById(supabase, input.ownerId, input.remoteTaskId);
    if (taskReload.status === "error" || !taskReload.data) {
      return {
        ok: false,
        reason: "LOAD_FAILED",
        message: taskReload.status === "error" ? taskReload.message : "Task missing after idempotent review.",
      };
    }
    return {
      ok: true,
      task: taskReload.data,
      decision: prior.data.decision,
      idempotent: true,
      resultingStatus: prior.data.resultingStatus as RemoteDevTask["status"],
    };
  }

  const loaded = await loadRemoteDevTaskById(supabase, input.ownerId, input.remoteTaskId);
  if (loaded.status === "error") {
    return { ok: false, reason: "LOAD_FAILED", message: loaded.message };
  }
  if (!loaded.data) {
    return { ok: false, reason: "NOT_FOUND", message: "Durable development task is not visible." };
  }
  const task = loaded.data;
  if (task.ownerId !== input.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: "Only the owning founder can review this deliverable." };
  }
  if (task.deploymentAuthorized !== false) {
    return {
      ok: false,
      reason: "DEPLOYMENT_NOT_AUTHORIZED",
      message: "Development review refuses any deployment authorization flag.",
    };
  }

  // Idempotent ACCEPT when already VERIFIED
  if (input.decision === "ACCEPT" && task.status === "VERIFIED") {
    return {
      ok: true,
      task,
      decision: "ACCEPT",
      idempotent: true,
      resultingStatus: "VERIFIED",
    };
  }

  if (task.status !== "AWAITING_FOUNDER_REVIEW") {
    return {
      ok: false,
      reason: "INVALID_STATUS",
      message: `Durable review requires AWAITING_FOUNDER_REVIEW, got ${task.status}.`,
    };
  }

  if (!task.agentTaskId) {
    return {
      ok: false,
      reason: "MISSING_AGENT_TASK",
      message: "Completed agent task binding is required before founder deliverable review.",
    };
  }

  const agent = await loadAgentTaskById(supabase, input.ownerId, task.agentTaskId);
  if (agent.status === "error") {
    return { ok: false, reason: "AGENT_LOAD_FAILED", message: agent.message };
  }
  if (!agent.data) {
    return { ok: false, reason: "MISSING_AGENT_TASK", message: "Bound agent task is not visible." };
  }
  if (agent.data.projectId !== task.projectId || agent.data.ownerId !== task.ownerId) {
    return { ok: false, reason: "PROJECT_MISMATCH", message: "Agent task owner/project does not match remote task." };
  }
  if (agent.data.binding.authorizationId !== task.binding.authorizationId) {
    return {
      ok: false,
      reason: "AUTH_MISMATCH",
      message: "Agent task authorization does not match the remote development task.",
    };
  }

  if (input.decision === "ACCEPT" && agent.data.status !== "SUCCEEDED") {
    return {
      ok: false,
      reason: "AGENT_NOT_SUCCEEDED",
      message: `ACCEPT requires agent task SUCCEEDED, got ${agent.data.status}.`,
    };
  }

  if (input.decision === "ACCEPT") {
    const hasTaskEvidence =
      Boolean(task.evidence?.commitSha) ||
      Boolean(task.evidence?.testResultsRef) ||
      Boolean(task.evidence?.pullRequestRef) ||
      (task.evidence?.artifactHashes?.length ?? 0) > 0;
    const hasAgentEvidence =
      agent.data.status === "SUCCEEDED" &&
      Boolean(agent.data.completedAt) &&
      Boolean(agent.data.lastCheckpointId);
    // Prefer structured task evidence; durable Docker pilots may only have agent checkpoint completion.
    if (!hasTaskEvidence && !hasAgentEvidence) {
      return {
        ok: false,
        reason: "MISSING_EVIDENCE",
        message: "ACCEPT requires valid completion evidence (task evidence or agent checkpoint).",
      };
    }
  }

  const at = input.at ?? new Date().toISOString();
  const nextStatus = decisionToStatus(input.decision);
  const transitioned = transitionRemoteDevTask(task, nextStatus, {
    ownerId: input.ownerId,
    at,
    detail: `Founder durable review: ${input.decision}`,
  });
  if (!transitioned.ok) {
    return { ok: false, reason: "ILLEGAL_TRANSITION", message: transitioned.reason };
  }

  const saved = await updateRemoteDevTaskState(supabase, transitioned.task, {
    expectedStatus: "AWAITING_FOUNDER_REVIEW",
  });
  if (saved.status === "error") {
    return { ok: false, reason: "PERSIST_FAILED", message: saved.message };
  }

  const note = (input.note ?? "").trim().slice(0, 4000);
  const inserted = await insertFounderDeliverableReview(supabase, {
    ownerId: input.ownerId,
    projectId: task.projectId,
    remoteDevelopmentTaskId: task.id,
    agentTaskId: task.agentTaskId,
    authorizationId: task.binding.authorizationId,
    decision: input.decision,
    note,
    resultingStatus: nextStatus,
    scopeFingerprint: task.binding.scopeFingerprint,
    idempotencyKey: input.idempotencyKey.trim(),
    createdAt: at,
  });
  if (inserted.status === "error") {
    return { ok: false, reason: "REVIEW_AUDIT_FAILED", message: inserted.message };
  }

  await appendRemoteDevReviewEvent(supabase, {
    ownerId: task.ownerId,
    projectId: task.projectId,
    remoteDevelopmentTaskId: task.id,
    agentTaskId: task.agentTaskId,
    authorizationId: task.binding.authorizationId,
    eventType: `FOUNDER_REVIEW_${input.decision}`,
    detail: note || `Founder durable review recorded: ${input.decision} → ${nextStatus}. No deployment.`,
    scopeFingerprint: task.binding.scopeFingerprint,
  });

  return {
    ok: true,
    task: saved.data,
    decision: input.decision,
    idempotent: false,
    resultingStatus: nextStatus,
  };
}
