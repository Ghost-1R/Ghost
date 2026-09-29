"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { listEvidence, presentationRoot } from "@/lib/presentation/ledger";
import { prepareApproval, rejectedClientEvidence } from "@/lib/presentation/records";
import { persistApproval } from "@/lib/presentation/remote";
import { hashWorkingTree } from "@/lib/presentation/tree";
import { executeTrustedInspection } from "./trusted-inspection";
import { loadProjectDetail } from "@/lib/projects/queries";
import { canExecute } from "./approval";
import { classifyRisk } from "./risk";
import { decideApproval, defaultRuntimeRoot, listApprovals, proposeApproval } from "./store";
import type { ActionRequest } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROPOSABLE = new Set([
  "apply-remote-migration",
  "push",
  "merge",
  "remote-db-reset",
  "force-push",
]);

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function visibleProject(projectId: string): Promise<ActionState | null> {
  if (!projectId) {
    return null;
  }
  if (!UUID_PATTERN.test(projectId)) {
    return { error: "That project is not visible.", notice: null };
  }
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status !== "ok" || !project.data) {
    return { error: "That project is not visible.", notice: null };
  }
  return null;
}

export async function runInspection(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const projectId = readField(formData, "projectId");
  const forged = rejectedClientEvidence(formData.keys());
  if (forged) {
    return { error: forged, notice: null };
  }
  const denied = await visibleProject(projectId);
  if (denied) {
    return denied;
  }
  if (!projectId) {
    return { error: "That project is not visible.", notice: null };
  }
  const outcome = await executeTrustedInspection({
    ownerId: session.user.id,
    projectId,
    cwd: process.cwd(),
    supabase: session.supabase,
  });
  revalidatePath("/inspector");
  revalidatePath("/presentation");
  if (outcome.error) {
    return { error: outcome.error, notice: null };
  }
  return { error: null, notice: `Inspection finished. Presentation result: ${outcome.reviewResult}.` };
}

export async function proposeHighRiskAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const actionType = readField(formData, "actionType");
  const projectId = readField(formData, "projectId");
  const target = readField(formData, "target").slice(0, 200);
  if (!PROPOSABLE.has(actionType) || !classifyRisk(actionType)) {
    return { error: "That action is not available.", notice: null };
  }
  const denied = await visibleProject(projectId);
  if (denied) {
    return denied;
  }
  if (!target) {
    return { error: "Name the target.", notice: null };
  }
  const request: ActionRequest = {
    actionType,
    target,
    parameters: { migration: readField(formData, "migration").slice(0, 200) },
    projectId,
    reason: "Founder asked to represent this action. It is not authorized to run.",
    expectedEffect: "No remote or repository write is performed by proposing it.",
    verificationPlan: "Confirm the action status stays pending or rejected and that no remote mutation occurred.",
    rollbackPlan: "Reject the proposal. Nothing was applied, so there is nothing to roll back.",
  };
  const approval = await proposeApproval(defaultRuntimeRoot(), session.user.id, request);
  if (!approval) {
    return { error: "The action was not recorded.", notice: null };
  }
  revalidatePath("/inspector");
  return { error: null, notice: `${approval.risk} action recorded as ${approval.status}. It was not executed.` };
}

export async function reviewAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const decision = readField(formData, "decision");
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return { error: "Choose approve or reject.", notice: null };
  }
  const updated = await decideApproval(defaultRuntimeRoot(), session.user.id, readField(formData, "approvalId"), decision);
  if (!updated) {
    return { error: "That approval is not visible.", notice: null };
  }
  if (decision === "APPROVED" && updated.projectId) {
    const tree = await hashWorkingTree(process.cwd()).catch(() => null);
    const knownEvidenceIds = tree
      ? (await listEvidence(presentationRoot(), session.user.id))
          .filter((row) => row.projectId === updated.projectId)
          .map((row) => row.id)
      : [];
    if (tree) {
      const approvedAt = new Date().toISOString();
      const prepared = prepareApproval({
        ownerId: session.user.id,
        projectId: updated.projectId,
        operation: updated.actionType,
        target: updated.target,
        commitSha: tree.commitSha,
        parameters: updated.parameters,
        suppliedRisk: updated.risk,
        evidenceIdsShown: knownEvidenceIds,
        knownEvidenceIds,
        approvedBy: session.user.id,
        approvedAt,
        expiresAt: new Date(Date.parse(approvedAt) + 24 * 60 * 60 * 1000).toISOString(),
        suppliedFingerprint: updated.fingerprint,
      });
      if (prepared.ok) {
        await persistApproval(prepared.value).catch(() => null);
      }
    }
  }
  revalidatePath("/inspector");
  return { error: null, notice: decision === "APPROVED" ? "Approval recorded. Execution is still a separate step." : "Approval rejected." };
}

export async function attemptAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const approvals = await listApprovals(defaultRuntimeRoot(), session.user.id);
  const approval = approvals.find((item) => item.id === readField(formData, "approvalId"));
  if (!approval) {
    return { error: "That approval is not visible.", notice: null };
  }
  const request: ActionRequest = {
    actionType: approval.actionType,
    target: readField(formData, "target").slice(0, 200) || approval.target,
    parameters: { migration: readField(formData, "migration").slice(0, 200) || approval.parameters.migration || "" },
    projectId: approval.projectId,
    reason: approval.reason,
    expectedEffect: approval.expectedEffect,
    verificationPlan: approval.verificationPlan,
    rollbackPlan: approval.rollbackPlan,
  };
  const decision = canExecute(approval, request);
  if (!decision.ok) {
    return { error: null, notice: `Not executed: ${decision.reason}.` };
  }
  return { error: null, notice: "Not executed: this Alpha action has no executor." };
}
