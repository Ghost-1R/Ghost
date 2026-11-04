"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { hasPermission, isCompanyOwner, loadAccessContext, canViewMap } from "@/lib/access/permissions";
import type { AccessContext } from "@/lib/access/permissions";
import { recordActivity } from "@/lib/activity/record";
import { getSession, type GhostClient } from "@/lib/auth/session";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { buildWorkerAssignmentPreview } from "@/lib/dashboard/day-plan";
import { isUuid, loose } from "@/lib/db/loose";
import { loadAgentTaskSurface } from "@/lib/operations/agent-task-surface";
import { runMockAssignmentReview } from "@/lib/assignments/mock-run";
import {
  ASSIGNMENT_COLUMNS,
  mapAssignmentRow,
  sanitizeMapScope,
  type AssignmentResult,
  type AssignmentRow,
  type CreateAiAssignmentInput,
  type CreateHumanAssignmentInput,
  type MapScope,
} from "@/lib/assignments/types";
import {
  canCompleteReview,
  canHandOff,
  canSubmitForReview,
  canUpdateProgress,
  nextStatusAfterReview,
  validateAssignmentText,
  type ReviewDecision,
} from "@/lib/assignments/workflow";

type AuthedSession = {
  supabase: GhostClient;
  userId: string;
  email: string | null;
  access: AccessContext;
};

async function requireSession(): Promise<AuthedSession | { error: string }> {
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "Sign in required." };
  const access = await loadAccessContext(session.supabase, session.user.id, session.user.email);
  return { supabase: session.supabase, userId: session.user.id, email: session.user.email, access };
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function revalidateAssignmentSurfaces(projectId: string, companyId: string) {
  revalidatePath("/dashboard");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/companies/${companyId}/map`);
}

/** Project must exist, be visible to the caller, and belong to the claimed company. */
async function verifyProjectScope(
  supabase: GhostClient,
  projectId: string,
  companyId: string,
  nextActionId: string | null | undefined,
): Promise<{ ok: true; projectName: string } | { ok: false; error: string }> {
  if (!isUuid(projectId) || !isUuid(companyId)) {
    return { ok: false, error: "Choose a valid project." };
  }
  const project = await loose(supabase)
    .from("projects")
    .select("id, name, company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (project.error || !project.data) return { ok: false, error: "Project was not found." };
  if (project.data.company_id !== companyId) {
    return { ok: false, error: "Project does not belong to this company." };
  }
  if (nextActionId) {
    if (!isUuid(nextActionId)) return { ok: false, error: "Task reference is not valid." };
    const action = await loose(supabase)
      .from("next_actions")
      .select("id")
      .eq("id", nextActionId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (action.error || !action.data) return { ok: false, error: "Task is not part of this project." };
  }
  return { ok: true, projectName: String(project.data.name ?? "Project") };
}

/** Assignee must be the company owner or hold an active company/project membership. */
async function verifyAssignee(
  supabase: GhostClient,
  projectId: string,
  companyId: string,
  assigneeUserId: string,
): Promise<boolean> {
  if (!isUuid(assigneeUserId)) return false;
  const client = loose(supabase);
  const [company, companyMember, projectMember] = await Promise.all([
    client.from("companies").select("owner_id").eq("id", companyId).maybeSingle(),
    client
      .from("company_memberships")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", assigneeUserId)
      .is("revoked_at", null)
      .maybeSingle(),
    client
      .from("project_memberships")
      .select("id")
      .eq("project_id", projectId)
      .eq("user_id", assigneeUserId)
      .is("revoked_at", null)
      .maybeSingle(),
  ]);
  return (
    company.data?.owner_id === assigneeUserId ||
    Boolean(companyMember.data?.id) ||
    Boolean(projectMember.data?.id)
  );
}

function checkMapScopeAccess(
  access: AccessContext,
  companyId: string,
  mapScope: MapScope | null | undefined,
): { ok: true; scope: MapScope | null } | { ok: false; error: string } {
  if (!mapScope) return { ok: true, scope: null };
  const scope = sanitizeMapScope(mapScope);
  if (!scope) return { ok: false, error: "Select a state, ZIP area, or radius first." };
  if (!canViewMap(access, companyId)) {
    return { ok: false, error: "You do not have access to this company's sales map." };
  }
  return { ok: true, scope };
}

async function insertAssignment(
  supabase: GhostClient,
  row: Record<string, unknown>,
): Promise<{ ok: true; assignment: AssignmentRow } | { ok: false; error: string }> {
  const { data, error } = await loose(supabase)
    .from("work_assignments")
    .insert(row)
    .select(ASSIGNMENT_COLUMNS)
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: /work_assignments|schema cache|does not exist/i.test(error?.message ?? "")
        ? "Assignments are not available on this database yet. Apply the companies/team/assignments migration."
        : (error?.message ?? "Assignment was not saved."),
    };
  }
  return { ok: true, assignment: mapAssignmentRow(data as Record<string, unknown>) };
}

async function loadAssignment(
  supabase: GhostClient,
  assignmentId: string,
): Promise<AssignmentRow | null> {
  if (!isUuid(assignmentId)) return null;
  const { data, error } = await loose(supabase)
    .from("work_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("id", assignmentId)
    .maybeSingle();
  if (error || !data) return null;
  return mapAssignmentRow(data as Record<string, unknown>);
}

function isAdminFor(access: AccessContext, assignment: AssignmentRow): boolean {
  return hasPermission(access, "assignment.create", {
    companyId: assignment.companyId,
    projectId: assignment.projectId,
  });
}

async function updateAssignment(
  supabase: GhostClient,
  assignmentId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true; assignment: AssignmentRow } | { ok: false; error: string }> {
  const { data, error } = await loose(supabase)
    .from("work_assignments")
    .update(patch)
    .eq("id", assignmentId)
    .select(ASSIGNMENT_COLUMNS)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Assignment could not be updated (not allowed or not found)." };
  return { ok: true, assignment: mapAssignmentRow(data as Record<string, unknown>) };
}

/** Human teammate assignment. Requires assignment.create on the project. */
export async function createHumanAssignment(
  input: CreateHumanAssignmentInput,
): Promise<AssignmentResult> {
  const ctx = await requireSession();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const text = validateAssignmentText(input);
  if (!text.ok) return text;

  if (!hasPermission(ctx.access, "assignment.create", { companyId: input.companyId, projectId: input.projectId })) {
    return { ok: false, error: "Only a founder or project admin can assign work on this project." };
  }
  const scopeCheck = checkMapScopeAccess(ctx.access, input.companyId, input.mapScope);
  if (!scopeCheck.ok) return scopeCheck;

  const scope = await verifyProjectScope(ctx.supabase, input.projectId, input.companyId, input.nextActionId);
  if (!scope.ok) return scope;
  if (!(await verifyAssignee(ctx.supabase, input.projectId, input.companyId, input.assigneeUserId))) {
    return { ok: false, error: "Choose a team member who has access to this project." };
  }

  const inserted = await insertAssignment(ctx.supabase, {
    company_id: input.companyId,
    project_id: input.projectId,
    next_action_id: input.nextActionId || null,
    kind: "HUMAN",
    status: "ASSIGNED",
    title: text.title,
    instructions: text.instructions,
    due_at: text.dueAt,
    assignee_user_id: input.assigneeUserId,
    assigned_by: ctx.userId,
    map_scope: scopeCheck.scope,
  });
  if (!inserted.ok) return inserted;

  await recordActivity(ctx.supabase, {
    companyId: input.companyId,
    projectId: input.projectId,
    actorKind: "PERSON",
    action: "assignment.created",
    summary: `Assigned “${text.title}” to a team member on ${scope.projectName}.`,
    recordType: "work_assignment",
    recordId: inserted.assignment.id,
    metadata: {
      kind: "HUMAN",
      assigneeUserId: input.assigneeUserId,
      hasMapScope: Boolean(scopeCheck.scope),
    },
  });

  revalidateAssignmentSurfaces(input.projectId, input.companyId);
  return { ok: true, assignmentId: inserted.assignment.id, notice: "Assigned to your teammate." };
}

/**
 * Ghost AI assignment — MOCK only. Reuses the day-plan test-review path
 * (buildWorkerAssignmentPreview + bounded mock worker turns). Refuses while LIVE is on
 * and never calls a paid provider.
 */
export async function createAiAssignment(input: CreateAiAssignmentInput): Promise<AssignmentResult> {
  if (isCodegenLiveEnabled()) {
    return { ok: false, error: "AI assignments are refused while LIVE is enabled." };
  }
  const ctx = await requireSession();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const text = validateAssignmentText({ ...input, dueAt: null });
  if (!text.ok) return text;

  if (!hasPermission(ctx.access, "assignment.create", { companyId: input.companyId, projectId: input.projectId })) {
    return { ok: false, error: "Only a founder or project admin can assign work on this project." };
  }
  const scopeCheck = checkMapScopeAccess(ctx.access, input.companyId, input.mapScope);
  if (!scopeCheck.ok) return scopeCheck;

  const scope = await verifyProjectScope(ctx.supabase, input.projectId, input.companyId, input.nextActionId);
  if (!scope.ok) return scope;

  // Same task resolution the Today "Assign worker" preview uses.
  const surface = await loadAgentTaskSurface(ctx.supabase, { limit: 24 });
  const preview = buildWorkerAssignmentPreview({
    scope: { mode: "project", projectId: input.projectId, projectName: scope.projectName },
    agentTasks: surface.status === "ok" ? surface.data : [],
  });

  const inserted = await insertAssignment(ctx.supabase, {
    company_id: input.companyId,
    project_id: input.projectId,
    next_action_id: input.nextActionId || null,
    agent_task_id: preview.taskId,
    kind: "AI",
    status: "ASSIGNED",
    title: text.title,
    instructions: text.instructions,
    assignee_user_id: null,
    assigned_by: ctx.userId,
    map_scope: scopeCheck.scope,
  });
  if (!inserted.ok) return inserted;
  let assignment = inserted.assignment;

  await recordActivity(ctx.supabase, {
    companyId: input.companyId,
    projectId: input.projectId,
    actorKind: "PERSON",
    action: "assignment.created",
    summary: `Assigned “${text.title}” to Ghost AI on ${scope.projectName} (MOCK test run).`,
    recordType: "work_assignment",
    recordId: assignment.id,
    metadata: { kind: "AI", mode: "MOCK_GENERATION", liveHttpInvoked: false, chargedCents: 0 },
  });

  let notice: string;
  if (!preview.taskId) {
    notice =
      "Saved for Ghost AI. No worker task exists on this project yet, so nothing ran and nothing was charged ($0).";
  } else {
    const run = await runMockAssignmentReview({
      supabase: ctx.supabase,
      ownerId: ctx.userId,
      projectId: input.projectId,
      taskId: preview.taskId,
      assignmentId: assignment.id,
    });
    if (!run.ok) {
      notice = `Saved for Ghost AI, but the test run did not start: ${run.error}`;
    } else {
      const updated = await updateAssignment(ctx.supabase, assignment.id, {
        status: run.completed ? "SUBMITTED" : "IN_PROGRESS",
        progress_note: run.notice,
        submission_note: run.completed ? run.summary : "",
        submitted_at: run.completed ? new Date().toISOString() : null,
      });
      if (updated.ok) assignment = updated.assignment;
      notice = run.completed
        ? "Ghost AI finished a test run. Review the result before handing it on. $0 charged."
        : "Ghost AI started a test run. $0 charged.";
      await recordActivity(ctx.supabase, {
        companyId: input.companyId,
        projectId: input.projectId,
        actorKind: "AI",
        action: run.completed ? "assignment.ai_submitted" : "assignment.ai_progress",
        summary: run.summary,
        recordType: "work_assignment",
        recordId: assignment.id,
        metadata: { mode: "MOCK_GENERATION", liveHttpInvoked: false, chargedCents: 0 },
      });
    }
  }

  revalidateAssignmentSurfaces(input.projectId, input.companyId);
  return { ok: true, assignmentId: assignment.id, notice };
}

export async function updateAssignmentProgress(input: {
  assignmentId: string;
  progressNote: string;
}): Promise<AssignmentResult> {
  const ctx = await requireSession();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const assignment = await loadAssignment(ctx.supabase, input.assignmentId);
  if (!assignment) return { ok: false, error: "Assignment was not found." };

  const isAssignee = assignment.assigneeUserId === ctx.userId;
  if (!isAssignee && !isAdminFor(ctx.access, assignment)) {
    return { ok: false, error: "Only the assignee or a project admin can update progress." };
  }
  if (!canUpdateProgress(assignment.status)) {
    return { ok: false, error: `Progress cannot be updated while the assignment is ${assignment.status.toLowerCase().replace("_", " ")}.` };
  }
  const note = input.progressNote.trim().slice(0, 4000);

  const updated = await updateAssignment(ctx.supabase, assignment.id, {
    status: "IN_PROGRESS",
    progress_note: note,
  });
  if (!updated.ok) return updated;

  await recordActivity(ctx.supabase, {
    companyId: assignment.companyId,
    projectId: assignment.projectId,
    actorKind: "PERSON",
    action: "assignment.progress",
    summary: `Progress on “${assignment.title}”${note ? `: ${note.slice(0, 160)}` : "."}`,
    recordType: "work_assignment",
    recordId: assignment.id,
  });
  revalidateAssignmentSurfaces(assignment.projectId, assignment.companyId);
  return { ok: true, assignmentId: assignment.id, notice: "Progress saved." };
}

export async function submitAssignmentForReview(input: {
  assignmentId: string;
  submissionNote: string;
}): Promise<AssignmentResult> {
  const ctx = await requireSession();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const assignment = await loadAssignment(ctx.supabase, input.assignmentId);
  if (!assignment) return { ok: false, error: "Assignment was not found." };

  if (assignment.kind === "AI") {
    return { ok: false, error: "Ghost AI assignments are submitted by the test run itself." };
  }
  if (assignment.assigneeUserId !== ctx.userId && !isAdminFor(ctx.access, assignment)) {
    return { ok: false, error: "Only the assignee or a project admin can submit this work." };
  }
  if (!canSubmitForReview(assignment.status)) {
    return { ok: false, error: "This assignment is not in a state that can be submitted." };
  }
  const note = input.submissionNote.trim().slice(0, 8000);
  if (!note) return { ok: false, error: "Add a short note on what you finished." };

  const updated = await updateAssignment(ctx.supabase, assignment.id, {
    status: "SUBMITTED",
    submission_note: note,
    submitted_at: new Date().toISOString(),
  });
  if (!updated.ok) return updated;

  await recordActivity(ctx.supabase, {
    companyId: assignment.companyId,
    projectId: assignment.projectId,
    actorKind: "PERSON",
    action: "assignment.submitted",
    summary: `Submitted “${assignment.title}” for review.`,
    recordType: "work_assignment",
    recordId: assignment.id,
  });
  revalidateAssignmentSurfaces(assignment.projectId, assignment.companyId);
  return { ok: true, assignmentId: assignment.id, notice: "Submitted for review." };
}

export async function completeAssignmentReview(input: {
  assignmentId: string;
  decision: ReviewDecision;
  reviewNote: string;
}): Promise<AssignmentResult> {
  const ctx = await requireSession();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const assignment = await loadAssignment(ctx.supabase, input.assignmentId);
  if (!assignment) return { ok: false, error: "Assignment was not found." };

  if (
    !hasPermission(ctx.access, "assignment.review", {
      companyId: assignment.companyId,
      projectId: assignment.projectId,
    })
  ) {
    return { ok: false, error: "Only a founder or project admin can review this work." };
  }
  if (
    assignment.assigneeUserId === ctx.userId &&
    !isCompanyOwner(ctx.access, assignment.companyId)
  ) {
    return { ok: false, error: "You cannot review your own work." };
  }
  if (input.decision !== "APPROVE" && input.decision !== "REQUEST_CHANGES") {
    return { ok: false, error: "Choose approve or request changes." };
  }
  if (!canCompleteReview(assignment.status)) {
    return { ok: false, error: "This assignment has not been submitted for review." };
  }
  const note = input.reviewNote.trim().slice(0, 4000);
  if (input.decision === "REQUEST_CHANGES" && !note) {
    return { ok: false, error: "Say what needs to change." };
  }

  const updated = await updateAssignment(ctx.supabase, assignment.id, {
    status: nextStatusAfterReview(input.decision),
    review_note: note,
    reviewed_by: ctx.userId,
    reviewed_at: new Date().toISOString(),
  });
  if (!updated.ok) return updated;

  const approved = input.decision === "APPROVE";
  await recordActivity(ctx.supabase, {
    companyId: assignment.companyId,
    projectId: assignment.projectId,
    actorKind: "PERSON",
    action: approved ? "assignment.review_approved" : "assignment.review_changes_requested",
    summary: approved
      ? `Approved “${assignment.title}”.`
      : `Requested changes on “${assignment.title}”.`,
    recordType: "work_assignment",
    recordId: assignment.id,
  });
  revalidateAssignmentSurfaces(assignment.projectId, assignment.companyId);
  return {
    ok: true,
    assignmentId: assignment.id,
    notice: approved ? "Review complete — work approved." : "Changes requested.",
  };
}

/**
 * Hand a finished AI result to a teammate: creates a HUMAN assignment linked through
 * handed_off_from_assignment_id and records activity on both assignments.
 */
export async function handAiResultToHuman(input: {
  assignmentId: string;
  assigneeUserId: string;
  instructions: string;
}): Promise<AssignmentResult<{ assignmentId: string; sourceAssignmentId: string }>> {
  const ctx = await requireSession();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const source = await loadAssignment(ctx.supabase, input.assignmentId);
  if (!source) return { ok: false, error: "Assignment was not found." };

  if (!isAdminFor(ctx.access, source)) {
    return { ok: false, error: "Only a founder or project admin can hand off AI results." };
  }
  if (!canHandOff(source.kind, source.status)) {
    return { ok: false, error: "Only a submitted Ghost AI result can be handed to a teammate." };
  }
  if (!(await verifyAssignee(ctx.supabase, source.projectId, source.companyId, input.assigneeUserId))) {
    return { ok: false, error: "Choose a team member who has access to this project." };
  }

  const guidance = input.instructions.trim();
  const instructions = [
    guidance,
    source.submissionNote ? `Ghost AI result:\n${source.submissionNote}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000);
  const text = validateAssignmentText({ title: `Follow up: ${source.title}`.slice(0, 200), instructions });
  if (!text.ok) return text;

  const inserted = await insertAssignment(ctx.supabase, {
    company_id: source.companyId,
    project_id: source.projectId,
    next_action_id: source.nextActionId,
    kind: "HUMAN",
    status: "ASSIGNED",
    title: text.title,
    instructions: text.instructions,
    assignee_user_id: input.assigneeUserId,
    assigned_by: ctx.userId,
    handed_off_from_assignment_id: source.id,
    map_scope: source.mapScope,
  });
  if (!inserted.ok) return inserted;

  await Promise.all([
    recordActivity(ctx.supabase, {
      companyId: source.companyId,
      projectId: source.projectId,
      actorKind: "PERSON",
      action: "assignment.ai_handed_off",
      summary: `Handed Ghost AI result “${source.title}” to a teammate.`,
      recordType: "work_assignment",
      recordId: source.id,
      metadata: { handedOffToAssignmentId: inserted.assignment.id },
    }),
    recordActivity(ctx.supabase, {
      companyId: source.companyId,
      projectId: source.projectId,
      actorKind: "PERSON",
      action: "assignment.created",
      summary: `Assigned “${text.title}” to a team member (from Ghost AI result).`,
      recordType: "work_assignment",
      recordId: inserted.assignment.id,
      metadata: { kind: "HUMAN", handedOffFromAssignmentId: source.id },
    }),
  ]);

  revalidateAssignmentSurfaces(source.projectId, source.companyId);
  return {
    ok: true,
    assignmentId: inserted.assignment.id,
    sourceAssignmentId: source.id,
    notice: "AI result handed to your teammate.",
  };
}

/**
 * Form entry used by AssignWorkPanel. The company is derived from the project on the
 * server so a tampered companyId can never widen scope.
 */
export async function submitAssignWorkForm(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (field(formData, "previewConfirmed") !== "yes") {
    return { error: "Preview the assignment and confirm before submitting.", notice: null };
  }
  const session = await getSession();
  if (session.status !== "authenticated") return { error: "Sign in required.", notice: null };

  const projectId = field(formData, "projectId");
  if (!isUuid(projectId)) return { error: "Choose a project.", notice: null };
  const project = await loose(session.supabase)
    .from("projects")
    .select("company_id")
    .eq("id", projectId)
    .maybeSingle();
  const companyId = project.data?.company_id as string | undefined;
  if (!companyId) return { error: "Project was not found.", notice: null };

  let mapScope: MapScope | null = null;
  const mapScopeJson = field(formData, "mapScopeJson");
  if (mapScopeJson) {
    try {
      mapScope = sanitizeMapScope(JSON.parse(mapScopeJson));
    } catch {
      mapScope = null;
    }
    if (!mapScope) return { error: "Select a state, ZIP area, or radius first.", notice: null };
  }

  const common = {
    projectId,
    companyId,
    nextActionId: field(formData, "nextActionId") || null,
    title: field(formData, "title"),
    instructions: field(formData, "instructions"),
    mapScope,
  };

  const result =
    field(formData, "assignKind") === "AI"
      ? await createAiAssignment(common)
      : await createHumanAssignment({
          ...common,
          dueAt: field(formData, "dueAt") || null,
          assigneeUserId: field(formData, "assigneeUserId"),
        });

  return result.ok
    ? { error: null, notice: result.notice }
    : { error: result.error, notice: null };
}

export async function handAiResultToHumanForm(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await handAiResultToHuman({
    assignmentId: field(formData, "assignmentId"),
    assigneeUserId: field(formData, "assigneeUserId"),
    instructions: field(formData, "instructions"),
  });
  return result.ok
    ? { error: null, notice: result.notice }
    : { error: result.error, notice: null };
}

export async function completeAssignmentReviewForm(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const decisionRaw = field(formData, "decision");
  const decision = decisionRaw === "REQUEST_CHANGES" ? "REQUEST_CHANGES" : "APPROVE";
  const result = await completeAssignmentReview({
    assignmentId: field(formData, "assignmentId"),
    decision,
    reviewNote: field(formData, "reviewNote"),
  });
  return result.ok
    ? { error: null, notice: result.notice }
    : { error: result.error, notice: null };
}
