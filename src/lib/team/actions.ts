"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { isCompanyOwner } from "@/lib/access/permissions";
import { getAccessContext } from "@/lib/access/session-access";
import type { TeamRole } from "@/lib/access/types";
import { getSession } from "@/lib/auth/session";
import { recordActivitySoft } from "@/lib/team/activity";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: readonly TeamRole[] = ["PROJECT_ADMIN", "TEAM_MEMBER"];

type AuthedSession = Extract<Awaited<ReturnType<typeof getSession>>, { status: "authenticated" }>;

export type InviteResult =
  | {
      ok: true;
      invitationId: string;
      token: string;
      /** Relative path — prefix with the app origin when sharing. */
      inviteUrl: string;
      /** "test-link": real email skipped on purpose. "manual": no email transport exists, share the link. */
      delivery: "test-link" | "manual";
    }
  | { ok: false; error: string };

export type InviteFormState = ActionState & { inviteUrl: string | null };

export type SimpleResult = { ok: true } | { ok: false; error: string };

export type AcceptResult =
  | { ok: true; companyId: string }
  | { ok: false; error: string };

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function isTestInvite(email: string): boolean {
  return email.toLowerCase().endsWith("@ghost.local") || process.env.GHOST_TEST_INVITES === "1";
}

async function requireOwner(
  session: AuthedSession,
  companyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!isCompanyOwner(access, companyId)) {
    return { ok: false, error: "Only the company owner can manage the team." };
  }
  return { ok: true };
}

export async function inviteTeammate(input: {
  email: string;
  companyId: string;
  role: TeamRole;
  projectIds: string[];
}): Promise<InviteResult> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { ok: false, error: "You are not signed in." };
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!ROLES.includes(input.role)) {
    return { ok: false, error: "Choose a role." };
  }
  if (!input.companyId) {
    return { ok: false, error: "Choose a company." };
  }

  const owner = await requireOwner(session, input.companyId);
  if (!owner.ok) return owner;

  const requested = [...new Set(input.projectIds.filter(Boolean))];
  let projectIds: string[] = [];
  if (requested.length > 0) {
    const { data, error } = await session.supabase
      .from("projects")
      .select("id")
      .eq("company_id", input.companyId)
      .in("id", requested);
    if (error) return { ok: false, error: error.message };
    projectIds = (data ?? []).map((row) => row.id);
    if (projectIds.length !== requested.length) {
      return { ok: false, error: "Some selected projects do not belong to this company." };
    }
  }
  if (input.role === "TEAM_MEMBER" && projectIds.length === 0) {
    return { ok: false, error: "Pick at least one project for a team member." };
  }

  // One live invitation per email and company: a re-invite supersedes the old link.
  const { error: supersedeError } = await session.supabase
    .from("team_invitations")
    .update({ status: "REVOKED", revoked_at: new Date().toISOString() })
    .eq("company_id", input.companyId)
    .eq("email", email)
    .eq("status", "PENDING");
  if (supersedeError) return { ok: false, error: supersedeError.message };

  const token = randomBytes(32).toString("base64url");
  const { data: created, error } = await session.supabase
    .from("team_invitations")
    .insert({
      company_id: input.companyId,
      email,
      role: input.role,
      project_ids: projectIds,
      token,
      invited_by: session.user.id,
    })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, error: error?.message ?? "Invitation was not created." };
  }

  await recordActivitySoft(session.supabase, {
    companyId: input.companyId,
    action: "invitation.sent",
    summary: `Invited ${email} as ${input.role === "PROJECT_ADMIN" ? "project admin" : "team member"}`,
    recordType: "team_invitation",
    recordId: created.id,
    metadata: { projectCount: projectIds.length },
  });

  revalidatePath("/team");

  // Ghost has no email transport yet. Test invites skip email on purpose;
  // real addresses get the same link to share by hand rather than a fake "sent".
  return {
    ok: true,
    invitationId: created.id,
    token,
    inviteUrl: `/invites/${token}`,
    delivery: isTestInvite(email) ? "test-link" : "manual",
  };
}

export async function inviteTeammateAction(
  _previous: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const role = readField(formData, "role") as TeamRole;
  const result = await inviteTeammate({
    email: readField(formData, "email"),
    companyId: readField(formData, "companyId"),
    role,
    projectIds: formData.getAll("projectIds").filter((v): v is string => typeof v === "string"),
  });

  if (!result.ok) {
    return { error: result.error, notice: null, inviteUrl: null };
  }

  return {
    error: null,
    notice:
      result.delivery === "test-link"
        ? "Test invitation created. No email was sent — open the link below as the invitee."
        : "Invitation created. Ghost does not send email yet — share this link with the invitee.",
    inviteUrl: result.inviteUrl,
  };
}

export async function revokeMembership(membershipId: string): Promise<SimpleResult> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { ok: false, error: "You are not signed in." };
  }

  const { data: membership, error: readError } = await session.supabase
    .from("company_memberships")
    .select("id, company_id, user_id")
    .eq("id", membershipId)
    .is("revoked_at", null)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!membership) return { ok: false, error: "Membership was not found or is already revoked." };

  const owner = await requireOwner(session, membership.company_id);
  if (!owner.ok) return owner;

  const now = new Date().toISOString();
  const { error } = await session.supabase
    .from("company_memberships")
    .update({ revoked_at: now })
    .eq("id", membership.id);
  if (error) return { ok: false, error: error.message };

  const { data: projects } = await session.supabase
    .from("projects")
    .select("id")
    .eq("company_id", membership.company_id);
  const projectIds = (projects ?? []).map((row) => row.id);
  if (projectIds.length > 0) {
    const { error: projectError } = await session.supabase
      .from("project_memberships")
      .update({ revoked_at: now })
      .eq("user_id", membership.user_id)
      .in("project_id", projectIds)
      .is("revoked_at", null);
    if (projectError) return { ok: false, error: projectError.message };
  }

  await recordActivitySoft(session.supabase, {
    companyId: membership.company_id,
    action: "membership.revoked",
    summary: "Teammate access revoked",
    recordType: "company_membership",
    recordId: membership.id,
  });

  revalidatePath("/team");
  return { ok: true };
}

export async function revokeInvitation(invitationId: string): Promise<SimpleResult> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { ok: false, error: "You are not signed in." };
  }

  const { data: invitation, error: readError } = await session.supabase
    .from("team_invitations")
    .select("id, company_id, email, status")
    .eq("id", invitationId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!invitation) return { ok: false, error: "Invitation was not found." };
  if (invitation.status !== "PENDING") {
    return { ok: false, error: "Only pending invitations can be revoked." };
  }

  const owner = await requireOwner(session, invitation.company_id);
  if (!owner.ok) return owner;

  const { error } = await session.supabase
    .from("team_invitations")
    .update({ status: "REVOKED", revoked_at: new Date().toISOString() })
    .eq("id", invitation.id)
    .eq("status", "PENDING");
  if (error) return { ok: false, error: error.message };

  await recordActivitySoft(session.supabase, {
    companyId: invitation.company_id,
    action: "invitation.revoked",
    summary: `Invitation to ${invitation.email} revoked`,
    recordType: "team_invitation",
    recordId: invitation.id,
  });

  revalidatePath("/team");
  return { ok: true };
}

function teamRedirect(result: SimpleResult, notice: string): never {
  const params = new URLSearchParams(result.ok ? { notice } : { error: result.error });
  redirect(`/team?${params.toString()}`);
}

/** <form action> wrapper: revoke an active membership, then return to /team. */
export async function revokeMembershipForm(formData: FormData): Promise<void> {
  teamRedirect(await revokeMembership(readField(formData, "membershipId")), "Access revoked.");
}

/** <form action> wrapper: revoke a pending invitation, then return to /team. */
export async function revokeInvitationForm(formData: FormData): Promise<void> {
  teamRedirect(await revokeInvitation(readField(formData, "invitationId")), "Invitation revoked.");
}

const ACCEPT_ERRORS: Record<string, string> = {
  not_authenticated: "Sign in to accept this invitation.",
  not_found: "This invitation link is not valid.",
  accepted: "This invitation was already accepted.",
  revoked: "This invitation was revoked.",
  expired: "This invitation has expired.",
  email_mismatch: "This invitation was sent to a different email address. Sign in with that address.",
};

export async function acceptInvitation(token: string): Promise<AcceptResult> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { ok: false, error: ACCEPT_ERRORS.not_authenticated };
  }
  if (token.length < 24) {
    return { ok: false, error: ACCEPT_ERRORS.not_found };
  }

  // Invitees are not members yet, so RLS blocks direct writes. The RPC checks the
  // token and the verified email, then grants membership atomically.
  const { data, error } = await session.supabase.rpc("accept_team_invitation", { p_token: token });
  if (error) {
    if (/could not find the function|does not exist|schema cache/i.test(error.message)) {
      return {
        ok: false,
        error: "Invitations are not available yet: apply migration 20261104210100_team_invitation_rpcs.sql.",
      };
    }
    return { ok: false, error: error.message };
  }

  const payload = (data ?? {}) as { ok?: boolean; error?: string; company_id?: string };
  if (!payload.ok || !payload.company_id) {
    return { ok: false, error: ACCEPT_ERRORS[payload.error ?? ""] ?? "Invitation could not be accepted." };
  }

  revalidatePath("/team");
  revalidatePath("/companies");
  return { ok: true, companyId: payload.company_id };
}

export async function acceptInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await acceptInvitation(readField(formData, "token"));
  if (!result.ok) {
    return { error: result.error, notice: null };
  }
  redirect("/team/my-work?joined=1");
}

export async function submitForReviewAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "You are not signed in.", notice: null };
  }

  const assignmentId = readField(formData, "assignmentId");
  const note = readField(formData, "note");
  if (!assignmentId) return { error: "Assignment is required.", notice: null };
  if (note.length < 1 || note.length > 4000) {
    return { error: "Add a short note on what you finished (up to 4000 characters).", notice: null };
  }

  const { data: assignment, error: readError } = await session.supabase
    .from("work_assignments")
    .select("id, company_id, project_id, title, status, assignee_user_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (readError) return { error: readError.message, notice: null };
  if (!assignment || assignment.assignee_user_id !== session.user.id) {
    return { error: "This assignment is not assigned to you.", notice: null };
  }
  if (assignment.status !== "ASSIGNED" && assignment.status !== "IN_PROGRESS") {
    return { error: "Only open work can be submitted for review.", notice: null };
  }

  const { error } = await session.supabase
    .from("work_assignments")
    .update({
      status: "SUBMITTED",
      submission_note: note,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", assignment.id)
    .eq("assignee_user_id", session.user.id);
  if (error) return { error: error.message, notice: null };

  await recordActivitySoft(session.supabase, {
    companyId: assignment.company_id,
    projectId: assignment.project_id,
    action: "assignment.submitted",
    summary: `Submitted for review: ${assignment.title}`,
    recordType: "work_assignment",
    recordId: assignment.id,
  });

  revalidatePath("/team/my-work");
  return { error: null, notice: "Submitted for review." };
}
