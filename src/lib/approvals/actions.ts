"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import {
  createFounderAuthorization,
  loadAuthorizationById,
  transitionFounderAuthorization,
} from "./queries";
import { decideApprove, decideReject, decideRevoke } from "./workflow";

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function revalidateApprovals(projectId?: string) {
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

export async function requestFounderAuthorization(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const projectId = readField(formData, "projectId");
  const hoursRaw = readField(formData, "expiresInHours") || "24";
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
    return { error: "Expiration must be between 1 and 168 hours.", notice: null };
  }
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const reusePolicy = readField(formData, "reusePolicy") === "BOUNDED" ? "BOUNDED" : "ONE_TIME";
  const maxUsesRaw = readField(formData, "maxUses");
  const maxUses = reusePolicy === "BOUNDED" ? Number(maxUsesRaw || "1") : null;
  const evidenceSource = readField(formData, "evidenceSource");
  const evidenceReference = readField(formData, "evidenceReference");
  const evidence =
    evidenceSource && evidenceReference
      ? [{ source: evidenceSource, reference: evidenceReference, at: new Date().toISOString() }]
      : [];

  const created = await createFounderAuthorization(session.supabase, session.user.id, {
    projectId,
    environmentLabel: readField(formData, "environmentLabel") || "UNKNOWN",
    decisionId: readField(formData, "decisionId") || null,
    actionType: readField(formData, "actionType"),
    actionScope: readField(formData, "actionScope"),
    reason: readField(formData, "reason"),
    evidence,
    sideEffects: readField(formData, "sideEffects"),
    estimatedCost: readField(formData, "estimatedCost") || "UNKNOWN",
    reusePolicy,
    maxUses,
    expiresAt,
    idempotencyKey: readField(formData, "idempotencyKey"),
  });

  if (created.status === "error") {
    return { error: created.message, notice: null };
  }

  revalidateApprovals(projectId);
  return {
    error: null,
    notice: "Authorization request recorded as PENDING. Approval does not execute the action.",
  };
}

export async function approveFounderAuthorization(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const authorizationId = readField(formData, "authorizationId");
  const current = await loadAuthorizationById(session.supabase, session.user.id, authorizationId);
  if (current.status === "error") return { error: current.message, notice: null };
  if (!current.data) return { error: "That authorization is not visible.", notice: null };

  const decision = decideApprove(current.data, session.user.id);
  if (!decision.ok) return { error: decision.reason, notice: null };

  const updated = await transitionFounderAuthorization(
    session.supabase,
    session.user.id,
    authorizationId,
    {
      status: decision.nextStatus,
      eventType: decision.eventType,
      detail: decision.detail,
    },
  );
  if (updated.status === "error") return { error: updated.message, notice: null };

  revalidateApprovals(current.data.projectId);
  return {
    error: null,
    notice: "Approved. An executor must still revalidate this exact scope before any action runs.",
  };
}

export async function rejectFounderAuthorization(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const authorizationId = readField(formData, "authorizationId");
  const current = await loadAuthorizationById(session.supabase, session.user.id, authorizationId);
  if (current.status === "error") return { error: current.message, notice: null };
  if (!current.data) return { error: "That authorization is not visible.", notice: null };

  const decision = decideReject(current.data, session.user.id);
  if (!decision.ok) return { error: decision.reason, notice: null };

  const updated = await transitionFounderAuthorization(
    session.supabase,
    session.user.id,
    authorizationId,
    {
      status: decision.nextStatus,
      eventType: decision.eventType,
      detail: decision.detail,
    },
  );
  if (updated.status === "error") return { error: updated.message, notice: null };

  revalidateApprovals(current.data.projectId);
  return { error: null, notice: "Request rejected. No execution is authorized." };
}

export async function revokeFounderAuthorization(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const authorizationId = readField(formData, "authorizationId");
  const revokeReason = readField(formData, "revokeReason");
  const current = await loadAuthorizationById(session.supabase, session.user.id, authorizationId);
  if (current.status === "error") return { error: current.message, notice: null };
  if (!current.data) return { error: "That authorization is not visible.", notice: null };

  const decision = decideRevoke(current.data, session.user.id, revokeReason);
  if (!decision.ok) return { error: decision.reason, notice: null };

  const updated = await transitionFounderAuthorization(
    session.supabase,
    session.user.id,
    authorizationId,
    {
      status: decision.nextStatus,
      eventType: decision.eventType,
      detail: decision.detail,
      revokeReason,
    },
  );
  if (updated.status === "error") return { error: updated.message, notice: null };

  revalidateApprovals(current.data.projectId);
  return { error: null, notice: "Authorization revoked. Future execution must fail closed." };
}
