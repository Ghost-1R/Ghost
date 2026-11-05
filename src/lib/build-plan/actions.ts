"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { createNextAction } from "@/lib/operations/actions";
import { CONFIG_CLASSIFICATIONS } from "@/lib/system-architecture/types";
import { initializeBuildPlanFromProject } from "./initialize";
import {
  createBuildPhase,
  createBuildRisk,
  createConfigRequirement,
  createManualAction,
  createVerification,
  createWorkPackage,
  createWorkPackageDependency,
  deleteWorkPackageDependency,
  linkArchitecture,
  linkFeature,
  linkRequirement,
  loadBuildPlan,
  loadBuildPlanBundle,
  recordBuildPlanTransition,
  unlinkArchitecture,
  unlinkFeature,
  unlinkRequirement,
  updateBuildPhase,
  updateBuildPlanOverview,
  updateBuildRisk,
  updateConfigRequirement,
  updateManualAction,
  updateVerification,
  updateWorkPackage,
} from "./queries";
import {
  ARCHITECTURE_LINK_KINDS,
  BUILD_PLAN_STATUSES,
  BUILD_RISK_SEVERITIES,
  DEPENDENCY_EDGE_KINDS,
  PATH_CERTAINTIES,
  V8_MANUAL_ACTION_STATUSES,
  V8_WORK_PACKAGE_STATUSES,
  VERIFICATION_KINDS,
  WORK_PACKAGE_PRIORITIES,
  type BuildPlan,
  type BuildPlanStatus,
} from "./types";
import {
  canTransitionBuildPlan,
  evaluateBuildPlanBundle,
  isValidEnvVariableName,
  suggestBuildNextAction,
} from "./workflow";

type Session = Extract<Awaited<ReturnType<typeof getSession>>, { status: "authenticated" }>;

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readBool(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function readEnum<T extends string>(formData: FormData, name: string, allowed: readonly T[], fallback: T): T {
  const value = readField(formData, name);
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readOptionalEnum<T extends string>(formData: FormData, name: string, allowed: readonly T[]): T | undefined {
  const value = readField(formData, name);
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function revalidateBuild(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/build-plan`);
  revalidatePath("/dashboard");
}

async function authenticated(): Promise<Session | null> {
  const session = await getSession();
  return session.status === "authenticated" ? session : null;
}

const NOT_SIGNED_IN: ActionState = { error: "You are not signed in.", notice: null };

async function planFor(session: Session, projectId: string): Promise<{ plan: BuildPlan } | { error: ActionState }> {
  const plan = await loadBuildPlan(session.supabase, projectId);
  if (plan.status === "error") return { error: { error: plan.message, notice: null } };
  if (!plan.data) return { error: { error: "Build Plan is not initialized for this project.", notice: null } };
  return { plan: plan.data };
}

export async function initializeBuildPlanAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const created = await initializeBuildPlanFromProject(session.supabase, { projectId });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateBuild(projectId);
  redirect(`/projects/${projectId}/build-plan`);
}

export async function saveBuildOverviewAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const saved = await updateBuildPlanOverview(session.supabase, target.plan.id, {
    summary: readField(formData, "summary"),
    deploymentSequence: linesToList(readField(formData, "deploymentSequence")),
    rollbackSummary: readField(formData, "rollbackSummary"),
    note: readField(formData, "note"),
  });
  if (saved.status === "error") return { error: saved.message, notice: null };
  if (target.plan.status === "DRAFT") {
    await recordBuildPlanTransition(session.supabase, target.plan.id, "PLANNING", "Founder saved build plan overview.");
  }
  revalidateBuild(projectId);
  return { error: null, notice: "Build plan overview saved. Planning is not implementation." };
}

export async function transitionBuildPlanAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const toStatus = readField(formData, "toStatus") as BuildPlanStatus;
  if (!BUILD_PLAN_STATUSES.includes(toStatus)) return { error: "Unknown build plan status.", notice: null };
  const reason = readField(formData, "reason") || `Founder moved Build Plan to ${toStatus}.`;

  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  if (!canTransitionBuildPlan(target.plan.status, toStatus)) {
    return { error: `Cannot move Build Plan from ${target.plan.status} to ${toStatus}.`, notice: null };
  }

  if (toStatus === "BUILD_PLAN_READY") {
    const bundle = await loadBuildPlanBundle(session.supabase, target.plan);
    if (bundle.status === "error") return { error: bundle.message, notice: null };
    const { blockers } = evaluateBuildPlanBundle(bundle.data);
    if (blockers.length > 0) {
      return {
        error: `Not BUILD_PLAN_READY (${blockers.length} blocker${blockers.length === 1 ? "" : "s"}). ${blockers[0].message}`,
        notice: null,
      };
    }
  }

  const transitioned = await recordBuildPlanTransition(session.supabase, target.plan.id, toStatus, reason);
  if (transitioned.status === "error") return { error: transitioned.message, notice: null };
  revalidateBuild(projectId);
  return {
    error: null,
    notice:
      toStatus === "BUILD_PLAN_READY"
        ? "Build Plan is BUILD_PLAN_READY. This is a plan for coding, not an implementation or deployment."
        : `Build Plan is now ${toStatus}.`,
  };
}

export async function createBuildPhaseAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createBuildPhase(session.supabase, {
    planId: target.plan.id,
    projectId,
    name: readField(formData, "name"),
    objective: readField(formData, "objective"),
    note: readField(formData, "note"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: `${created.data.humanId} recorded.` };
}

export async function updateBuildPhaseAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const updated = await updateBuildPhase(session.supabase, readField(formData, "phaseId"), {
    name: readField(formData, "name") || undefined,
    objective: formData.has("objective") ? readField(formData, "objective") : undefined,
    note: formData.has("note") ? readField(formData, "note") : undefined,
    position: formData.has("position") ? Number(readField(formData, "position") || 0) : undefined,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: `${updated.data.humanId} updated.` };
}

export async function createWorkPackageAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createWorkPackage(session.supabase, {
    planId: target.plan.id,
    projectId,
    phaseId: readField(formData, "phaseId") || null,
    title: readField(formData, "title"),
    objective: readField(formData, "objective"),
    description: readField(formData, "description"),
    status: readEnum(formData, "status", V8_WORK_PACKAGE_STATUSES, "PLANNED"),
    priority: readEnum(formData, "priority", WORK_PACKAGE_PRIORITIES, "MEDIUM"),
    likelyCodeAreas: linesToList(readField(formData, "likelyCodeAreas")),
    pathCertainty: readEnum(formData, "pathCertainty", PATH_CERTAINTIES, "UNKNOWN"),
    databaseImpact: readField(formData, "databaseImpact"),
    integrationImpact: readField(formData, "integrationImpact"),
    securityImpact: readField(formData, "securityImpact"),
    definitionOfDone: linesToList(readField(formData, "definitionOfDone")),
    acceptanceCriteria: linesToList(readField(formData, "acceptanceCriteria")),
    rollbackConsideration: readField(formData, "rollbackConsideration"),
    irreversible: readBool(formData, "irreversible"),
    riskNote: readField(formData, "riskNote"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: `${created.data.humanId} planned. Not implemented.` };
}

export async function updateWorkPackageAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const status = readOptionalEnum(formData, "status", V8_WORK_PACKAGE_STATUSES);
  const updated = await updateWorkPackage(session.supabase, readField(formData, "packageId"), {
    phaseId: formData.has("phaseId") ? readField(formData, "phaseId") || null : undefined,
    title: readField(formData, "title") || undefined,
    objective: formData.has("objective") ? readField(formData, "objective") : undefined,
    description: formData.has("description") ? readField(formData, "description") : undefined,
    status,
    priority: readOptionalEnum(formData, "priority", WORK_PACKAGE_PRIORITIES),
    likelyCodeAreas: formData.has("likelyCodeAreas") ? linesToList(readField(formData, "likelyCodeAreas")) : undefined,
    pathCertainty: readOptionalEnum(formData, "pathCertainty", PATH_CERTAINTIES),
    databaseImpact: formData.has("databaseImpact") ? readField(formData, "databaseImpact") : undefined,
    integrationImpact: formData.has("integrationImpact") ? readField(formData, "integrationImpact") : undefined,
    securityImpact: formData.has("securityImpact") ? readField(formData, "securityImpact") : undefined,
    definitionOfDone: formData.has("definitionOfDone") ? linesToList(readField(formData, "definitionOfDone")) : undefined,
    acceptanceCriteria: formData.has("acceptanceCriteria")
      ? linesToList(readField(formData, "acceptanceCriteria"))
      : undefined,
    rollbackConsideration: formData.has("rollbackConsideration")
      ? readField(formData, "rollbackConsideration")
      : undefined,
    irreversible: formData.has("irreversible") ? readBool(formData, "irreversible") : undefined,
    riskNote: formData.has("riskNote") ? readField(formData, "riskNote") : undefined,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: `${updated.data.humanId} updated. Still planning, not implemented.` };
}

export async function createDependencyAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createWorkPackageDependency(session.supabase, {
    planId: target.plan.id,
    projectId,
    fromPackageId: readField(formData, "fromPackageId"),
    toPackageId: readField(formData, "toPackageId"),
    edgeKind: readEnum(formData, "edgeKind", DEPENDENCY_EDGE_KINDS, "DEPENDS_ON"),
    note: readField(formData, "note"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Dependency recorded." };
}

export async function deleteDependencyAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const deleted = await deleteWorkPackageDependency(session.supabase, readField(formData, "dependencyId"));
  if (deleted.status === "error") return { error: deleted.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Dependency removed." };
}

export async function linkRequirementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const linked = await linkRequirement(session.supabase, readField(formData, "packageId"), readField(formData, "requirementId"));
  if (linked.status === "error") return { error: linked.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Requirement linked to work package." };
}

export async function unlinkRequirementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const unlinked = await unlinkRequirement(
    session.supabase,
    readField(formData, "packageId"),
    readField(formData, "requirementId"),
  );
  if (unlinked.status === "error") return { error: unlinked.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Requirement unlinked." };
}

export async function linkFeatureAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const linked = await linkFeature(session.supabase, readField(formData, "packageId"), readField(formData, "featureId"));
  if (linked.status === "error") return { error: linked.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Feature linked to work package." };
}

export async function unlinkFeatureAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const unlinked = await unlinkFeature(session.supabase, readField(formData, "packageId"), readField(formData, "featureId"));
  if (unlinked.status === "error") return { error: unlinked.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Feature unlinked." };
}

export async function linkArchitectureAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const linked = await linkArchitecture(session.supabase, {
    workPackageId: readField(formData, "packageId"),
    planId: target.plan.id,
    projectId,
    linkKind: readEnum(formData, "linkKind", ARCHITECTURE_LINK_KINDS, "OTHER"),
    recordRef: readField(formData, "recordRef"),
    note: readField(formData, "note"),
  });
  if (linked.status === "error") return { error: linked.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Architecture record linked." };
}

export async function unlinkArchitectureAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const unlinked = await unlinkArchitecture(session.supabase, readField(formData, "linkId"));
  if (unlinked.status === "error") return { error: unlinked.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Architecture link removed." };
}

export async function createVerificationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createVerification(session.supabase, {
    workPackageId: readField(formData, "packageId"),
    planId: target.plan.id,
    projectId,
    kind: readEnum(formData, "kind", VERIFICATION_KINDS, "UNIT"),
    description: readField(formData, "description"),
    observableSignal: readField(formData, "observableSignal"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Verification planned. Not a passing test result." };
}

export async function updateVerificationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const updated = await updateVerification(session.supabase, readField(formData, "verificationId"), {
    kind: readOptionalEnum(formData, "kind", VERIFICATION_KINDS),
    description: formData.has("description") ? readField(formData, "description") : undefined,
    observableSignal: formData.has("observableSignal") ? readField(formData, "observableSignal") : undefined,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Verification plan updated." };
}

export async function createManualActionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createManualAction(session.supabase, {
    planId: target.plan.id,
    projectId,
    workPackageId: readField(formData, "packageId") || null,
    title: readField(formData, "title"),
    description: readField(formData, "description"),
    status: readEnum(formData, "status", V8_MANUAL_ACTION_STATUSES, "REQUIRED"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: `${created.data.humanId} recorded.` };
}

export async function updateManualActionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const updated = await updateManualAction(session.supabase, readField(formData, "actionId"), {
    workPackageId: formData.has("packageId") ? readField(formData, "packageId") || null : undefined,
    title: readField(formData, "title") || undefined,
    description: formData.has("description") ? readField(formData, "description") : undefined,
    status: readOptionalEnum(formData, "status", V8_MANUAL_ACTION_STATUSES),
    evidenceNote: formData.has("evidenceNote") ? readField(formData, "evidenceNote") : undefined,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: `${updated.data.humanId} updated.` };
}

export async function createConfigRequirementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const variableName = readField(formData, "variableName");
  const check = isValidEnvVariableName(variableName);
  if (!check.ok) return { error: check.reason, notice: null };
  const created = await createConfigRequirement(session.supabase, {
    planId: target.plan.id,
    projectId,
    workPackageId: readField(formData, "packageId") || null,
    variableName,
    purpose: readField(formData, "purpose"),
    environment: readField(formData, "environment") || "production",
    classification: readEnum(formData, "classification", CONFIG_CLASSIFICATIONS, "SERVER_SECRET"),
    founderActionRequired: formData.has("founderActionRequired") ? readBool(formData, "founderActionRequired") : true,
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: `${created.data.variableName} recorded by name only. No value is stored.` };
}

export async function updateConfigRequirementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const updated = await updateConfigRequirement(session.supabase, readField(formData, "configId"), {
    workPackageId: formData.has("packageId") ? readField(formData, "packageId") || null : undefined,
    purpose: formData.has("purpose") ? readField(formData, "purpose") : undefined,
    environment: formData.has("environment") ? readField(formData, "environment") : undefined,
    classification: readOptionalEnum(formData, "classification", CONFIG_CLASSIFICATIONS),
    founderActionRequired: formData.has("founderActionRequired") ? readBool(formData, "founderActionRequired") : undefined,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Config requirement updated (name only)." };
}

export async function createBuildRiskAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createBuildRisk(session.supabase, {
    planId: target.plan.id,
    projectId,
    workPackageId: readField(formData, "packageId") || null,
    description: readField(formData, "description"),
    severity: readEnum(formData, "severity", BUILD_RISK_SEVERITIES, "MEDIUM"),
    mitigation: readField(formData, "mitigation"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: `${created.data.humanId} recorded.` };
}

export async function updateBuildRiskAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const updated = await updateBuildRisk(session.supabase, readField(formData, "riskId"), {
    workPackageId: formData.has("packageId") ? readField(formData, "packageId") || null : undefined,
    description: formData.has("description") ? readField(formData, "description") : undefined,
    severity: readOptionalEnum(formData, "severity", BUILD_RISK_SEVERITIES),
    mitigation: formData.has("mitigation") ? readField(formData, "mitigation") : undefined,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: `${updated.data.humanId} updated.` };
}

export async function escalateBuildDecisionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const question = readField(formData, "question");
  const inserted = await session.supabase
    .from("project_decisions")
    .insert({
      project_id: projectId,
      build_plan_id: target.plan.id,
      title: readField(formData, "title") || question.slice(0, 120),
      question,
      context: "Escalated from Build Plan.",
      options: [
        readField(formData, "optionA") ? { id: "a", label: readField(formData, "optionA") } : null,
        readField(formData, "optionB") ? { id: "b", label: readField(formData, "optionB") } : null,
      ].filter(Boolean),
      recommendation: readField(formData, "recommendation") || null,
      evidence: [{ type: "build_plan", id: target.plan.id, title: question.slice(0, 80) }],
      created_by: session.user.id,
      status: "OPEN",
    })
    .select("id")
    .single();
  if (inserted.error) return { error: inserted.error.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: "Build decision escalated to Needs Your Decision." };
}

export async function syncBuildNextActionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await planFor(session, projectId);
  if ("error" in target) return target.error;
  const bundle = await loadBuildPlanBundle(session.supabase, target.plan);
  if (bundle.status === "error") return { error: bundle.message, notice: null };
  const { readiness } = evaluateBuildPlanBundle(bundle.data);
  const data = bundle.data;
  const suggestion = suggestBuildNextAction({
    readiness,
    planStatus: data.plan.status,
    summaryPresent: data.plan.summary.trim().length > 0,
    phaseCount: data.phases.length,
    packageCount: data.packages.length,
  });
  if (!suggestion) {
    return { error: null, notice: "No Build Plan next action is justified by current records." };
  }
  const created = await createNextAction(session.supabase, {
    projectId,
    title: suggestion.title,
    description: suggestion.description,
    provenance: "FOUNDER_APPROVED_ACTION",
    sourceKind: suggestion.sourceKind,
    sourceRef: data.plan.id,
    priority: "HIGH",
    requiresDecision: /decision/i.test(suggestion.title),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateBuild(projectId);
  return { error: null, notice: `Next action recorded: ${created.data.title}` };
}
