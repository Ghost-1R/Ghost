"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { createNextAction } from "@/lib/operations/actions";
import { initializeVerificationFromProject } from "./initialize";
import {
  addVerificationEvidence,
  createVerificationDefect,
  loadVerificationBundle,
  loadVerificationCases,
  loadVerificationEvidence,
  loadVerificationProgram,
  recordRetestEvent,
  recordVerificationProgramTransition,
  resolveVerificationDefect,
  updateVerificationCase,
} from "./queries";
import {
  VERIFICATION_CASE_STATUSES,
  VERIFICATION_EVIDENCE_KINDS,
  VERIFICATION_PROGRAM_STATUSES,
  type VerificationCaseStatus,
  type VerificationProgram,
  type VerificationProgramStatus,
} from "./types";
import {
  canTransitionVerificationProgram,
  evaluateVerificationBundle,
  suggestVerificationNextAction,
} from "./workflow";

type Session = Extract<Awaited<ReturnType<typeof getSession>>, { status: "authenticated" }>;

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readEnum<T extends string>(formData: FormData, name: string, allowed: readonly T[], fallback: T): T {
  const value = readField(formData, name);
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function revalidateVerification(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/verification`);
  revalidatePath(`/projects/${projectId}/execution`);
  revalidatePath("/dashboard");
}

async function authenticated(): Promise<Session | null> {
  const session = await getSession();
  return session.status === "authenticated" ? session : null;
}

const NOT_SIGNED_IN: ActionState = { error: "You are not signed in.", notice: null };

async function programFor(
  session: Session,
  projectId: string,
): Promise<{ program: VerificationProgram } | { error: ActionState }> {
  const program = await loadVerificationProgram(session.supabase, projectId);
  if (program.status === "error") return { error: { error: program.message, notice: null } };
  if (!program.data) return { error: { error: "Verification is not initialized for this project.", notice: null } };
  return { program: program.data };
}

export async function initializeVerificationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const created = await initializeVerificationFromProject(session.supabase, { projectId });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateVerification(projectId);
  redirect(`/projects/${projectId}/verification`);
}

export async function transitionVerificationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const toStatus = readField(formData, "toStatus") as VerificationProgramStatus;
  if (!VERIFICATION_PROGRAM_STATUSES.includes(toStatus)) {
    return { error: "Unknown verification program status.", notice: null };
  }
  const reason = readField(formData, "reason") || `Founder moved Verification to ${toStatus}.`;

  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;
  if (!canTransitionVerificationProgram(target.program.status, toStatus)) {
    return {
      error: `Cannot move Verification from ${target.program.status} to ${toStatus}.`,
      notice: null,
    };
  }

  if (toStatus === "VERIFIED") {
    const bundle = await loadVerificationBundle(session.supabase, target.program);
    if (bundle.status === "error") return { error: bundle.message, notice: null };
    const { gaps } = evaluateVerificationBundle(bundle.data);
    if (gaps.length > 0) {
      return {
        error: `Not VERIFIED (${gaps.length} gap${gaps.length === 1 ? "" : "s"}). ${gaps[0].message}`,
        notice: null,
      };
    }
  }

  const transitioned = await recordVerificationProgramTransition(
    session.supabase,
    target.program.id,
    toStatus,
    reason,
  );
  if (transitioned.status === "error") return { error: transitioned.message, notice: null };
  revalidateVerification(projectId);
  return {
    error: null,
    notice:
      toStatus === "VERIFIED"
        ? "Verification is VERIFIED. This means the verification gate passed — not deployed."
        : `Verification is now ${toStatus}.`,
  };
}

export async function startVerificationCaseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const caseId = readField(formData, "caseId");
  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;

  const updated = await updateVerificationCase(session.supabase, caseId, {
    status: "RUNNING",
    startedAt: new Date().toISOString(),
  });
  if (updated.status === "error") return { error: updated.message, notice: null };

  if (target.program.status === "NOT_STARTED") {
    const transitioned = await recordVerificationProgramTransition(
      session.supabase,
      target.program.id,
      "TESTING",
      "Founder started a verification case; program moved to TESTING.",
    );
    if (transitioned.status === "error") return { error: transitioned.message, notice: null };
  }

  revalidateVerification(projectId);
  return { error: null, notice: "Verification case started (RUNNING). Not passed yet." };
}

export async function passVerificationCaseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const caseId = readField(formData, "caseId");
  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;

  const evidence = await loadVerificationEvidence(session.supabase, target.program.id);
  if (evidence.status === "error") return { error: evidence.message, notice: null };
  const evidenceCount = evidence.data.filter((row) => row.caseId === caseId).length;

  const updated = await updateVerificationCase(
    session.supabase,
    caseId,
    {
      status: "PASSED",
      actualResult: readField(formData, "actualResult") || "Passed with recorded evidence.",
      completedAt: new Date().toISOString(),
    },
    { evidenceCount },
  );
  if (updated.status === "error") return { error: updated.message, notice: null };

  revalidateVerification(projectId);
  return {
    error: null,
    notice: "Case marked PASSED with evidence. VERIFIED is not deployed.",
  };
}

export async function failVerificationCaseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const caseId = readField(formData, "caseId");
  const actualResult = readField(formData, "actualResult");
  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;

  const cases = await loadVerificationCases(session.supabase, target.program.id);
  if (cases.status === "error") return { error: cases.message, notice: null };
  const current = cases.data.find((row) => row.id === caseId);
  if (!current) return { error: "Verification case not found.", notice: null };

  const updated = await updateVerificationCase(session.supabase, caseId, {
    status: "FAILED",
    actualResult: actualResult || "Failed — see defect.",
    completedAt: new Date().toISOString(),
  });
  if (updated.status === "error") return { error: updated.message, notice: null };

  const defectTitle = readField(formData, "defectTitle") || `Failure: ${current.humanId} ${current.title}`;
  const defect = await createVerificationDefect(session.supabase, {
    programId: target.program.id,
    projectId,
    caseId,
    title: defectTitle.slice(0, 200),
    description: actualResult || current.actualResult || defectTitle,
    severity: "HIGH",
    blocking: true,
    packageExecutionId: current.packageExecutionId,
    requirementId: current.requirementId,
    featureId: current.featureId,
    createUpstreamChange: readField(formData, "createUpstreamChange") === "1",
    buildExecutionId: target.program.buildExecutionId,
  });
  if (defect.status === "error") return { error: defect.message, notice: null };

  await createNextAction(session.supabase, {
    projectId,
    title: "Correct verification failure",
    description: `${defect.data.humanId} from ${current.humanId}: ${defect.data.title}. Fix implementation, then resolve and retest.`,
    provenance: "FOUNDER_APPROVED_ACTION",
    sourceKind: "verification",
    sourceRef: defect.data.id,
    priority: "HIGH",
  });

  revalidateVerification(projectId);
  return {
    error: null,
    notice: `Case FAILED. Defect ${defect.data.humanId} recorded (HIGH, blocking). Correct before VERIFIED.`,
  };
}

export async function markCaseNotApplicableAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const caseId = readField(formData, "caseId");
  const reason = readField(formData, "reason");
  if (!reason) return { error: "A reason is required to mark NOT_APPLICABLE.", notice: null };
  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;

  const updated = await updateVerificationCase(session.supabase, caseId, {
    status: "NOT_APPLICABLE",
    actualResult: reason,
    completedAt: new Date().toISOString(),
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateVerification(projectId);
  return { error: null, notice: "Case marked NOT_APPLICABLE with reason." };
}

export async function addVerificationEvidenceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;

  const created = await addVerificationEvidence(session.supabase, {
    caseId: readField(formData, "caseId"),
    programId: target.program.id,
    projectId,
    kind: readEnum(formData, "kind", VERIFICATION_EVIDENCE_KINDS, "MANUAL_OBSERVATION"),
    reference: readField(formData, "reference"),
    summary: readField(formData, "summary"),
    isAutomated: readField(formData, "isAutomated") === "1",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateVerification(projectId);
  return { error: null, notice: "Verification evidence recorded (reference only — no secret values)." };
}

export async function createVerificationDefectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;

  const created = await createVerificationDefect(session.supabase, {
    programId: target.program.id,
    projectId,
    caseId: readField(formData, "caseId"),
    title: readField(formData, "title"),
    description: readField(formData, "description"),
    severity: readEnum(formData, "severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const, "HIGH"),
    blocking: readField(formData, "blocking") !== "0",
    createUpstreamChange: readField(formData, "createUpstreamChange") === "1",
    buildExecutionId: target.program.buildExecutionId,
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateVerification(projectId);
  return { error: null, notice: `Defect ${created.data.humanId} recorded.` };
}

export async function resolveVerificationDefectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;

  const resolved = await resolveVerificationDefect(
    session.supabase,
    readField(formData, "defectId"),
    readField(formData, "resolution"),
  );
  if (resolved.status === "error") return { error: resolved.message, notice: null };
  revalidateVerification(projectId);
  return {
    error: null,
    notice: "Defect marked RESOLVED → RETEST_REQUIRED. Run a retest before closing.",
  };
}

export async function retestVerificationDefectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const defectId = readField(formData, "defectId");
  const caseId = readField(formData, "caseId");
  const resultStatus = readField(formData, "resultStatus") as VerificationCaseStatus;
  if (!VERIFICATION_CASE_STATUSES.includes(resultStatus)) {
    return { error: "Unknown retest result status.", notice: null };
  }
  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;

  let evidenceId: string | null = readField(formData, "evidenceId") || null;
  if (resultStatus === "PASSED") {
    const reference = readField(formData, "evidenceReference");
    if (reference) {
      const evidence = await addVerificationEvidence(session.supabase, {
        caseId,
        programId: target.program.id,
        projectId,
        kind: readEnum(formData, "kind", VERIFICATION_EVIDENCE_KINDS, "MANUAL_OBSERVATION"),
        reference,
        summary: readField(formData, "evidenceSummary") || "Retest pass evidence",
      });
      if (evidence.status === "error") return { error: evidence.message, notice: null };
      evidenceId = evidence.data.id;
    }
    const evidenceRows = await loadVerificationEvidence(session.supabase, target.program.id);
    if (evidenceRows.status === "error") return { error: evidenceRows.message, notice: null };
    const count = evidenceRows.data.filter((row) => row.caseId === caseId).length;
    const passed = await updateVerificationCase(
      session.supabase,
      caseId,
      {
        status: "PASSED",
        actualResult: readField(formData, "note") || "Retest PASSED.",
        completedAt: new Date().toISOString(),
      },
      { evidenceCount: count },
    );
    if (passed.status === "error") return { error: passed.message, notice: null };
  } else if (resultStatus === "FAILED") {
    await updateVerificationCase(session.supabase, caseId, {
      status: "FAILED",
      actualResult: readField(formData, "note") || "Retest FAILED.",
      completedAt: new Date().toISOString(),
    });
  }

  const retest = await recordRetestEvent(session.supabase, {
    defectId,
    programId: target.program.id,
    projectId,
    caseId,
    resultStatus,
    evidenceId,
    note: readField(formData, "note"),
  });
  if (retest.status === "error") return { error: retest.message, notice: null };

  revalidateVerification(projectId);
  return {
    error: null,
    notice:
      resultStatus === "PASSED"
        ? "Retest PASSED. Defect closed. Case PASSED."
        : `Retest recorded as ${resultStatus}.`,
  };
}

export async function escalateVerificationDecisionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;
  const question = readField(formData, "question");
  const inserted = await session.supabase
    .from("project_decisions")
    .insert({
      project_id: projectId,
      verification_program_id: target.program.id,
      title: readField(formData, "title") || question.slice(0, 120),
      question,
      context: "Escalated from Verification.",
      options: [
        readField(formData, "optionA") ? { id: "a", label: readField(formData, "optionA") } : null,
        readField(formData, "optionB") ? { id: "b", label: readField(formData, "optionB") } : null,
      ].filter(Boolean),
      recommendation: readField(formData, "recommendation") || null,
      evidence: [{ type: "verification_program", id: target.program.id, title: question.slice(0, 80) }],
      created_by: session.user.id,
      status: "OPEN",
    })
    .select("id")
    .single();
  if (inserted.error) return { error: inserted.error.message, notice: null };
  revalidateVerification(projectId);
  return { error: null, notice: "Verification decision escalated to Needs Your Decision." };
}

export async function syncVerificationNextActionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await programFor(session, projectId);
  if ("error" in target) return target.error;
  const bundle = await loadVerificationBundle(session.supabase, target.program);
  if (bundle.status === "error") return { error: bundle.message, notice: null };
  const { completion } = evaluateVerificationBundle(bundle.data);
  const suggestion = suggestVerificationNextAction({
    completion,
    programStatus: target.program.status,
    cases: bundle.data.cases,
    defects: bundle.data.defects,
  });
  if (!suggestion) {
    return { error: null, notice: "No justified next action from current verification state." };
  }
  await createNextAction(session.supabase, {
    projectId,
    title: suggestion.title,
    description: suggestion.description,
    provenance: "FOUNDER_APPROVED_ACTION",
    sourceKind: suggestion.sourceKind,
    sourceRef: target.program.id,
    priority: "HIGH",
  });
  revalidateVerification(projectId);
  return { error: null, notice: `Next action recorded: ${suggestion.title}` };
}
