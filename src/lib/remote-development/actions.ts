"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { loadProjectSummaries } from "@/lib/projects/queries";
import {
  approveDevelopmentRequest,
  cancelSimulatedExecution,
  createDevelopmentRequest,
  loadMemoryWorkflowSession,
  queueDevelopmentTask,
  reviewSimulatedOutcome,
  runSimulatedExecution,
  verifySimulatedEvidence,
} from "./workflow";
import { memoryListTasks, MEMORY_PERSISTENCE_MODE } from "./memory-store";

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
 * Founder development request — persists via MEMORY_TEST_ONLY adapter in this cloud env.
 * Does not write hosted Supabase. Does not dispatch real remote work.
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

  const created = createDevelopmentRequest({
    ownerId: session.user.id,
    projectId: project.id,
    projectName: project.name,
    objective: readField(formData, "objective"),
    repository: readField(formData, "repository"),
    approvedBaseBranch: readField(formData, "approvedBaseBranch"),
    environmentLabel: readField(formData, "environmentLabel") || "REMOTE_DEV",
    maxEstimatedCostUsd: maxCost,
    maxDurationMs,
    requirements: readField(formData, "requirements"),
    evidenceSource: readField(formData, "evidenceSource") || undefined,
    evidenceReference: readField(formData, "evidenceReference") || undefined,
    idempotencyKey: readField(formData, "idempotencyKey") || undefined,
  });

  if (!created.ok) {
    return { error: created.message, notice: null };
  }

  revalidateWorkflow(projectId);
  return {
    error: null,
    notice: `Development request recorded (${MEMORY_PERSISTENCE_MODE}). Authorization is PENDING — approve in Approval Center or use Approve on this page. No external task dispatched.`,
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
  const current = loadMemoryWorkflowSession(taskId);
  if (!current || current.task.ownerId !== session.user.id) {
    return { error: "That development task is not visible.", notice: null };
  }
  const result = approveDevelopmentRequest(current, session.user.id);
  if (!result.ok) return { error: result.message, notice: null };
  revalidateWorkflow(current.task.projectId);
  return {
    error: null,
    notice: "DEVELOPMENT authorization approved. Approval does not execute. Queue still revalidates.",
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
  const current = loadMemoryWorkflowSession(taskId);
  if (!current || current.task.ownerId !== session.user.id) {
    return { error: "That development task is not visible.", notice: null };
  }
  const result = queueDevelopmentTask(current);
  if (!result.ok) return { error: result.message, notice: null };
  revalidateWorkflow(current.task.projectId);
  return {
    error: null,
    notice: "Task queued after authorization revalidation. Ready for SIMULATED execution only.",
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
    return { error: "That development task is not visible.", notice: null };
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
    return { error: "That development task is not visible.", notice: null };
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
    return { error: "That development task is not visible.", notice: null };
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
    return { error: "That development task is not visible.", notice: null };
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

/** Helper for page load — memory tasks for authenticated owner. */
export async function listMemoryDevelopmentTasksForOwner(ownerId: string) {
  return memoryListTasks(ownerId, 50);
}
