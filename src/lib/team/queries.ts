import type { GhostClient } from "@/lib/auth/session";
import type { AssignmentKind, AssignmentStatus, TeamRole } from "@/lib/access/types";
import { fromError, type QueryResult } from "@/lib/result";

export type InvitationRow = {
  id: string;
  companyId: string;
  email: string;
  role: TeamRole;
  projectIds: string[];
  token: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
};

export type MembershipRow = {
  id: string;
  companyId: string;
  userId: string;
  role: TeamRole;
  displayName: string | null;
  projectNames: string[];
  createdAt: string;
};

export type MyWorkAssignment = {
  id: string;
  companyId: string;
  projectId: string;
  projectName: string;
  kind: AssignmentKind;
  status: AssignmentStatus;
  title: string;
  instructions: string;
  dueAt: string | null;
  submissionNote: string;
  reviewNote: string;
};

export type AssignedProject = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  role: TeamRole | "ADMIN_VIA_COMPANY";
};

export type MyWork = {
  assignments: MyWorkAssignment[];
  projects: AssignedProject[];
};

/** Invitations the caller can see (owners see all for their companies). Newest first. */
export async function listInvitations(
  supabase: GhostClient,
  companyId?: string,
): Promise<QueryResult<InvitationRow[]>> {
  let query = supabase
    .from("team_invitations")
    .select("id, company_id, email, role, project_ids, token, status, expires_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (companyId) query = query.eq("company_id", companyId);

  const { data, error } = await query;
  if (error) return fromError(error);

  const now = Date.now();
  return {
    status: "ok",
    data: (data ?? []).map((row) => ({
      id: row.id,
      companyId: row.company_id,
      email: row.email,
      role: row.role,
      projectIds: row.project_ids,
      token: row.token,
      status:
        row.status === "PENDING" && new Date(row.expires_at).getTime() < now ? "EXPIRED" : row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })),
  };
}

/** Active (non-revoked) company memberships visible to the caller. */
export async function listMemberships(
  supabase: GhostClient,
  companyId?: string,
): Promise<QueryResult<MembershipRow[]>> {
  let query = supabase
    .from("company_memberships")
    .select("id, company_id, user_id, role, created_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (companyId) query = query.eq("company_id", companyId);

  const { data, error } = await query;
  if (error) return fromError(error);
  const rows = data ?? [];
  if (rows.length === 0) return { status: "ok", data: [] };

  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const [profiles, projectLinks] = await Promise.all([
    supabase.from("profiles").select("id, display_name").in("id", userIds),
    supabase
      .from("project_memberships")
      .select("user_id, project_id")
      .in("user_id", userIds)
      .is("revoked_at", null),
  ]);

  const names = new Map((profiles.data ?? []).map((row) => [row.id, row.display_name]));

  const projectIds = [...new Set((projectLinks.data ?? []).map((row) => row.project_id))];
  const projectNames = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projects } = await supabase.from("projects").select("id, name").in("id", projectIds);
    for (const project of projects ?? []) projectNames.set(project.id, project.name);
  }

  const byUser = new Map<string, string[]>();
  for (const link of projectLinks.data ?? []) {
    const name = projectNames.get(link.project_id);
    if (!name) continue;
    byUser.set(link.user_id, [...(byUser.get(link.user_id) ?? []), name]);
  }

  return {
    status: "ok",
    data: rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      userId: row.user_id,
      role: row.role,
      displayName: names.get(row.user_id) ?? null,
      projectNames: byUser.get(row.user_id) ?? [],
      createdAt: row.created_at,
    })),
  };
}

/** Assignments and projects for the signed-in teammate. */
export async function loadMyWork(
  supabase: GhostClient,
  userId: string,
): Promise<QueryResult<MyWork>> {
  const [assignmentsResult, projectLinks, companyLinks] = await Promise.all([
    supabase
      .from("work_assignments")
      .select(
        "id, company_id, project_id, kind, status, title, instructions, due_at, submission_note, review_note",
      )
      .eq("assignee_user_id", userId)
      .neq("status", "CANCELLED")
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("project_memberships")
      .select("project_id, role")
      .eq("user_id", userId)
      .is("revoked_at", null),
    supabase
      .from("company_memberships")
      .select("company_id, role")
      .eq("user_id", userId)
      .is("revoked_at", null),
  ]);

  if (assignmentsResult.error) return fromError(assignmentsResult.error);
  if (projectLinks.error) return fromError(projectLinks.error);
  if (companyLinks.error) return fromError(companyLinks.error);

  const assignmentRows = assignmentsResult.data ?? [];
  const adminCompanyIds = (companyLinks.data ?? [])
    .filter((row) => row.role === "PROJECT_ADMIN")
    .map((row) => row.company_id);

  const projectRole = new Map<string, AssignedProject["role"]>();
  for (const link of projectLinks.data ?? []) projectRole.set(link.project_id, link.role);

  const projectsById = new Map<string, { id: string; name: string; company_id: string }>();
  const wantedProjectIds = [
    ...new Set([...projectRole.keys(), ...assignmentRows.map((row) => row.project_id)]),
  ];
  if (wantedProjectIds.length > 0) {
    const { data } = await supabase
      .from("projects")
      .select("id, name, company_id")
      .in("id", wantedProjectIds);
    for (const project of data ?? []) projectsById.set(project.id, project);
  }
  if (adminCompanyIds.length > 0) {
    const { data } = await supabase
      .from("projects")
      .select("id, name, company_id")
      .in("company_id", adminCompanyIds);
    for (const project of data ?? []) {
      projectsById.set(project.id, project);
      if (!projectRole.has(project.id)) projectRole.set(project.id, "ADMIN_VIA_COMPANY");
    }
  }

  const companyIds = [...new Set([...projectsById.values()].map((project) => project.company_id))];
  const companyNames = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data } = await supabase.from("companies").select("id, name").in("id", companyIds);
    for (const company of data ?? []) companyNames.set(company.id, company.name);
  }

  const projects: AssignedProject[] = [...projectRole.entries()]
    .flatMap(([projectId, role]) => {
      const project = projectsById.get(projectId);
      return project
        ? [
            {
              id: project.id,
              name: project.name,
              companyId: project.company_id,
              companyName: companyNames.get(project.company_id) ?? "",
              role,
            },
          ]
        : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    status: "ok",
    data: {
      assignments: assignmentRows.map((row) => ({
        id: row.id,
        companyId: row.company_id,
        projectId: row.project_id,
        projectName: projectsById.get(row.project_id)?.name ?? "Project",
        kind: row.kind,
        status: row.status,
        title: row.title,
        instructions: row.instructions,
        dueAt: row.due_at,
        submissionNote: row.submission_note,
        reviewNote: row.review_note,
      })),
      projects,
    },
  };
}
