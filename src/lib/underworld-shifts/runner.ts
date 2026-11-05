import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBoundAgentTask,
  createLease,
  insertAgentTask,
  insertAgentTaskCheckpoint,
  isLeaseValid,
  loadAgentTaskById,
  persistAgentTaskState,
} from "@/lib/agent-runtime";
import { createReviewArtifact } from "@/lib/agent-runtime/review-artifacts";
import {
  claimAgentTaskWithRevalidation,
  completeAgentTaskWithRevalidation,
  executeAgentTaskStepWithRevalidation,
} from "@/lib/agent-runtime/contract";
import { loadAuthorizationById } from "@/lib/approvals/queries";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { loadBuildPlan } from "@/lib/build-plan/queries";
import { loadVerification } from "@/lib/projects/queries";
import { runBuildPlanReviewStep } from "./build-plan-review";
import {
  claimShiftJob,
  checkpointShiftJobAtBoundary,
  listAwaitingApprovalJobs,
  listClaimableShiftJobs,
  loadShiftJobById,
  updateShiftJob,
} from "./queries";
import { shouldClaimNewTasks } from "./schedule";
import {
  BUILD_PLAN_REVIEW_ACTION_TYPE,
  BUILD_PLAN_REVIEW_STEPS,
  type UnderworldShiftJob,
} from "./types";
import { buildPlanReviewScope, decideReleaseAfterApproval } from "./workflow";

export const SHIFT_WORKER_ID = "ghost-underworld-shift-worker";

export type ShiftRunnerTickResult = {
  withinShift: boolean;
  releasedApprovals: number;
  claimed: number;
  advanced: number;
  checkpointed: number;
  completed: number;
  blocked: number;
  detail: string[];
};

async function releaseApprovedJobs(
  supabase: SupabaseClient,
  detail: string[],
): Promise<number> {
  const waiting = await listAwaitingApprovalJobs(supabase, 20);
  if (waiting.status !== "ok") {
    detail.push(waiting.message);
    return 0;
  }
  let released = 0;
  for (const job of waiting.data) {
    if (!job.authorizationId) continue;
    const auth = await loadAuthorizationById(supabase as never, job.ownerId, job.authorizationId);
    if (auth.status !== "ok" || !auth.data) continue;
    const decision = decideReleaseAfterApproval({
      jobStatus: job.status,
      authorizationStatus: auth.data.status,
    });
    if (!decision.ok) continue;
    const updated = await updateShiftJob(supabase, job.id, { status: "QUEUED" });
    if (updated.status === "ok") {
      released += 1;
      detail.push(`Released job ${job.id.slice(0, 8)} after founder approval.`);
    }
  }
  return released;
}

async function ensureBoundAgentTask(
  supabase: SupabaseClient,
  job: UnderworldShiftJob,
  at: string,
): Promise<
  | { ok: true; taskId: string; agentAlreadySucceeded: boolean }
  | { ok: false; message: string }
> {
  if (job.agentTaskId) {
    const existing = await loadAgentTaskById(supabase as never, job.ownerId, job.agentTaskId);
    if (existing.status === "ok" && existing.data) {
      if (existing.data.status === "SUCCEEDED") {
        // Agent finished but job row may still need COMPLETE (e.g. prior fingerprint collision).
        return { ok: true, taskId: existing.data.id, agentAlreadySucceeded: true };
      }
      if (existing.data.status === "FAILED" || existing.data.status === "CANCELLED") {
        // Fall through and bind a fresh agent task for a new attempt.
      } else {
        return { ok: true, taskId: existing.data.id, agentAlreadySucceeded: false };
      }
    }
  }
  if (!job.authorizationId) {
    return { ok: false, message: "Job is missing founder authorization." };
  }
  const auth = await loadAuthorizationById(supabase as never, job.ownerId, job.authorizationId);
  if (auth.status !== "ok" || !auth.data) {
    return { ok: false, message: auth.status === "error" ? auth.message : "Authorization missing." };
  }
  if (auth.data.status !== "APPROVED" && !(auth.data.status === "CONSUMED" && job.agentTaskId)) {
    return { ok: false, message: `Authorization is ${auth.data.status}, not APPROVED.` };
  }
  const bound = createBoundAgentTask({
    ownerId: job.ownerId,
    projectId: job.projectId,
    authorization: auth.data,
    actionType: BUILD_PLAN_REVIEW_ACTION_TYPE,
    actionScope: buildPlanReviewScope(job.projectId),
    environmentLabel: auth.data.environmentLabel || "LOCAL",
    authorizationKind: "DEVELOPMENT",
    idempotencyKey: `agent-${job.idempotencyKey}-s${job.checkpointStep}`,
    at,
  });
  if (!bound.ok) return { ok: false, message: bound.message };
  const inserted = await insertAgentTask(supabase as never, bound.task);
  if (inserted.status !== "ok") return { ok: false, message: inserted.message };
  if (
    inserted.data.status === "SUCCEEDED" ||
    inserted.data.status === "FAILED" ||
    inserted.data.status === "CANCELLED"
  ) {
    return { ok: false, message: `Bound agent task is already ${inserted.data.status}.` };
  }
  await updateShiftJob(supabase, job.id, { agentTaskId: inserted.data.id });
  return { ok: true, taskId: inserted.data.id, agentAlreadySucceeded: false };
}

async function loadReviewInput(
  supabase: SupabaseClient,
  projectId: string,
  idempotencyKey: string,
) {
  const [{ data: project }, plan, verification, risks] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    loadBuildPlan(supabase as never, projectId),
    loadVerification(supabase as never, projectId),
    supabase
      .from("build_plan_risks")
      .select("id, description, severity, mitigation")
      .eq("project_id", projectId)
      .order("human_id"),
  ]);

  return {
    projectId,
    projectName: project?.name ?? "Project",
    idempotencyKey,
    buildPlan:
      plan.status === "ok" && plan.data
        ? {
            id: plan.data.id,
            status: plan.data.status,
            summary: plan.data.summary,
            updatedAt: plan.data.updatedAt,
          }
        : null,
    risks: (risks.data ?? []).map((row) => ({
      id: row.id as string,
      severity: row.severity as string,
      description: row.description as string,
      mitigation: (row.mitigation as string | null) ?? null,
    })),
    verifications:
      verification.status === "ok"
        ? verification.data.map((row) => ({
            id: row.id,
            state: row.state,
            category: row.category,
            target: row.target,
          }))
        : [],
  };
}

async function markJobComplete(
  supabase: SupabaseClient,
  job: UnderworldShiftJob,
  input: {
    resultFingerprint: string;
    reviewSummary: string;
    evidence: UnderworldShiftJob["evidence"];
    at: string;
  },
  counters: ShiftRunnerTickResult,
): Promise<void> {
  const finished = await updateShiftJob(supabase, job.id, {
    status: "COMPLETE",
    resultFingerprint: input.resultFingerprint,
    reviewSummary: input.reviewSummary,
    evidence: input.evidence,
    leaseHolderId: null,
    leaseToken: null,
    leaseExpiresAt: null,
    completedAt: input.at,
  });
  if (finished.status === "ok") {
    counters.completed += 1;
    counters.detail.push(`Completed ${job.id.slice(0, 8)} without mutating project records.`);
    return;
  }
  if (/duplicate|unique/i.test(finished.message)) {
    // Same job already recorded this result (retry/restart). Treat as idempotent success.
    const existing = await loadShiftJobById(supabase, job.id);
    if (existing.status === "ok" && existing.data?.status === "COMPLETE") {
      counters.completed += 1;
      counters.detail.push(`Duplicate result suppressed for ${job.id.slice(0, 8)}.`);
      return;
    }
    counters.blocked += 1;
    counters.detail.push(
      `Blocked ${job.id.slice(0, 8)}: result fingerprint collision (${finished.message}).`,
    );
    await updateShiftJob(supabase, job.id, {
      status: "BLOCKED",
      blockReason: "Result fingerprint already recorded for another job.",
      leaseHolderId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    return;
  }
  counters.blocked += 1;
  await updateShiftJob(supabase, job.id, {
    status: "BLOCKED",
    blockReason: finished.message,
    leaseHolderId: null,
    leaseToken: null,
    leaseExpiresAt: null,
  });
  counters.detail.push(`Blocked ${job.id.slice(0, 8)}: ${finished.message}`);
}

async function advanceWorkingJob(
  supabase: SupabaseClient,
  input: {
    jobId: string;
    holderId: string;
    leaseToken: string;
    at: string;
    stopAfterStep?: boolean;
  },
  counters: ShiftRunnerTickResult,
): Promise<void> {
  const loaded = await loadShiftJobById(supabase, input.jobId);
  if (loaded.status !== "ok" || !loaded.data || loaded.data.status !== "WORKING") return;
  let job = loaded.data;

  const ensured = await ensureBoundAgentTask(supabase, job, input.at);
  if (!ensured.ok) {
    await updateShiftJob(supabase, job.id, {
      status: "BLOCKED",
      blockReason: ensured.message,
      leaseHolderId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    counters.blocked += 1;
    counters.detail.push(`Blocked ${job.id.slice(0, 8)}: ${ensured.message}`);
    return;
  }

  const reviewInput = await loadReviewInput(supabase, job.projectId, job.idempotencyKey);
  if (reviewInput.buildPlan && !job.buildPlanId) {
    await updateShiftJob(supabase, job.id, { buildPlanId: reviewInput.buildPlan.id });
    job = { ...job, buildPlanId: reviewInput.buildPlan.id };
  }

  // Agent already SUCCEEDED: finalize the shift job from the last review step without re-executing.
  if (ensured.agentAlreadySucceeded) {
    const finalStep = runBuildPlanReviewStep(reviewInput, Math.max(0, BUILD_PLAN_REVIEW_STEPS - 1));
    if (finalStep.done && finalStep.resultFingerprint) {
      await markJobComplete(
        supabase,
        job,
        {
          resultFingerprint: finalStep.resultFingerprint,
          reviewSummary: finalStep.summary || job.reviewSummary,
          evidence: finalStep.evidence.length ? finalStep.evidence : job.evidence,
          at: input.at,
        },
        counters,
      );
    } else {
      await updateShiftJob(supabase, job.id, {
        status: "BLOCKED",
        blockReason: "Agent task succeeded but review result could not be reconstructed.",
        leaseHolderId: null,
        leaseToken: null,
        leaseExpiresAt: null,
      });
      counters.blocked += 1;
    }
    return;
  }

  const auth = job.authorizationId
    ? await loadAuthorizationById(supabase as never, job.ownerId, job.authorizationId)
    : null;
  if (!auth || auth.status !== "ok" || !auth.data) {
    await updateShiftJob(supabase, job.id, {
      status: "BLOCKED",
      blockReason: "Founder authorization could not be loaded.",
      leaseHolderId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    counters.blocked += 1;
    return;
  }

  const taskLoad = await loadAgentTaskById(supabase as never, job.ownerId, ensured.taskId);
  if (taskLoad.status !== "ok" || !taskLoad.data) {
    await updateShiftJob(supabase, job.id, {
      status: "BLOCKED",
      blockReason: "Bound agent task missing.",
    });
    counters.blocked += 1;
    return;
  }
  let task = taskLoad.data;

  if (task.status === "QUEUED" || task.status === "BLOCKED") {
    // Recovery: BLOCKED → QUEUED so claim can proceed after a prior lease miss.
    if (task.status === "BLOCKED") {
      task = { ...task, status: "QUEUED", blockReason: "", updatedAt: input.at };
      await persistAgentTaskState(supabase as never, task);
    }
    const claimed = claimAgentTaskWithRevalidation(task, auth.data, {
      taskId: task.id,
      ownerId: job.ownerId,
      claimantId: input.holderId,
      leaseToken: input.leaseToken,
      at: input.at,
    });
    if (!claimed.ok) {
      await updateShiftJob(supabase, job.id, {
        status: "AWAITING_APPROVAL",
        blockReason: claimed.message,
        leaseHolderId: null,
        leaseToken: null,
        leaseExpiresAt: null,
      });
      counters.blocked += 1;
      counters.detail.push(`Job ${job.id.slice(0, 8)} needs approval: ${claimed.message}`);
      return;
    }
    task = claimed.task;
    await persistAgentTaskState(supabase as never, task);
  } else if (
    !isLeaseValid(task.lease, {
      holderId: input.holderId,
      token: input.leaseToken,
      at: input.at,
    })
  ) {
    // Same shift worker reattaches a deterministic lease after restart/retry.
    task = {
      ...task,
      lease: createLease({
        holderId: input.holderId,
        token: input.leaseToken,
        at: input.at,
      }),
      updatedAt: input.at,
    };
    await persistAgentTaskState(supabase as never, task);
  }

  // Drain remaining review steps in-process with the same lease (browser-closed safe).
  for (let guard = 0; guard < 4; guard += 1) {
    const step = runBuildPlanReviewStep(reviewInput, job.checkpointStep);
    const stepped = executeAgentTaskStepWithRevalidation(task, auth.data, {
      taskId: task.id,
      ownerId: job.ownerId,
      claimantId: input.holderId,
      leaseToken: input.leaseToken,
      stepIdempotencyKey: `uw-shift-${job.id}-step-${step.step}`,
      stepLabel: step.label,
      progressRef: `underworld-shift:${job.id}:${step.step}`,
      at: input.at,
    });
    if (!stepped.ok) {
      await updateShiftJob(supabase, job.id, {
        status: "BLOCKED",
        blockReason: stepped.message,
      });
      counters.blocked += 1;
      counters.detail.push(`Blocked ${job.id.slice(0, 8)}: ${stepped.message}`);
      return;
    }
    task = stepped.task;
    await persistAgentTaskState(supabase as never, task);
    if (stepped.checkpoint) {
      await insertAgentTaskCheckpoint(supabase as never, {
        ownerId: job.ownerId,
        taskId: task.id,
        checkpoint: stepped.checkpoint,
      });
    }

    job = {
      ...job,
      checkpointStep: step.step,
      checkpointLabel: step.label,
      reviewSummary: step.summary,
      evidence: step.evidence,
    };
    await updateShiftJob(supabase, job.id, {
      checkpointStep: step.step,
      checkpointLabel: step.label,
      reviewSummary: step.summary,
      evidence: step.evidence,
    });
    counters.advanced += 1;
    counters.detail.push(`Advanced ${job.id.slice(0, 8)} → ${step.label}`);

    if (step.done && step.resultFingerprint) {
      const artifact = createReviewArtifact({
        task,
        kind: "CHECKPOINT_SNAPSHOT",
        title: "Underworld build plan review",
        contentRef: step.summary.slice(0, 3900),
        at: input.at,
      });
      if (artifact.ok) {
        await supabase.from("agent_review_artifacts").insert({
          id: artifact.artifact.id,
          task_id: artifact.artifact.taskId,
          owner_id: artifact.artifact.ownerId,
          project_id: artifact.artifact.projectId,
          kind: artifact.artifact.kind,
          title: artifact.artifact.title,
          content_ref: artifact.artifact.contentRef,
          content_sha256: artifact.artifact.contentSha256,
          visibility: "FOUNDER_PRIVATE",
          publicly_published: false,
        });
      }

      const completed = completeAgentTaskWithRevalidation(task, auth.data, {
        ownerId: job.ownerId,
        claimantId: input.holderId,
        leaseToken: input.leaseToken,
        at: input.at,
      });
      if (completed.ok) {
        await persistAgentTaskState(supabase as never, completed.task);
      }

      await markJobComplete(
        supabase,
        job,
        {
          resultFingerprint: step.resultFingerprint,
          reviewSummary: step.summary,
          evidence: step.evidence,
          at: input.at,
        },
        counters,
      );
      return;
    }

    if (input.stopAfterStep) {
      // Leave WORKING with lease held; shift-end tick checkpoints at the safe boundary.
      counters.detail.push(
        `Paused ${job.id.slice(0, 8)} after step ${step.step} (${step.label}); awaiting shift end or next tick.`,
      );
      return;
    }
  }
}

/**
 * One server-side runner tick. Safe with the browser closed.
 * Refuses LIVE. Claims only inside the shift window (unless forced).
 */
export async function runUnderworldShiftTick(
  supabase: SupabaseClient,
  options: {
    at?: string;
    forceWithinShift?: boolean;
    holderId?: string;
    maxClaims?: number;
    /** When true, claim and advance one review step then return (shift-boundary tests). */
    stopAfterStep?: boolean;
  } = {},
): Promise<ShiftRunnerTickResult> {
  const detail: string[] = [];
  const result: ShiftRunnerTickResult = {
    withinShift: false,
    releasedApprovals: 0,
    claimed: 0,
    advanced: 0,
    checkpointed: 0,
    completed: 0,
    blocked: 0,
    detail,
  };

  if (isCodegenLiveEnabled()) {
    detail.push("Refused: LIVE=1.");
    return result;
  }

  const at = options.at ?? new Date().toISOString();
  const holderId = options.holderId ?? SHIFT_WORKER_ID;
  const withinShift = shouldClaimNewTasks({
    at,
    forceWithinShift: options.forceWithinShift,
  });
  result.withinShift = withinShift;

  result.releasedApprovals = await releaseApprovedJobs(supabase, detail);

  if (!withinShift) {
    // Safe boundary: do not claim or advance. Park unfinished work for next shift.
    const working = await supabase
      .from("underworld_shift_jobs")
      .select("id, lease_token, checkpoint_step, checkpoint_label")
      .eq("status", "WORKING")
      .eq("lease_holder_id", holderId)
      .limit(options.maxClaims ?? 5);
    for (const row of working.data ?? []) {
      if (!row.lease_token) continue;
      const cp = await checkpointShiftJobAtBoundary(supabase, {
        jobId: row.id as string,
        holderId,
        leaseToken: row.lease_token as string,
        checkpointStep: Number(row.checkpoint_step ?? 0),
        checkpointLabel: String(row.checkpoint_label ?? "shift-boundary"),
      });
      if (cp.status === "ok" && cp.data) {
        result.checkpointed += 1;
        detail.push(
          `Shift boundary checkpoint ${String(row.id).slice(0, 8)} at step ${row.checkpoint_step}; resume next shift.`,
        );
      }
    }
    detail.push("Outside shift window: no new claims.");
    return result;
  }

  const claimable = await listClaimableShiftJobs(supabase, options.maxClaims ?? 3);
  if (claimable.status !== "ok") {
    detail.push(claimable.message);
    return result;
  }

  const claimedIds = new Set<string>();
  for (const job of claimable.data) {
    const leaseToken = `uw-lease-${job.id}`;
    const claimed = await claimShiftJob(supabase, {
      jobId: job.id,
      holderId,
      leaseToken,
    });
    if (claimed.status !== "ok" || !claimed.data) continue;
    result.claimed += 1;
    claimedIds.add(job.id);
    detail.push(`Claimed ${job.id.slice(0, 8)}.`);
    await advanceWorkingJob(
      supabase,
      {
        jobId: job.id,
        holderId,
        leaseToken,
        at,
        stopAfterStep: options.stopAfterStep === true,
      },
      result,
    );
  }

  // Resume jobs already leased by this worker (e.g. after process restart inside a shift).
  if (options.stopAfterStep === true) {
    return result;
  }
  const leased = await supabase
    .from("underworld_shift_jobs")
    .select("id, lease_token")
    .eq("status", "WORKING")
    .eq("lease_holder_id", holderId)
    .limit(options.maxClaims ?? 3);
  for (const row of leased.data ?? []) {
    if (!row.lease_token || claimedIds.has(row.id as string)) continue;
    await advanceWorkingJob(
      supabase,
      {
        jobId: row.id as string,
        holderId,
        leaseToken: row.lease_token as string,
        at,
        stopAfterStep: false,
      },
      result,
    );
  }

  return result;
}
