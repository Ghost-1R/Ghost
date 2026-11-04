"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { loadProjectSummaries } from "@/lib/projects/queries";
import { executeDurableCodegenMockPipeline } from "@/lib/codegen/durable-execution";
import { executeDurableCodegenLivePipeline } from "@/lib/codegen/durable-live-execution";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import {
  buildCodegenTaskContract,
  encodeCodegenScopeFragment,
  isCodegenPilotScope,
  parseCodingOptionValue,
} from "@/lib/codegen/request-contract";
import { reviewDurableDevelopmentDeliverable } from "./durable-review";
import {
  approveDurableDevelopmentRequest,
  createDurableDevelopmentRequest,
  loadDurableDevelopmentBundle,
  queueDurableDevelopmentTask,
} from "./durable-workflow";
import { MEMORY_PERSISTENCE_MODE, memoryListTasks } from "./memory-store";
import type { FounderDeliverableDecision } from "./types";
import {
  approveDevelopmentRequest,
  cancelSimulatedExecution,
  loadMemoryWorkflowSession,
  queueDevelopmentTask,
  reviewSimulatedOutcome,
  runSimulatedExecution,
  verifySimulatedEvidence,
} from "./workflow";

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function revalidateWorkflow(projectId?: string) {
  revalidatePath("/development-tasks");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

/**
 * Founder development request — durable Approval Center + remote_development_tasks.
 * Never falls back to MEMORY_TEST_ONLY. Missing schema fails closed.
 * Does not dispatch real remote work. Workers remain disabled.
 */
export async function submitDevelopmentRequest(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const projectId = readField(formData, "projectId");
  const projects = await loadProjectSummaries(session.supabase);
  const projectList = projects.status === "ok" ? projects.data : [];
  const project = projectList.find((p) => p.id === projectId);
  if (!project) {
    return { error: "Select a project you own.", notice: null };
  }

  const maxCost = Number(readField(formData, "maxEstimatedCostUsd") || "0");
  const maxDurationHours = Number(readField(formData, "maxDurationHours") || "1");
  const maxDurationMs = maxDurationHours * 60 * 60 * 1000;
  const requestKind = readField(formData, "requestKind") || "REMOTE_DEV";
  const liveDispatchRequested = readField(formData, "liveDispatch") === "1";

  // Live provider dispatch stays off — form tampering cannot enable spend.
  if (liveDispatchRequested) {
    return {
      error:
        "Live codegen dispatch is disabled. Uncheck live dispatch / wait for separate founder authorization and HTTP adapter implementation.",
      notice: null,
    };
  }

  let codegenScopeFragment: string | undefined;
  let objective = readField(formData, "objective");
  let environmentLabel = readField(formData, "environmentLabel") || "REMOTE_DEV";
  let effectiveMaxCost = maxCost;

  if (requestKind === "CODEGEN_PILOT_03") {
    const option = parseCodingOptionValue(readField(formData, "codingProviderModel"));
    if (!option.ok) return { error: option.message, notice: null };
    const classificationRaw = readField(formData, "classification") || "PUBLIC";
    if (
      classificationRaw !== "PUBLIC" &&
      classificationRaw !== "INTERNAL" &&
      classificationRaw !== "CONFIDENTIAL" &&
      classificationRaw !== "RESTRICTED"
    ) {
      return { error: "Invalid data classification.", notice: null };
    }
    const contract = buildCodegenTaskContract({
      providerId: option.providerId,
      model: option.model,
      classification: classificationRaw,
      objective,
      maxSpendUsd: maxCost,
    });
    if (!contract.ok) return { error: contract.message, notice: null };
    if (contract.contract.dispatch !== "DISABLED" && contract.contract.dispatch !== "MOCK_ONLY") {
      return { error: "Live dispatch is not permitted for this request.", notice: null };
    }
    codegenScopeFragment = encodeCodegenScopeFragment(contract.contract);
    objective = contract.contract.objective;
    environmentLabel = environmentLabel || "LOCAL_PILOT_03";
    effectiveMaxCost = Math.min(maxCost, contract.contract.maxSpendCents / 100);
  }

  const created = await createDurableDevelopmentRequest(session.supabase, {
    ownerId: session.user.id,
    projectId: project.id,
    projectName: project.name,
    objective,
    repository: readField(formData, "repository"),
    approvedBaseBranch: readField(formData, "approvedBaseBranch"),
    environmentLabel,
    maxEstimatedCostUsd: effectiveMaxCost,
    maxDurationMs,
    requirements: readField(formData, "requirements"),
    evidenceSource: readField(formData, "evidenceSource") || undefined,
    evidenceReference: readField(formData, "evidenceReference") || undefined,
    idempotencyKey: readField(formData, "idempotencyKey") || undefined,
    requestKind: requestKind === "CODEGEN_PILOT_03" ? "CODEGEN_PILOT_03" : "REMOTE_DEV",
    codegenScopeFragment,
  });

  if (!created.ok) {
    return { error: created.message, notice: null };
  }

  revalidateWorkflow(projectId);
  return {
    error: null,
    notice:
      requestKind === "CODEGEN_PILOT_03"
        ? "Pilot 03 codegen request recorded (PENDING). Provider/model bound into ONE_TIME fingerprint. Live dispatch disabled. No API calls. No deployment. Approve in Approval Center when ready."
        : "Durable development request recorded in Founder Approval Center (PENDING). Approve there, then queue. No external task dispatched. Workers disabled.",
  };
}

export async function approveDevelopmentWorkflow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const taskId = readField(formData, "taskId");

  const durable = await loadDurableDevelopmentBundle(session.supabase, session.user.id, taskId);
  if (durable.ok) {
    const result = await approveDurableDevelopmentRequest(session.supabase, {
      ownerId: session.user.id,
      remoteTaskId: taskId,
      actorId: session.user.id,
    });
    if (!result.ok) return { error: result.message, notice: null };
    revalidateWorkflow(result.data.remote.projectId);
    return {
      error: null,
      notice:
        "Durable DEVELOPMENT authorization approved in Approval Center. Approval does not execute. Queue still revalidates.",
    };
  }
  if (durable.reason !== "NOT_FOUND") {
    // Missing schema / auth must fail closed — never fall back to memory approval.
    return { error: durable.message, notice: null };
  }

  // MEMORY_TEST_ONLY simulation sessions only (unit/demo), never a durable fallback.
  const current = loadMemoryWorkflowSession(taskId);
  if (!current || current.task.ownerId !== session.user.id) {
    return { error: "That development task is not visible.", notice: null };
  }
  const result = approveDevelopmentRequest(current, session.user.id);
  if (!result.ok) return { error: result.message, notice: null };
  revalidateWorkflow(current.task.projectId);
  return {
    error: null,
    notice: `MEMORY_TEST_ONLY approval recorded (${MEMORY_PERSISTENCE_MODE}). Not durable. Queue still revalidates.`,
  };
}

/**
 * Pilot 03 MOCK codegen execution after durable queue.
 * SQL allowance + materialize + restricted Docker. Live OpenAI stays off.
 */
export async function executeDurableCodegenWorkflow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const taskId = readField(formData, "taskId");
  const durable = await loadDurableDevelopmentBundle(session.supabase, session.user.id, taskId);
  if (!durable.ok) {
    return { error: durable.message, notice: null };
  }
  if (!isCodegenPilotScope(durable.data.remote.binding.actionScope)) {
    return { error: "This action is only for Pilot 03 codegen tasks.", notice: null };
  }
  if (readField(formData, "liveDispatch") === "1") {
    return {
      error: "Live provider dispatch is disabled on this path. Use the separate LIVE entrypoint.",
      notice: null,
    };
  }

  const result = await executeDurableCodegenMockPipeline(session.supabase, {
    ownerId: session.user.id,
    remoteTaskId: taskId,
  });
  if (!result.ok) {
    revalidateWorkflow(durable.data.remote.projectId);
    return { error: `${result.reason}: ${result.message}`, notice: null };
  }

  revalidateWorkflow(result.task.projectId);
  return {
    error: null,
    notice: result.idempotentReplay
      ? "Idempotent MOCK codegen replay — still AWAITING_FOUNDER_REVIEW. No live API call."
      : `MOCK codegen complete (dockerPassed=${result.dockerPassed}, realDocker=${result.realContainerExecution}). Founder review required. Charged $${(result.chargedCents / 100).toFixed(2)}. Live HTTP: 0.`,
  };
}

/**
 * Separate Pilot 03 LIVE OpenAI entrypoint — requires GHOST_CODEGEN_LIVE_ENABLED=1,
 * exact founder scope (openai/gpt-5-mini/PUBLIC/$1), SQL allowance, one-time dispatch.
 * Default env keeps this disabled. Never auto-accepts. Never deploys.
 */
export async function executeDurableCodegenLiveWorkflow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  if (!isCodegenLiveEnabled()) {
    return {
      error: "LIVE disabled: GHOST_CODEGEN_LIVE_ENABLED is not 1. No provider call.",
      notice: null,
    };
  }
  if (readField(formData, "confirmLive") !== "LIVE_OPENAI_GPT5MINI_USD1") {
    return {
      error: "Live confirmation token missing. Refusing LIVE dispatch.",
      notice: null,
    };
  }
  const taskId = readField(formData, "taskId");
  const durable = await loadDurableDevelopmentBundle(session.supabase, session.user.id, taskId);
  if (!durable.ok) {
    return { error: durable.message, notice: null };
  }
  if (!isCodegenPilotScope(durable.data.remote.binding.actionScope)) {
    return { error: "This action is only for Pilot 03 codegen tasks.", notice: null };
  }

  const result = await executeDurableCodegenLivePipeline(session.supabase, {
    ownerId: session.user.id,
    remoteTaskId: taskId,
  });
  if (!result.ok) {
    revalidateWorkflow(durable.data.remote.projectId);
    const preserved = result.reservationPreserved ? " Reservation preserved (uncertain billing)." : "";
    return { error: `${result.reason}: ${result.message}${preserved}`, notice: null };
  }

  revalidateWorkflow(result.task.projectId);
  return {
    error: null,
    notice: result.idempotentReplay
      ? "Idempotent LIVE codegen replay — still AWAITING_FOUNDER_REVIEW."
      : `LIVE codegen complete (mode=LIVE_PROVIDER, charged $${(result.chargedCents / 100).toFixed(2)}, dockerPassed=${result.dockerPassed}). Founder review required. No deployment.`,
  };
}

export async function queueDevelopmentWorkflow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const taskId = readField(formData, "taskId");

  const durable = await loadDurableDevelopmentBundle(session.supabase, session.user.id, taskId);
  if (durable.ok) {
    const result = await queueDurableDevelopmentTask(session.supabase, {
      ownerId: session.user.id,
      remoteTaskId: taskId,
    });
    if (!result.ok) return { error: result.message, notice: null };
    revalidateWorkflow(result.data.remote.projectId);
    return {
      error: null,
      notice:
        "Durable task queued after authorization revalidation and agent_tasks bind. Workers not activated. No external dispatch.",
    };
  }
  if (durable.reason !== "NOT_FOUND") {
    return { error: durable.message, notice: null };
  }

  const current = loadMemoryWorkflowSession(taskId);
  if (!current || current.task.ownerId !== session.user.id) {
    return { error: "That development task is not visible.", notice: null };
  }
  const result = queueDevelopmentTask(current);
  if (!result.ok) return { error: result.message, notice: null };
  revalidateWorkflow(current.task.projectId);
  return {
    error: null,
    notice: `MEMORY_TEST_ONLY queue (${MEMORY_PERSISTENCE_MODE}). Ready for SIMULATED execution only.`,
  };
}

export async function runSimulatedDevelopmentWorkflow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const taskId = readField(formData, "taskId");
  const current = loadMemoryWorkflowSession(taskId);
  if (!current || current.task.ownerId !== session.user.id) {
    return {
      error:
        "SIMULATED execution is available only for MEMORY_TEST_ONLY sessions. Durable queued tasks do not auto-dispatch.",
      notice: null,
    };
  }
  const result = runSimulatedExecution(current);
  if (!result.ok) return { error: result.message, notice: null };
  revalidateWorkflow(current.task.projectId);
  return {
    error: null,
    notice:
      "SIMULATED execution completed via FakeRemoteExecutionProvider. Not live. Not Project Truth verified.",
  };
}

export async function cancelDevelopmentWorkflow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const taskId = readField(formData, "taskId");
  const current = loadMemoryWorkflowSession(taskId);
  if (!current || current.task.ownerId !== session.user.id) {
    return { error: "That development task is not visible for SIMULATED cancel.", notice: null };
  }
  const result = cancelSimulatedExecution(current);
  if (!result.ok) return { error: result.message, notice: null };
  revalidateWorkflow(current.task.projectId);
  return { error: null, notice: "Task cancelled (SIMULATED path)." };
}

export async function verifyDevelopmentEvidenceWorkflow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const taskId = readField(formData, "taskId");
  const current = loadMemoryWorkflowSession(taskId);
  if (!current || current.task.ownerId !== session.user.id) {
    return { error: "That development task is not visible for SIMULATED verify.", notice: null };
  }
  const result = verifySimulatedEvidence(current, session.user.id);
  if (!result.ok) return { error: result.message, notice: null };
  revalidateWorkflow(current.task.projectId);
  return {
    error: null,
    notice:
      "Independent SIMULATED evidence check recorded. Accept still required separately. Project Truth VERIFIED_* not set.",
  };
}

export async function reviewDevelopmentWorkflow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const taskId = readField(formData, "taskId");
  const decision = readField(formData, "decision");
  if (decision !== "ACCEPT" && decision !== "REJECT") {
    return { error: "Review decision must be ACCEPT or REJECT.", notice: null };
  }
  const current = loadMemoryWorkflowSession(taskId);
  if (!current || current.task.ownerId !== session.user.id) {
    return { error: "That development task is not visible for SIMULATED review.", notice: null };
  }
  const result = reviewSimulatedOutcome(current, decision, session.user.id);
  if (!result.ok) return { error: result.message, notice: null };
  revalidateWorkflow(current.task.projectId);
  return {
    error: null,
    notice:
      decision === "ACCEPT"
        ? "Founder accepted SIMULATED review evidence. Project Truth VERIFIED_* not set."
        : "Founder rejected SIMULATED outcome.",
  };
}

/**
 * Durable founder deliverable review — DATABASE path only.
 * ACCEPT / REJECT / REQUEST_CHANGES. Authenticated owner. No deployment. No auth reuse.
 */
export async function reviewDurableDevelopmentWorkflow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const taskId = readField(formData, "taskId");
  const decisionRaw = readField(formData, "decision");
  const note = readField(formData, "note");
  const idempotencyKey =
    readField(formData, "idempotencyKey") || `durable-review-${taskId}-${decisionRaw}-${Date.now()}`;

  if (
    decisionRaw !== "ACCEPT" &&
    decisionRaw !== "REJECT" &&
    decisionRaw !== "REQUEST_CHANGES"
  ) {
    return { error: "Decision must be ACCEPT, REJECT, or REQUEST_CHANGES.", notice: null };
  }
  const decision = decisionRaw as FounderDeliverableDecision;

  const durable = await loadDurableDevelopmentBundle(session.supabase, session.user.id, taskId);
  if (!durable.ok) {
    return { error: durable.message, notice: null };
  }

  const result = await reviewDurableDevelopmentDeliverable(session.supabase, {
    ownerId: session.user.id,
    remoteTaskId: taskId,
    decision,
    note,
    idempotencyKey,
  });
  if (!result.ok) {
    return { error: `${result.reason}: ${result.message}`, notice: null };
  }

  revalidateWorkflow(result.task.projectId);
  const idempotentNote = result.idempotent ? " (idempotent replay)" : "";
  return {
    error: null,
    notice: `Durable founder review recorded: ${result.decision} → ${result.resultingStatus}.${idempotentNote} No deployment. Authorization not reused.`,
  };
}

/** Helper for page load — memory tasks for authenticated owner (simulation only). */
export async function listMemoryDevelopmentTasksForOwner(ownerId: string) {
  return memoryListTasks(ownerId, 50);
}
