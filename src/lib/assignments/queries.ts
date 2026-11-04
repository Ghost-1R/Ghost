import type { GhostClient } from "@/lib/auth/session";
import { isMissingRelation, loose } from "@/lib/db/loose";
import { fromError, type QueryResult } from "@/lib/result";
import {
  ASSIGNMENT_COLUMNS,
  mapAssignmentRow,
  type AssignmentRow,
} from "@/lib/assignments/types";

export async function listAssignmentsForProject(
  supabase: GhostClient,
  projectId: string,
  options?: { limit?: number },
): Promise<QueryResult<AssignmentRow[]>> {
  const { data, error } = await loose(supabase)
    .from("work_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 50);

  if (error) {
    if (isMissingRelation(error.message)) return { status: "ok", data: [] };
    return fromError(error);
  }
  return {
    status: "ok",
    data: ((data ?? []) as Record<string, unknown>[]).map(mapAssignmentRow),
  };
}

export async function listAssignmentsForAssignee(
  supabase: GhostClient,
  assigneeUserId: string,
  options?: { limit?: number; includeClosed?: boolean },
): Promise<QueryResult<AssignmentRow[]>> {
  let query = loose(supabase)
    .from("work_assignments")
    .select(`${ASSIGNMENT_COLUMNS}, projects(name)`)
    .eq("assignee_user_id", assigneeUserId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 50);
  if (!options?.includeClosed) {
    query = query.not("status", "in", "(COMPLETED,CANCELLED)");
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error.message)) return { status: "ok", data: [] };
    return fromError(error);
  }
  return {
    status: "ok",
    data: ((data ?? []) as Record<string, unknown>[]).map(mapAssignmentRow),
  };
}

export type AssignPanelProject = {
  id: string;
  name: string;
  companyId: string;
  tasks: Array<{ id: string; title: string }>;
};

export type AssignPanelTeammate = {
  userId: string;
  label: string;
  role: "PROJECT_ADMIN" | "TEAM_MEMBER";
  companyId: string;
};

/**
 * Options for AssignWorkPanel. Never throws: when the migration is not applied the
 * panel simply receives no teammates (Ghost AI remains available).
 */
export async function loadAssignPanelData(
  supabase: GhostClient,
  options?: { projectIds?: string[]; taskLimit?: number },
): Promise<{ projects: AssignPanelProject[]; teammates: AssignPanelTeammate[] }> {
  const client = loose(supabase);
  let projectQuery = client.from("projects").select("id, name, company_id").order("name");
  if (options?.projectIds?.length) projectQuery = projectQuery.in("id", options.projectIds);
  const projectRows = await projectQuery.limit(100);
  const projects = ((projectRows.data ?? []) as Array<{ id: string; name: string; company_id: string }>).map(
    (row) => ({ id: row.id, name: row.name, companyId: row.company_id, tasks: [] as AssignPanelProject["tasks"] }),
  );
  if (projects.length === 0) return { projects, teammates: [] };

  const projectIds = projects.map((project) => project.id);
  const companyIds = [...new Set(projects.map((project) => project.companyId))];

  const [actions, memberships] = await Promise.all([
    client
      .from("next_actions")
      .select("id, project_id, title, status")
      .in("project_id", projectIds)
      .not("status", "in", "(DONE,CANCELLED)")
      .order("position")
      .limit(options?.taskLimit ?? 300),
    client
      .from("company_memberships")
      .select("user_id, company_id, role")
      .in("company_id", companyIds)
      .is("revoked_at", null),
  ]);

  const byProject = new Map(projects.map((project) => [project.id, project]));
  for (const row of (actions.data ?? []) as Array<{ id: string; project_id: string; title: string }>) {
    byProject.get(row.project_id)?.tasks.push({ id: row.id, title: row.title });
  }

  const memberRows = memberships.error
    ? []
    : ((memberships.data ?? []) as Array<{
        user_id: string;
        company_id: string;
        role: "PROJECT_ADMIN" | "TEAM_MEMBER";
      }>);
  if (memberRows.length === 0) return { projects, teammates: [] };

  const profiles = await client
    .from("profiles")
    .select("id, display_name")
    .in("id", [...new Set(memberRows.map((row) => row.user_id))]);
  const names = new Map<string, string>();
  for (const row of (profiles.data ?? []) as Array<{ id: string; display_name: string | null }>) {
    if (row.display_name?.trim()) names.set(row.id, row.display_name.trim());
  }

  const teammates = memberRows.map((row) => ({
    userId: row.user_id,
    companyId: row.company_id,
    role: row.role,
    label: names.get(row.user_id) ?? `Team member ${row.user_id.slice(0, 6)}`,
  }));
  return { projects, teammates };
}
