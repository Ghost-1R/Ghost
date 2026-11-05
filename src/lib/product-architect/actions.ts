"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { createNextAction } from "@/lib/operations/actions";
import { initializeProductArchitectFromProject } from "./initialize";
import {
  createProductDependency,
  createProductFeature,
  createProductFlow,
  createProductQuestion,
  createProductRequirement,
  loadProductArchitecture,
  loadProductFeatures,
  loadProductQuestions,
  loadProductRequirements,
  recordProductArchitectureTransition,
  updateProductDefinition,
  updateProductFeature,
  updateProductQuestion,
  updateProductRequirement,
} from "./queries";
import type {
  DependencyKind,
  FeatureStatus,
  ProductArchitectureStatus,
  ProductPriority,
  ProductQuestionStatus,
  RequirementApproval,
  RequirementType,
} from "./types";
import { computeProductReadiness, suggestProductNextAction } from "./workflow";

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

function revalidateProduct(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/architect`);
  revalidatePath("/dashboard");
}

export async function initializeProductArchitectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const created = await initializeProductArchitectFromProject(session.supabase, {
    projectId,
    ideaId: readField(formData, "ideaId") || null,
    strategyId: readField(formData, "strategyId") || null,
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateProduct(projectId);
  redirect(`/projects/${projectId}/architect`);
}

export async function saveProductDefinitionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const architectureId = readField(formData, "architectureId");
  const saved = await updateProductDefinition(session.supabase, architectureId, {
    what: readField(formData, "what"),
    why: readField(formData, "why"),
    who: readField(formData, "who"),
    outcome: readField(formData, "outcome"),
    nonGoals: linesToList(readField(formData, "nonGoals")),
    assumptions: linesToList(readField(formData, "assumptions")),
    risks: linesToList(readField(formData, "risks")),
    constraints: linesToList(readField(formData, "constraints")),
    note: readField(formData, "note"),
  });
  if (saved.status === "error") return { error: saved.message, notice: null };
  const arch = await loadProductArchitecture(session.supabase, projectId);
  if (arch.status === "ok" && arch.data?.status === "DRAFT") {
    await recordProductArchitectureTransition(
      session.supabase,
      architectureId,
      "DEFINING",
      "Founder saved product definition.",
    );
  }
  revalidateProduct(projectId);
  return { error: null, notice: "Product definition saved. Assumptions remain assumptions." };
}

export async function transitionProductArchitectureAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const architectureId = readField(formData, "architectureId");
  const toStatus = readField(formData, "toStatus") as ProductArchitectureStatus;
  const reason = readField(formData, "reason") || `Founder moved Product Architect to ${toStatus}.`;

  if (toStatus === "BUILD_READY") {
    const [requirements, features, questions, openDecisions] = await Promise.all([
      loadProductRequirements(session.supabase, architectureId),
      loadProductFeatures(session.supabase, architectureId),
      loadProductQuestions(session.supabase, architectureId),
      session.supabase.from("project_decisions").select("id").eq("project_id", projectId).eq("status", "OPEN"),
    ]);
    const architecture = await loadProductArchitecture(session.supabase, projectId);
    if (architecture.status === "error" || !architecture.data) {
      return { error: architecture.status === "error" ? architecture.message : "Architecture not found.", notice: null };
    }
    const readiness = computeProductReadiness({
      architecture: architecture.data,
      requirements: requirements.status === "ok" ? requirements.data : [],
      features: features.status === "ok" ? features.data : [],
      openQuestions: questions.status === "ok" ? questions.data : [],
      openCriticalDecisions: openDecisions.data?.length ?? 0,
    });
    if (!readiness.buildReady) {
      return { error: `Not BUILD READY. ${readiness.reasons[0] ?? "Gaps remain."}`, notice: null };
    }
  }

  const transitioned = await recordProductArchitectureTransition(session.supabase, architectureId, toStatus, reason);
  if (transitioned.status === "error") return { error: transitioned.message, notice: null };
  revalidateProduct(projectId);
  return { error: null, notice: `Product Architect is now ${toStatus}.` };
}

export async function createRequirementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const created = await createProductRequirement(session.supabase, {
    architectureId: readField(formData, "architectureId"),
    projectId,
    title: readField(formData, "title"),
    description: readField(formData, "description"),
    reqType: (readField(formData, "reqType") || "FUNCTIONAL") as RequirementType,
    priority: (readField(formData, "priority") || "NORMAL") as ProductPriority,
    acceptanceCriteria: linesToList(readField(formData, "acceptanceCriteria")),
    source: readField(formData, "source") || "founder",
    provenance: readField(formData, "provenance") || "founder",
    approvalStatus: "PROPOSED",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateProduct(projectId);
  return { error: null, notice: `${created.data.humanId} proposed. Not accepted until you approve it.` };
}

export async function updateRequirementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const approvalStatus = readField(formData, "approvalStatus") as RequirementApproval | "";
  const updated = await updateProductRequirement(session.supabase, readField(formData, "requirementId"), {
    title: readField(formData, "title") || undefined,
    description: readField(formData, "description") || undefined,
    reqType: (readField(formData, "reqType") || undefined) as RequirementType | undefined,
    priority: (readField(formData, "priority") || undefined) as ProductPriority | undefined,
    approvalStatus: approvalStatus || undefined,
    acceptanceCriteria: formData.has("acceptanceCriteria")
      ? linesToList(readField(formData, "acceptanceCriteria"))
      : undefined,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateProduct(projectId);
  return {
    error: null,
    notice:
      approvalStatus === "ACCEPTED"
        ? `${updated.data.humanId} accepted by founder.`
        : approvalStatus === "REJECTED"
          ? `${updated.data.humanId} rejected.`
          : `${updated.data.humanId} updated.`,
  };
}

export async function createFeatureAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const requirementIds = formData.getAll("requirementIds").map(String).filter(Boolean);
  const created = await createProductFeature(session.supabase, {
    architectureId: readField(formData, "architectureId"),
    projectId,
    name: readField(formData, "name"),
    purpose: readField(formData, "purpose"),
    priority: (readField(formData, "priority") || "NORMAL") as ProductPriority,
    acceptanceCriteria: linesToList(readField(formData, "acceptanceCriteria")),
    requirementIds,
    status: "PROPOSED",
    source: "founder",
    provenance: "founder",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateProduct(projectId);
  return { error: null, notice: `${created.data.humanId} proposed. Not approved until you approve it.` };
}

export async function updateFeatureAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const status = readField(formData, "status") as FeatureStatus | "";
  const requirementIds = formData.has("requirementIds")
    ? formData.getAll("requirementIds").map(String).filter(Boolean)
    : undefined;
  const updated = await updateProductFeature(session.supabase, readField(formData, "featureId"), {
    name: readField(formData, "name") || undefined,
    purpose: readField(formData, "purpose") || undefined,
    priority: (readField(formData, "priority") || undefined) as ProductPriority | undefined,
    status: status || undefined,
    acceptanceCriteria: formData.has("acceptanceCriteria")
      ? linesToList(readField(formData, "acceptanceCriteria"))
      : undefined,
    requirementIds,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateProduct(projectId);
  return {
    error: null,
    notice: status === "APPROVED" ? `${updated.data.humanId} approved by founder.` : `${updated.data.humanId} updated.`,
  };
}

export async function createFlowAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const created = await createProductFlow(session.supabase, {
    architectureId: readField(formData, "architectureId"),
    projectId,
    name: readField(formData, "name"),
    actor: readField(formData, "actor"),
    startingCondition: readField(formData, "startingCondition"),
    steps: linesToList(readField(formData, "steps")),
    expectedOutcome: readField(formData, "expectedOutcome"),
    edgeCases: linesToList(readField(formData, "edgeCases")),
    featureId: readField(formData, "featureId") || null,
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateProduct(projectId);
  return { error: null, notice: `${created.data.humanId} saved.` };
}

export async function createQuestionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const created = await createProductQuestion(session.supabase, {
    architectureId: readField(formData, "architectureId"),
    projectId,
    question: readField(formData, "question"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateProduct(projectId);
  return { error: null, notice: "Unresolved question recorded." };
}

export async function resolveQuestionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const status = (readField(formData, "status") || "RESOLVED") as ProductQuestionStatus;
  const updated = await updateProductQuestion(session.supabase, readField(formData, "questionId"), {
    status,
    resolution: readField(formData, "resolution"),
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateProduct(projectId);
  return { error: null, notice: "Question updated." };
}

export async function escalateQuestionToDecisionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const architectureId = readField(formData, "architectureId");
  const questionId = readField(formData, "questionId");
  const question = readField(formData, "question");
  const inserted = await session.supabase
    .from("project_decisions")
    .insert({
      project_id: projectId,
      product_architecture_id: architectureId,
      title: readField(formData, "title") || question.slice(0, 120),
      question,
      context: "Escalated from Product Architect unresolved questions.",
      options: [
        readField(formData, "optionA") ? { id: "a", label: readField(formData, "optionA") } : null,
        readField(formData, "optionB") ? { id: "b", label: readField(formData, "optionB") } : null,
      ].filter(Boolean),
      recommendation: readField(formData, "recommendation") || null,
      evidence: [{ type: "product_question", id: questionId, title: question.slice(0, 80) }],
      created_by: session.user.id,
      status: "OPEN",
    })
    .select("id")
    .single();
  if (inserted.error) return { error: inserted.error.message, notice: null };
  await updateProductQuestion(session.supabase, questionId, {
    status: "ESCALATED",
    decisionId: inserted.data.id,
  });
  revalidateProduct(projectId);
  return { error: null, notice: "Question escalated to Needs Your Decision." };
}

export async function createDependencyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const created = await createProductDependency(session.supabase, {
    architectureId: readField(formData, "architectureId"),
    projectId,
    fromKind: readField(formData, "fromKind") as DependencyKind,
    fromRef: readField(formData, "fromRef"),
    toKind: readField(formData, "toKind") as DependencyKind,
    toRef: readField(formData, "toRef"),
    note: readField(formData, "note"),
    status: "PROPOSED",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateProduct(projectId);
  return { error: null, notice: "Dependency recorded as proposed until confirmed." };
}

export async function syncProductNextActionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "You are not signed in.", notice: null };
  const projectId = readField(formData, "projectId");
  const architectureId = readField(formData, "architectureId");
  const [architecture, requirements, features, questions, openDecisions] = await Promise.all([
    loadProductArchitecture(session.supabase, projectId),
    loadProductRequirements(session.supabase, architectureId),
    loadProductFeatures(session.supabase, architectureId),
    loadProductQuestions(session.supabase, architectureId),
    session.supabase.from("project_decisions").select("id").eq("project_id", projectId).eq("status", "OPEN"),
  ]);
  if (architecture.status === "error" || !architecture.data) {
    return { error: architecture.status === "error" ? architecture.message : "Architecture not found.", notice: null };
  }
  const readiness = computeProductReadiness({
    architecture: architecture.data,
    requirements: requirements.status === "ok" ? requirements.data : [],
    features: features.status === "ok" ? features.data : [],
    openQuestions: questions.status === "ok" ? questions.data : [],
    openCriticalDecisions: openDecisions.data?.length ?? 0,
  });
  const suggestion = suggestProductNextAction({
    readiness,
    architectureStatus: architecture.data.status,
    proposedRequirementCount: (requirements.status === "ok" ? requirements.data : []).filter((row) => row.approvalStatus === "PROPOSED")
      .length,
    proposedFeatureCount: (features.status === "ok" ? features.data : []).filter((row) => row.status === "PROPOSED").length,
  });
  if (!suggestion) {
    return { error: null, notice: "No Product Architect next action is justified by current records." };
  }
  const created = await createNextAction(session.supabase, {
    projectId,
    title: suggestion.title,
    description: suggestion.description,
    provenance: "FOUNDER_APPROVED_ACTION",
    sourceKind: suggestion.sourceKind,
    sourceRef: architectureId,
    priority: "HIGH",
    requiresDecision: /decision|question/i.test(suggestion.title),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateProduct(projectId);
  return { error: null, notice: `Next action recorded: ${created.data.title}` };
}
