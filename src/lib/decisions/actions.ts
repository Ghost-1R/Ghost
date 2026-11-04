"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { createProjectDecision, resolveProjectDecision } from "@/lib/decisions/queries";

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function submitProjectDecision(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const projectId = readField(formData, "projectId");
  const title = readField(formData, "title");
  const question = readField(formData, "question");
  const context = readField(formData, "context");
  const recommendation = readField(formData, "recommendation");
  const optionA = readField(formData, "optionA");
  const optionB = readField(formData, "optionB");
  const options = [
    optionA ? { id: "a", label: optionA } : null,
    optionB ? { id: "b", label: optionB } : null,
  ].filter((option): option is { id: string; label: string } => Boolean(option));

  const created = await createProjectDecision(
    session.supabase,
    {
      projectId,
      title,
      question,
      context,
      recommendation: recommendation || null,
      options,
    },
    session.user.id,
  );
  if (created.status === "error") {
    return { error: created.message, notice: null };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/projects/${projectId}`);
  return { error: null, notice: "Decision recorded. Ghost did not choose for you." };
}

export async function resolveFounderDecision(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }
  const decisionId = readField(formData, "decisionId");
  const projectId = readField(formData, "projectId");
  const status = readField(formData, "status");
  const selectedOption = readField(formData, "selectedOption");
  const founderResponse = readField(formData, "founderResponse");
  const rationale = readField(formData, "rationale");
  const followUpTitle = readField(formData, "followUpTitle");
  const followUpDescription = readField(formData, "followUpDescription");

  if (status !== "RESOLVED" && status !== "CANCELLED") {
    return { error: "Choose resolve or cancel.", notice: null };
  }

  const resolved = await resolveProjectDecision(session.supabase, decisionId, {
    status,
    selectedOption: selectedOption || null,
    founderResponse: founderResponse || null,
    rationale: rationale || null,
    followUpAction:
      status === "RESOLVED" && followUpTitle
        ? { title: followUpTitle, description: followUpDescription || undefined }
        : null,
  });
  if (resolved.status === "error") {
    return { error: resolved.message, notice: null };
  }
  revalidatePath("/dashboard");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  if (resolved.data.ideaId) revalidatePath(`/ideas/${resolved.data.ideaId}`);
  return {
    error: null,
    notice:
      resolved.data.status === "RESOLVED"
        ? "Decision resolved. History preserved."
        : "Decision cancelled. History preserved.",
  };
}
