"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { createNextAction } from "@/lib/operations/actions";
import { initializeBuildExecutionFromProject } from "./initialize";
import {
  addEvidence,
  createBlocker,
  createUpstreamChange,
  loadBuildExecution,
  loadBuildExecutionBundle,
  loadEvidence,
  recordBuildExecutionTransition,
  recomputeAndApplyPackageReadiness,
  resolveBlocker,
  resolveUpstreamChange,
  updatePackageExecution,
} from "./queries";
import {
  BUILD_EXECUTION_STATUSES,
  IMPLEMENTATION_EVIDENCE_KINDS,
  UPSTREAM_ARTIFACT_KINDS,
  UPSTREAM_CHANGE_STATUSES,
  type BuildExecution,
  type BuildExecutionStatus,
  type UpstreamArtifactKind,
  type UpstreamChangeStatus,
} from "./types";
import { canTransitionBuildExecution, evaluateExecutionBundle, suggestExecutionNextAction } from "./workflow";

type Session = Extract<Awaited<ReturnType<typeof getSession>>, { status: "authenticated" }>;

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readEnum<T extends string>(formData: FormData, name: string, allowed: readonly T[], fallback: T): T {
  const value = readField(formData, name);
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function revalidateExecution(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/execution`);
  revalidatePath(`/projects/${projectId}/build-plan`);
  revalidatePath("/dashboard");
}

async function authenticated(): Promise<Session | null> {
  const session = await getSession();
  return session.status === "authenticated" ? session : null;
}

const NOT_SIGNED_IN: ActionState = { error: "You are not signed in.", notice: null };

async function executionFor(
  session: Session,
  projectId: string,
): Promise<{ execution: BuildExecution } | { error: ActionState }> {
  const execution = await loadBuildExecution(session.supabase, projectId);
  if (execution.status === "error") return { error: { error: execution.message, notice: null } };
  if (!execution.data) return { error: { error: "Build Execution is not initialized for this project.", notice: null } };
  return { execution: execution.data };
}

export async function initializeBuildExecutionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const created = await initializeBuildExecutionFromProject(session.supabase, { projectId });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateExecution(projectId);
  redirect(`/projects/${projectId}/execution`);
}

export async function transitionBuildExecutionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const toStatus = readField(formData, "toStatus") as BuildExecutionStatus;
  if (!BUILD_EXECUTION_STATUSES.includes(toStatus)) {
    return { error: "Unknown build execution status.", notice: null };
  }
  const reason = readField(formData, "reason") || `Founder moved Build Execution to ${toStatus}.`;

  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;
  if (!canTransitionBuildExecution(target.execution.status, toStatus)) {
    return {
      error: `Cannot move Build Execution from ${target.execution.status} to ${toStatus}.`,
      notice: null,
    };
  }

  if (toStatus === "IMPLEMENTED") {
    const bundle = await loadBuildExecutionBundle(session.supabase, target.execution);
    if (bundle.status === "error") return { error: bundle.message, notice: null };
    const { blockers } = evaluateExecutionBundle(bundle.data);
    if (blockers.length > 0) {
      return {
        error: `Not IMPLEMENTED (${blockers.length} blocker${blockers.length === 1 ? "" : "s"}). ${blockers[0].message}`,
        notice: null,
      };
    }
  }

  const transitioned = await recordBuildExecutionTransition(
    session.supabase,
    target.execution.id,
    toStatus,
    reason,
  );
  if (transitioned.status === "error") return { error: transitioned.message, notice: null };
  revalidateExecution(projectId);
  return {
    error: null,
    notice:
      toStatus === "IMPLEMENTED"
        ? "Build Execution is IMPLEMENTED. This means evidence-backed implementation only — not verified or deployed."
        : `Build Execution is now ${toStatus}.`,
  };
}

export async function startPackageExecutionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const packageExecutionId = readField(formData, "packageExecutionId");
  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;

  const updated = await updatePackageExecution(session.supabase, packageExecutionId, {
    status: "IN_PROGRESS",
    startedAt: new Date().toISOString(),
    startedBy: session.user.id,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };

  if (target.execution.status === "NOT_STARTED") {
    const transitioned = await recordBuildExecutionTransition(
      session.supabase,
      target.execution.id,
      "EXECUTING",
      "Founder started a work package; execution moved to EXECUTING.",
    );
    if (transitioned.status === "error") return { error: transitioned.message, notice: null };
  }

  revalidateExecution(projectId);
  return { error: null, notice: "Package execution started (IN_PROGRESS). Not implemented yet." };
}

export async function markPackageImplementedAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const packageExecutionId = readField(formData, "packageExecutionId");
  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;

  const evidence = await loadEvidence(session.supabase, target.execution.id);
  if (evidence.status === "error") return { error: evidence.message, notice: null };
  const evidenceCount = evidence.data.filter((row) => row.packageExecutionId === packageExecutionId).length;

  const updated = await updatePackageExecution(
    session.supabase,
    packageExecutionId,
    {
      status: "IMPLEMENTED",
      completedAt: new Date().toISOString(),
      completedBy: session.user.id,
      implementationNotes: readField(formData, "notes") || undefined,
    },
    { evidenceCount },
  );
  if (updated.status === "error") return { error: updated.message, notice: null };

  await recomputeAndApplyPackageReadiness(session.supabase, target.execution);

  revalidateExecution(projectId);
  return {
    error: null,
    notice: "Package marked IMPLEMENTED with evidence. Sibling readiness recomputed. Not verified or deployed.",
  };
}

export async function addEvidenceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;

  const created = await addEvidence(session.supabase, {
    packageExecutionId: readField(formData, "packageExecutionId"),
    executionId: target.execution.id,
    projectId,
    kind: readEnum(formData, "kind", IMPLEMENTATION_EVIDENCE_KINDS, "COMMIT"),
    reference: readField(formData, "reference"),
    summary: readField(formData, "summary"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateExecution(projectId);
  return { error: null, notice: "Implementation evidence recorded (reference only — no secret values)." };
}

export async function createExecutionBlockerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const packageExecutionId = readField(formData, "packageExecutionId");
  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;

  const created = await createBlocker(session.supabase, {
    packageExecutionId,
    executionId: target.execution.id,
    projectId,
    description: readField(formData, "description"),
  });
  if (created.status === "error") return { error: created.message, notice: null };

  const current = await session.supabase
    .from("work_package_executions")
    .select("status")
    .eq("id", packageExecutionId)
    .single();
  if (!current.error && current.data.status !== "BLOCKED") {
    const blocked = await updatePackageExecution(session.supabase, packageExecutionId, { status: "BLOCKED" });
    if (blocked.status === "error") return { error: blocked.message, notice: null };
  }
  revalidateExecution(projectId);
  return { error: null, notice: "Execution blocker recorded; package marked BLOCKED." };
}

export async function resolveExecutionBlockerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;

  const resolved = await resolveBlocker(
    session.supabase,
    readField(formData, "blockerId"),
    readField(formData, "resolution"),
  );
  if (resolved.status === "error") return { error: resolved.message, notice: null };

  const remaining = await session.supabase
    .from("execution_blockers")
    .select("id", { count: "exact", head: true })
    .eq("package_execution_id", resolved.data.packageExecutionId)
    .eq("status", "OPEN");
  if ((remaining.count ?? 0) === 0) {
    // Move BLOCKED → QUEUED so readiness recompute can promote to READY when deps allow.
    await updatePackageExecution(session.supabase, resolved.data.packageExecutionId, { status: "QUEUED" });
  }
  await recomputeAndApplyPackageReadiness(session.supabase, target.execution);
  revalidateExecution(projectId);
  return { error: null, notice: "Blocker resolved; package readiness recomputed." };
}

export async function createUpstreamChangeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;

  const created = await createUpstreamChange(session.supabase, {
    executionId: target.execution.id,
    projectId,
    packageExecutionId: readField(formData, "packageExecutionId") || null,
    artifactKind: readEnum(formData, "artifactKind", UPSTREAM_ARTIFACT_KINDS, "OTHER") as UpstreamArtifactKind,
    artifactRef: readField(formData, "artifactRef"),
    issue: readField(formData, "issue"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  await recomputeAndApplyPackageReadiness(session.supabase, target.execution);
  revalidateExecution(projectId);
  return {
    error: null,
    notice: "Upstream change recorded. V6–V8 records were not silently mutated.",
  };
}

export async function resolveUpstreamChangeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;

  const status = readEnum(formData, "status", UPSTREAM_CHANGE_STATUSES, "RESOLVED") as UpstreamChangeStatus;
  const resolved = await resolveUpstreamChange(
    session.supabase,
    readField(formData, "changeId"),
    readField(formData, "resolution"),
    status === "OPEN" ? "RESOLVED" : status,
  );
  if (resolved.status === "error") return { error: resolved.message, notice: null };
  await recomputeAndApplyPackageReadiness(session.supabase, target.execution);
  revalidateExecution(projectId);
  return { error: null, notice: "Upstream change resolved; readiness recomputed." };
}

export async function escalateExecutionDecisionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;
  const question = readField(formData, "question");
  const inserted = await session.supabase
    .from("project_decisions")
    .insert({
      project_id: projectId,
      build_execution_id: target.execution.id,
      title: readField(formData, "title") || question.slice(0, 120),
      question,
      context: "Escalated from Build Execution.",
      options: [
        readField(formData, "optionA") ? { id: "a", label: readField(formData, "optionA") } : null,
        readField(formData, "optionB") ? { id: "b", label: readField(formData, "optionB") } : null,
      ].filter(Boolean),
      recommendation: readField(formData, "recommendation") || null,
      evidence: [{ type: "build_execution", id: target.execution.id, title: question.slice(0, 80) }],
      created_by: session.user.id,
      status: "OPEN",
    })
    .select("id")
    .single();
  if (inserted.error) return { error: inserted.error.message, notice: null };
  revalidateExecution(projectId);
  return { error: null, notice: "Execution decision escalated to Needs Your Decision." };
}

export async function syncExecutionNextActionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;
  const bundle = await loadBuildExecutionBundle(session.supabase, target.execution);
  if (bundle.status === "error") return { error: bundle.message, notice: null };
  const { completion } = evaluateExecutionBundle(bundle.data);
  const suggestion = suggestExecutionNextAction({
    completion,
    executionStatus: bundle.data.execution.status,
    packageExecutions: bundle.data.packageExecutions,
  });
  if (!suggestion) {
    return { error: null, notice: "No Build Execution next action is justified by current records." };
  }
  const created = await createNextAction(session.supabase, {
    projectId,
    title: suggestion.title,
    description: suggestion.description,
    provenance: "FOUNDER_APPROVED_ACTION",
    sourceKind: suggestion.sourceKind,
    sourceRef: target.execution.id,
    priority: "HIGH",
    requiresDecision: /decision/i.test(suggestion.title),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateExecution(projectId);
  return { error: null, notice: `Next action recorded: ${created.data.title}` };
}

export async function refreshPackageReadinessAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await executionFor(session, projectId);
  if ("error" in target) return target.error;
  const refreshed = await recomputeAndApplyPackageReadiness(session.supabase, target.execution);
  if (refreshed.status === "error") return { error: refreshed.message, notice: null };
  revalidateExecution(projectId);
  return { error: null, notice: "Package readiness recomputed (QUEUED↔READY only)." };
}
