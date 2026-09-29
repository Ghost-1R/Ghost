"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import type { ActionState } from "@/lib/action-state";
import { MEMORY_SCOPES, REVIEW_DECISIONS, type MemoryScope, type ReviewDecision } from "@/lib/domain/status";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FOUNDER_AUTHORED_PROVENANCE =
  "Founder-authored in the Ghost memory page. Not an AI inference.";

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function isMemoryScope(value: string): value is MemoryScope {
  return MEMORY_SCOPES.some((scope) => scope === value);
}

function isReviewDecision(value: string): value is ReviewDecision {
  return REVIEW_DECISIONS.some((decision) => decision === value);
}

export async function createMemoryProposal(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const title = readField(formData, "title");
  const content = readField(formData, "content");
  const scopeValue = readField(formData, "scope");
  const projectId = readField(formData, "projectId");

  if (!isMemoryScope(scopeValue)) {
    return { error: "Choose a proposal scope.", notice: null };
  }

  if (title.length < 1 || title.length > 200) {
    return { error: "Title must be between 1 and 200 characters.", notice: null };
  }

  if (content.length < 1) {
    return { error: "Content is required.", notice: null };
  }

  if (scopeValue === "PROJECT_KNOWLEDGE" && !UUID_PATTERN.test(projectId)) {
    return { error: "Project knowledge proposals need one of your projects.", notice: null };
  }

  if (projectId && !UUID_PATTERN.test(projectId)) {
    return { error: "Project id is not a valid identifier.", notice: null };
  }

  const { error } = await session.supabase.from("memory_proposals").insert({
    owner_id: session.user.id,
    project_id: projectId || null,
    proposed_scope: scopeValue,
    title,
    content,
    provenance: FOUNDER_AUTHORED_PROVENANCE,
    status: "PENDING",
  });

  if (error) {
    return { error: error.message, notice: null };
  }

  revalidatePath("/memory");
  revalidatePath("/dashboard");
  return {
    error: null,
    notice: "Proposal saved as pending. It is not a founder rule until you approve it.",
  };
}

export async function reviewMemoryProposal(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const proposalId = readField(formData, "proposalId");
  const decision = readField(formData, "decision");

  if (!UUID_PATTERN.test(proposalId) || !isReviewDecision(decision)) {
    return { error: "This review request is incomplete.", notice: null };
  }

  const { error } = await session.supabase.rpc("review_memory_proposal", {
    proposal_id: proposalId,
    decision,
  });

  if (error) {
    return { error: error.message, notice: null };
  }

  revalidatePath("/memory");
  revalidatePath("/dashboard");
  return { error: null, notice: `Proposal marked ${decision}.` };
}

export async function retireFounderRule(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const ruleId = readField(formData, "ruleId");
  if (!UUID_PATTERN.test(ruleId)) {
    return { error: "Rule id is not a valid identifier.", notice: null };
  }

  const { error } = await session.supabase.rpc("retire_founder_rule", {
    rule_id: ruleId,
  });

  if (error) {
    return { error: error.message, notice: null };
  }

  revalidatePath("/memory");
  revalidatePath("/dashboard");
  return { error: null, notice: "Rule retired." };
}
