"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import {
  addIdeaEvidence,
  addIdeaValidation,
  captureIdea,
  loadIdea,
  recordIdeaTransition,
  refreshIdeaReadiness,
  updateIdeaFields,
  updateValidationStatus,
  upsertIdeaStrategy,
} from "@/lib/ideas/queries";
import { promoteIdeaToProject } from "@/lib/ideas/promote";
import type { IdeaEvidenceType, IdeaStatus, ValidationStatus } from "@/lib/ideas/types";
import { computeIdeaReadiness } from "@/lib/ideas/workflow";

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

export async function captureIdeaAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const created = await captureIdea(session.supabase, {
    ownerId: session.user.id,
    rawIdea: readField(formData, "rawIdea"),
    title: readField(formData, "title") || undefined,
    note: readField(formData, "note") || undefined,
  });
  if (created.status === "error") {
    return { error: created.message, notice: null };
  }
  revalidatePath("/ideas");
  revalidatePath("/dashboard");
  redirect(`/ideas/${created.data.id}`);
}

export async function saveIdeaStructureAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const ideaId = readField(formData, "ideaId");
  const updated = await updateIdeaFields(session.supabase, ideaId, {
    title: readField(formData, "title"),
    summary: readField(formData, "summary"),
    problem: readField(formData, "problem"),
    targetUser: readField(formData, "targetUser"),
    proposedSolution: readField(formData, "proposedSolution"),
    valueProposition: readField(formData, "valueProposition"),
    assumptions: linesToList(readField(formData, "assumptions")),
    risks: linesToList(readField(formData, "risks")),
    opportunities: linesToList(readField(formData, "opportunities")),
    constraints: linesToList(readField(formData, "constraints")),
    openQuestions: linesToList(readField(formData, "openQuestions")),
    recommendation: readField(formData, "recommendation") || null,
    note: readField(formData, "note"),
  });
  if (updated.status === "error") {
    return { error: updated.message, notice: null };
  }
  if (updated.data.status === "CAPTURED") {
    await recordIdeaTransition(
      session.supabase,
      ideaId,
      "EXPLORING",
      "Founder structured the idea beyond raw capture.",
    );
  }
  revalidatePath(`/ideas/${ideaId}`);
  revalidatePath("/ideas");
  revalidatePath("/dashboard");
  return { error: null, notice: "Idea structure saved. Assumptions are not facts." };
}

export async function transitionIdeaAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const ideaId = readField(formData, "ideaId");
  const toStatus = readField(formData, "toStatus") as IdeaStatus;
  const reason = readField(formData, "reason") || `Founder moved idea to ${toStatus}.`;
  if (toStatus === "APPROVED" || toStatus === "REJECTED") {
    const idea = await loadIdea(session.supabase, ideaId);
    if (idea.status === "ok" && idea.data) {
      const readiness = computeIdeaReadiness({
        problem: idea.data.problem,
        targetUser: idea.data.targetUser,
        proposedSolution: idea.data.proposedSolution,
        evidenceCount: 1,
        openValidationCount: 0,
        supportedValidationCount: 0,
        assumptionCount: idea.data.assumptions.length,
        riskCount: idea.data.risks.length,
      });
      // Soft hint only — founder may still decide; Ghost does not auto-block.
      void readiness;
      await refreshIdeaReadiness(session.supabase, idea.data);
    }
  }
  const result = await recordIdeaTransition(session.supabase, ideaId, toStatus, reason);
  if (result.status === "error") {
    return { error: result.message, notice: null };
  }
  revalidatePath(`/ideas/${ideaId}`);
  revalidatePath("/ideas");
  revalidatePath("/dashboard");
  return { error: null, notice: `Idea is now ${toStatus}. Ghost did not decide for you.` };
}

export async function addValidationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const ideaId = readField(formData, "ideaId");
  const created = await addIdeaValidation(session.supabase, {
    ideaId,
    question: readField(formData, "question"),
    reason: readField(formData, "reason"),
    evidenceNeeded: readField(formData, "evidenceNeeded"),
    source: "founder",
  });
  if (created.status === "error") {
    return { error: created.message, notice: null };
  }
  const idea = await loadIdea(session.supabase, ideaId);
  if (idea.status === "ok" && idea.data && (idea.data.status === "CAPTURED" || idea.data.status === "EXPLORING")) {
    await recordIdeaTransition(
      session.supabase,
      ideaId,
      "VALIDATING",
      "Founder added a validation question.",
    );
  }
  if (idea.status === "ok" && idea.data) await refreshIdeaReadiness(session.supabase, idea.data);
  revalidatePath(`/ideas/${ideaId}`);
  return { error: null, notice: "Validation question recorded. It is not yet answered." };
}

export async function updateValidationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const ideaId = readField(formData, "ideaId");
  const updated = await updateValidationStatus(session.supabase, {
    id: readField(formData, "validationId"),
    status: readField(formData, "status") as ValidationStatus,
    result: readField(formData, "result"),
  });
  if (updated.status === "error") {
    return { error: updated.message, notice: null };
  }
  const idea = await loadIdea(session.supabase, ideaId);
  if (idea.status === "ok" && idea.data) await refreshIdeaReadiness(session.supabase, idea.data);
  revalidatePath(`/ideas/${ideaId}`);
  return { error: null, notice: "Validation status updated." };
}

export async function addEvidenceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const ideaId = readField(formData, "ideaId");
  const created = await addIdeaEvidence(session.supabase, {
    ideaId,
    evidenceType: readField(formData, "evidenceType") as IdeaEvidenceType,
    statement: readField(formData, "statement"),
    source: readField(formData, "source"),
    confidence: readField(formData, "confidence") || null,
    provenance: "founder",
    createdBy: session.user.id,
  });
  if (created.status === "error") {
    return { error: created.message, notice: null };
  }
  const idea = await loadIdea(session.supabase, ideaId);
  if (idea.status === "ok" && idea.data) await refreshIdeaReadiness(session.supabase, idea.data);
  revalidatePath(`/ideas/${ideaId}`);
  return { error: null, notice: "Evidence recorded. AI opinion is not evidence." };
}

export async function saveStrategyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const ideaId = readField(formData, "ideaId");
  const approve = readField(formData, "approve") === "yes";
  const saved = await upsertIdeaStrategy(
    session.supabase,
    ideaId,
    {
      vision: readField(formData, "vision"),
      problem: readField(formData, "problem"),
      targetCustomer: readField(formData, "targetCustomer"),
      positioning: readField(formData, "positioning"),
      valueProposition: readField(formData, "valueProposition"),
      coreOffer: readField(formData, "coreOffer"),
      differentiation: readField(formData, "differentiation"),
      valueModel: readField(formData, "valueModel"),
      distribution: readField(formData, "distribution"),
      keyCapabilities: linesToList(readField(formData, "keyCapabilities")),
      constraints: linesToList(readField(formData, "constraints")),
      risks: linesToList(readField(formData, "risks")),
      assumptions: linesToList(readField(formData, "assumptions")),
      successMeasures: linesToList(readField(formData, "successMeasures")),
      nonGoals: linesToList(readField(formData, "nonGoals")),
      initialScope: readField(formData, "initialScope"),
      mvp: readField(formData, "mvp"),
      notBuilding: readField(formData, "notBuilding"),
      openDecisions: linesToList(readField(formData, "openDecisions")),
    },
    { approve, approvedBy: session.user.id },
  );
  if (saved.status === "error") {
    return { error: saved.message, notice: null };
  }
  revalidatePath(`/ideas/${ideaId}`);
  return {
    error: null,
    notice: approve
      ? "Strategy approved by founder. Ghost did not approve it."
      : "Strategy draft saved. Unfilled fields stay unknown.",
  };
}

export async function createStrategyDecisionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const ideaId = readField(formData, "ideaId");
  const projectId = readField(formData, "projectId");
  const strategyId = readField(formData, "strategyId");
  const idea = await loadIdea(session.supabase, ideaId);
  if (idea.status === "error" || !idea.data) {
    return { error: idea.status === "error" ? idea.message : "Idea not found.", notice: null };
  }
  const linkedProjectId = projectId || idea.data.promotedProjectId || null;
  const inserted = await session.supabase
    .from("project_decisions")
    .insert({
      project_id: linkedProjectId,
      idea_id: ideaId,
      strategy_id: strategyId || null,
      title: readField(formData, "title"),
      question: readField(formData, "question"),
      context: readField(formData, "context") || `Strategic decision from Idea Lab: ${idea.data.title}`,
      options: [
        readField(formData, "optionA") ? { id: "a", label: readField(formData, "optionA") } : null,
        readField(formData, "optionB") ? { id: "b", label: readField(formData, "optionB") } : null,
      ].filter(Boolean),
      recommendation: readField(formData, "recommendation") || null,
      evidence: [{ type: "idea", id: ideaId, title: idea.data.title }],
      created_by: session.user.id,
      status: "OPEN",
    })
    .select("id")
    .single();
  if (inserted.error) {
    return { error: inserted.error.message, notice: null };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/ideas/${ideaId}`);
  if (linkedProjectId) revalidatePath(`/projects/${linkedProjectId}`);
  return { error: null, notice: "Strategic decision is in Needs Your Decision." };
}

export async function promoteIdeaAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const ideaId = readField(formData, "ideaId");
  const promoted = await promoteIdeaToProject(session.supabase, {
    ideaId,
    ownerId: session.user.id,
  });
  if (promoted.status === "error") {
    return { error: promoted.message, notice: null };
  }
  revalidatePath("/ideas");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/projects/${promoted.data.projectId}`);
  redirect(`/projects/${promoted.data.projectId}`);
}

/** Challenge / explore helpers store structured founder-accepted drafts, not automatic truth. */
export async function applyChallengeDraftAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const ideaId = readField(formData, "ideaId");
  const assumptions = linesToList(readField(formData, "assumptions"));
  const risks = linesToList(readField(formData, "risks"));
  const openQuestions = linesToList(readField(formData, "openQuestions"));
  const idea = await loadIdea(session.supabase, ideaId);
  if (idea.status === "error" || !idea.data) {
    return { error: idea.status === "error" ? idea.message : "Idea not found.", notice: null };
  }
  const updated = await updateIdeaFields(session.supabase, ideaId, {
    assumptions: [...idea.data.assumptions, ...assumptions],
    risks: [...idea.data.risks, ...risks],
    openQuestions: [...idea.data.openQuestions, ...openQuestions],
    recommendation: readField(formData, "recommendation") || idea.data.recommendation,
  });
  if (updated.status === "error") {
    return { error: updated.message, notice: null };
  }
  for (const question of linesToList(readField(formData, "validationQuestions"))) {
    await addIdeaValidation(session.supabase, {
      ideaId,
      question,
      reason: "Added from challenge/explore draft. Not yet validated.",
      evidenceNeeded: "Founder evidence required.",
      source: "ghost_recommendation",
    });
  }
  if (idea.data.status === "CAPTURED") {
    await recordIdeaTransition(session.supabase, ideaId, "EXPLORING", "Founder accepted an explore/challenge draft.");
  }
  revalidatePath(`/ideas/${ideaId}`);
  return {
    error: null,
    notice: "Draft outcomes saved as assumptions/questions — not verified facts.",
  };
}
