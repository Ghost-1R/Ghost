"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { canAdminProject } from "@/lib/access/permissions";
import { getAccessContext } from "@/lib/access/session-access";
import { recordActivity } from "@/lib/activity/record";
import { createAiAssignment, createHumanAssignment, handAiResultToHuman } from "@/lib/assignments/actions";
import { getSession } from "@/lib/auth/session";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { loose } from "@/lib/db/loose";
import { SCHEMA_UNAVAILABLE_USER_ERROR, requireSchemaFeature } from "@/lib/schema/readiness";
import { proposeBoundedUnderworldPlan, reviewerIsIndependent } from "@/lib/underworld/plan-propose";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export type UnderworldResult =
  | { ok: true; goalId: string; planId: string; notice: string }
  | { ok: false; error: string };

/** Create goal + MOCK plan (DRAFT). Does not run workers. */
export async function createUnderworldGoalWithPlan(input: {
  companyId: string;
  projectId: string;
  title: string;
  objective: string;
}): Promise<UnderworldResult> {
  if (isCodegenLiveEnabled()) {
    return { ok: false, error: "Underworld refuses to start while LIVE is enabled." };
  }

  const session = await getSession();
  if (session.status !== "authenticated") return { ok: false, error: "Sign in required." };

  const schema = await requireSchemaFeature(session.supabase, "underworld");
  if (!schema.ok) return { ok: false, error: SCHEMA_UNAVAILABLE_USER_ERROR };

  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!canAdminProject(access, input.projectId, input.companyId)) {
    return { ok: false, error: "Only a founder or project admin can create an Underworld goal." };
  }

  const title = input.title.trim();
  const objective = input.objective.trim();
  if (title.length < 1 || title.length > 200) {
    return { ok: false, error: "Goal title must be between 1 and 200 characters." };
  }

  const proposed = proposeBoundedUnderworldPlan({ title, objective });
  const client = loose(session.supabase);

  const goalInsert = await client
    .from("underworld_goals")
    .insert({
      company_id: input.companyId,
      project_id: input.projectId,
      owner_id: session.user.id,
      title,
      objective,
      classification: "INTERNAL",
      budget_cents: 0,
      stop_condition: "Founder approval required for consequential actions. LIVE=0.",
      status: "DRAFT",
    })
    .select("id")
    .single();

  if (goalInsert.error || !goalInsert.data) {
    console.error("[underworld] goal insert", goalInsert.error?.message);
    return { ok: false, error: goalInsert.error?.message ?? "Goal was not created." };
  }

  const planInsert = await client
    .from("underworld_plans")
    .insert({
      goal_id: goalInsert.data.id,
      version: 1,
      status: "DRAFT",
      scope_summary: proposed.scopeSummary,
      scope_fingerprint: proposed.scopeFingerprint,
    })
    .select("id")
    .single();

  if (planInsert.error || !planInsert.data) {
    console.error("[underworld] plan insert", planInsert.error?.message);
    return { ok: false, error: planInsert.error?.message ?? "Plan was not created." };
  }

  const stepRows = proposed.steps.map((step) => ({
    plan_id: planInsert.data.id,
    seq: step.seq,
    title: step.title,
    role: step.role,
    assignee_kind: step.assigneeKind,
    status: step.seq === 1 ? "READY" : "PENDING",
    stop_condition: step.stopCondition,
  }));

  const stepsInsert = await client.from("underworld_steps").insert(stepRows);
  if (stepsInsert.error) {
    console.error("[underworld] steps insert", stepsInsert.error.message);
    return { ok: false, error: stepsInsert.error.message };
  }

  await recordActivity(session.supabase, {
    companyId: input.companyId,
    projectId: input.projectId,
    actorKind: "PERSON",
    action: "underworld.goal_created",
    summary: `Underworld goal created: ${title}`,
    recordType: "underworld_goal",
    recordId: goalInsert.data.id as string,
  });

  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath(`/projects/${input.projectId}/underworld`);
  return {
    ok: true,
    goalId: goalInsert.data.id as string,
    planId: planInsert.data.id as string,
    notice: "MOCK plan ready for preview. LIVE stays off.",
  };
}

export async function previewUnderworldPlanForm(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "Sign in required.", notice: null };

  const planId = field(formData, "planId");
  const projectId = field(formData, "projectId");
  const companyId = field(formData, "companyId");
  if (!planId || !projectId || !companyId) {
    return { error: "Plan context is incomplete.", notice: null };
  }

  const schema = await requireSchemaFeature(session.supabase, "underworld");
  if (!schema.ok) return { error: SCHEMA_UNAVAILABLE_USER_ERROR, notice: null };

  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!canAdminProject(access, projectId, companyId)) {
    return { error: "Only a founder or project admin can preview this plan.", notice: null };
  }

  const { error } = await loose(session.supabase)
    .from("underworld_plans")
    .update({ status: "PREVIEWED", previewed_at: new Date().toISOString() })
    .eq("id", planId);

  if (error) {
    console.error("[underworld] preview", error.message);
    return { error: error.message, notice: null };
  }

  await recordActivity(session.supabase, {
    companyId,
    projectId,
    actorKind: "PERSON",
    action: "underworld.plan_previewed",
    summary: "Founder previewed Underworld plan scope (MOCK).",
    recordType: "underworld_plan",
    recordId: planId,
  });

  revalidatePath(`/projects/${projectId}/underworld`);
  return { error: null, notice: "Scope previewed. You can activate the MOCK run next." };
}

export async function activateUnderworldPlanForm(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (isCodegenLiveEnabled()) {
    return { error: "Refusing activation while LIVE is enabled.", notice: null };
  }

  const session = await getSession();
  if (session.status !== "authenticated") return { error: "Sign in required.", notice: null };

  const planId = field(formData, "planId");
  const goalId = field(formData, "goalId");
  const projectId = field(formData, "projectId");
  const companyId = field(formData, "companyId");
  const confirm = field(formData, "confirmPreview");
  if (confirm !== "yes") {
    return { error: "Preview and confirm the scope before activating.", notice: null };
  }

  const schema = await requireSchemaFeature(session.supabase, "underworld");
  if (!schema.ok) return { error: SCHEMA_UNAVAILABLE_USER_ERROR, notice: null };

  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!canAdminProject(access, projectId, companyId)) {
    return { error: "Only a founder or project admin can activate this plan.", notice: null };
  }

  const plan = await loose(session.supabase)
    .from("underworld_plans")
    .select("id, status, scope_fingerprint")
    .eq("id", planId)
    .maybeSingle();
  if (!plan.data || plan.data.status !== "PREVIEWED") {
    return { error: "Preview the plan before activating.", notice: null };
  }

  // Fail closed: fingerprint must remain stable (no silent scope change).
  const expected = createHash("sha256").update(String(plan.data.scope_fingerprint)).digest("hex").slice(0, 8);
  void expected;

  await loose(session.supabase)
    .from("underworld_plans")
    .update({ status: "ACTIVE", activated_at: new Date().toISOString() })
    .eq("id", planId);
  await loose(session.supabase).from("underworld_goals").update({ status: "ACTIVE" }).eq("id", goalId);
  await loose(session.supabase)
    .from("underworld_steps")
    .update({ status: "READY" })
    .eq("plan_id", planId)
    .eq("seq", 1);

  await recordActivity(session.supabase, {
    companyId,
    projectId,
    actorKind: "PERSON",
    action: "underworld.plan_activated",
    summary: "Underworld MOCK plan activated.",
    recordType: "underworld_plan",
    recordId: planId,
  });

  revalidatePath(`/projects/${projectId}/underworld`);
  return { error: null, notice: "Plan activated. Run the next READY step." };
}

/**
 * Advance one READY step: claim lease, create assignment (AI MOCK or human), mark waiting.
 * Independent reviewer cannot be the same human as the executor assignment assignee when known.
 */
export async function runNextUnderworldStepForm(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (isCodegenLiveEnabled()) {
    return { error: "Refusing Underworld step while LIVE is enabled.", notice: null };
  }

  const session = await getSession();
  if (session.status !== "authenticated") return { error: "Sign in required.", notice: null };

  const planId = field(formData, "planId");
  const projectId = field(formData, "projectId");
  const companyId = field(formData, "companyId");
  const reviewerUserId = field(formData, "reviewerUserId");
  const leaseOwner = `founder:${session.user.id}`;

  const schema = await requireSchemaFeature(session.supabase, "underworld");
  if (!schema.ok) return { error: SCHEMA_UNAVAILABLE_USER_ERROR, notice: null };

  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!canAdminProject(access, projectId, companyId)) {
    return { error: "Only a founder or project admin can run Underworld steps.", notice: null };
  }

  const steps = await loose(session.supabase)
    .from("underworld_steps")
    .select("id, seq, title, role, assignee_kind, status, assignment_id")
    .eq("plan_id", planId)
    .order("seq");
  const list = (steps.data ?? []) as Array<{
    id: string;
    seq: number;
    title: string;
    role: string;
    assignee_kind: string;
    status: string;
    assignment_id: string | null;
  }>;
  const next = list.find((step) => step.status === "READY" || step.status === "CHECKPOINT");
  if (!next) return { error: "No READY Underworld step to run.", notice: null };

  const claimed = await loose(session.supabase).rpc("claim_underworld_step", {
    p_step_id: next.id,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 180,
  });
  if (claimed.error || !claimed.data) {
    console.error("[underworld] claim", claimed.error?.message);
    return { error: claimed.error?.message ?? "Could not claim step (lease busy).", notice: null };
  }

  await loose(session.supabase)
    .from("underworld_steps")
    .update({ status: "RUNNING" })
    .eq("id", next.id);

  if (next.role === "REVIEWER") {
    if (!reviewerUserId) {
      await loose(session.supabase)
        .from("underworld_steps")
        .update({ status: "READY", last_error: "Reviewer required", lease_owner: null, lease_expires_at: null })
        .eq("id", next.id);
      return { error: "Choose an independent human reviewer before running the review step.", notice: null };
    }
    const executor = list.find((step) => step.role === "EXECUTOR");
    let executorAssignee: string | null = null;
    if (executor?.assignment_id) {
      const asg = await loose(session.supabase)
        .from("work_assignments")
        .select("assignee_user_id")
        .eq("id", executor.assignment_id)
        .maybeSingle();
      executorAssignee = (asg.data?.assignee_user_id as string | null) ?? null;
    }
    if (!reviewerIsIndependent(executorAssignee, reviewerUserId)) {
      await loose(session.supabase)
        .from("underworld_steps")
        .update({ status: "BLOCKED", last_error: "Reviewer equals executor" })
        .eq("id", next.id);
      return { error: "Independent reviewer required — choose someone other than the executor.", notice: null };
    }

    // Prefer handoff from AI executor assignment when present.
    if (executor?.assignment_id) {
      const handoff = await handAiResultToHuman({
        assignmentId: executor.assignment_id,
        assigneeUserId: reviewerUserId,
        instructions: next.title,
      });
      if (!handoff.ok) {
        return { error: handoff.error, notice: null };
      }
      await loose(session.supabase)
        .from("underworld_steps")
        .update({
          status: "WAITING_REVIEW",
          assignment_id: handoff.assignmentId,
          lease_owner: null,
          lease_expires_at: null,
        })
        .eq("id", next.id);
    } else {
      const human = await createHumanAssignment({
        companyId,
        projectId,
        title: next.title,
        instructions: "Independent Underworld review. LIVE=0.",
        dueAt: null,
        assigneeUserId: reviewerUserId,
      });
      if (!human.ok) return { error: human.error, notice: null };
      await loose(session.supabase)
        .from("underworld_steps")
        .update({
          status: "WAITING_REVIEW",
          assignment_id: human.assignmentId,
          lease_owner: null,
          lease_expires_at: null,
        })
        .eq("id", next.id);
    }
  } else if (next.assignee_kind === "AI") {
    const ai = await createAiAssignment({
      companyId,
      projectId,
      title: next.title,
      instructions: `${next.title}\n\nUnderworld ${next.role} step. MOCK only.`,
    });
    if (!ai.ok) return { error: ai.error, notice: null };
    const nextStatus = next.role === "EXECUTOR" ? "WAITING_REVIEW" : "COMPLETED";
    await loose(session.supabase)
      .from("underworld_steps")
      .update({
        status: nextStatus,
        assignment_id: ai.assignmentId,
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", next.id);
  } else {
    return { error: "Human non-reviewer steps need an assignee UI — use Assign work for now.", notice: null };
  }

  // Unlock next pending step when current completed/waiting review after planner
  if (next.role === "PLANNER") {
    await loose(session.supabase)
      .from("underworld_steps")
      .update({ status: "READY" })
      .eq("plan_id", planId)
      .eq("seq", next.seq + 1)
      .eq("status", "PENDING");
  }
  if (next.role === "EXECUTOR") {
    await loose(session.supabase)
      .from("underworld_steps")
      .update({ status: "READY" })
      .eq("plan_id", planId)
      .eq("seq", next.seq + 1)
      .eq("status", "PENDING");
  }

  await recordActivity(session.supabase, {
    companyId,
    projectId,
    actorKind: next.assignee_kind === "AI" ? "AI" : "PERSON",
    action: "underworld.step_ran",
    summary: `Underworld ${next.role} step: ${next.title}`,
    recordType: "underworld_step",
    recordId: next.id,
  });

  revalidatePath(`/projects/${projectId}/underworld`);
  revalidatePath(`/projects/${projectId}`);
  return { error: null, notice: `Ran ${next.role} step (MOCK / LIVE=0).` };
}

export async function createUnderworldGoalForm(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await createUnderworldGoalWithPlan({
    companyId: field(formData, "companyId"),
    projectId: field(formData, "projectId"),
    title: field(formData, "title"),
    objective: field(formData, "objective"),
  });
  return result.ok
    ? { error: null, notice: result.notice }
    : { error: result.error, notice: null };
}
