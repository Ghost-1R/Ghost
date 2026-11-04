import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Permission, TeamRole } from "@/lib/access/types";

type Client = SupabaseClient<Database>;

export type AccessContext = {
  userId: string;
  email: string | null;
  ownedCompanyIds: string[];
  memberships: Array<{
    companyId: string;
    role: TeamRole;
  }>;
  projectMemberships: Array<{
    projectId: string;
    companyId: string;
    role: TeamRole;
  }>;
  mapCompanyIds: string[];
};

export async function loadAccessContext(
  supabase: Client,
  userId: string,
  email: string | null,
): Promise<AccessContext> {
  const [owned, memberships, projectMemberships, mapGrants] = await Promise.all([
    supabase.from("companies").select("id").eq("owner_id", userId),
    supabase
      .from("company_memberships")
      .select("company_id, role")
      .eq("user_id", userId)
      .is("revoked_at", null),
    supabase
      .from("project_memberships")
      .select("project_id, role, projects!inner(company_id)")
      .eq("user_id", userId)
      .is("revoked_at", null),
    supabase
      .from("company_map_grants")
      .select("company_id")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .eq("can_view_summaries", true),
  ]);

  const projectRows = (projectMemberships.data ?? []).map((row) => {
    const projects = row.projects as unknown as { company_id: string } | { company_id: string }[] | null;
    const companyId = Array.isArray(projects)
      ? projects[0]?.company_id
      : projects?.company_id;
    return {
      projectId: row.project_id as string,
      companyId: companyId ?? "",
      role: row.role as TeamRole,
    };
  });

  return {
    userId,
    email,
    ownedCompanyIds: (owned.data ?? []).map((row) => row.id as string),
    memberships: (memberships.data ?? []).map((row) => ({
      companyId: row.company_id as string,
      role: row.role as TeamRole,
    })),
    projectMemberships: projectRows.filter((row) => row.companyId),
    mapCompanyIds: (mapGrants.data ?? []).map((row) => row.company_id as string),
  };
}

export function isFounder(access: AccessContext): boolean {
  return access.ownedCompanyIds.length > 0;
}

export function isCompanyOwner(access: AccessContext, companyId: string): boolean {
  return access.ownedCompanyIds.includes(companyId);
}

export function companyRole(access: AccessContext, companyId: string): TeamRole | "FOUNDER" | null {
  if (isCompanyOwner(access, companyId)) return "FOUNDER";
  return access.memberships.find((row) => row.companyId === companyId)?.role ?? null;
}

export function canAdminCompany(access: AccessContext, companyId: string): boolean {
  const role = companyRole(access, companyId);
  return role === "FOUNDER" || role === "PROJECT_ADMIN";
}

export function canSelectCompany(access: AccessContext, companyId: string): boolean {
  return companyRole(access, companyId) !== null;
}

export function canSelectProject(access: AccessContext, projectId: string, companyId: string): boolean {
  if (isCompanyOwner(access, companyId)) return true;
  if (access.memberships.some((row) => row.companyId === companyId && row.role === "PROJECT_ADMIN")) {
    return true;
  }
  return access.projectMemberships.some((row) => row.projectId === projectId);
}

export function canAdminProject(access: AccessContext, projectId: string, companyId: string): boolean {
  if (isCompanyOwner(access, companyId)) return true;
  if (access.memberships.some((row) => row.companyId === companyId && row.role === "PROJECT_ADMIN")) {
    return true;
  }
  return access.projectMemberships.some(
    (row) => row.projectId === projectId && row.role === "PROJECT_ADMIN",
  );
}

export function canViewMap(access: AccessContext, companyId: string): boolean {
  return isCompanyOwner(access, companyId) || access.mapCompanyIds.includes(companyId);
}

export function hasPermission(
  access: AccessContext,
  permission: Permission,
  scope?: { companyId?: string; projectId?: string },
): boolean {
  const companyId = scope?.companyId;
  const projectId = scope?.projectId;

  switch (permission) {
    case "settings.read":
    case "settings.write":
      return isFounder(access);
    case "company.manage":
    case "team.invite":
    case "team.revoke":
    case "team.preview":
    case "map.grant":
      return companyId ? isCompanyOwner(access, companyId) : isFounder(access);
    case "company.read":
      return companyId ? canSelectCompany(access, companyId) : access.ownedCompanyIds.length + access.memberships.length > 0;
    case "project.admin":
      return companyId && projectId ? canAdminProject(access, projectId, companyId) : false;
    case "project.read":
      return companyId && projectId ? canSelectProject(access, projectId, companyId) : false;
    case "assignment.create":
    case "assignment.review":
      return companyId && projectId ? canAdminProject(access, projectId, companyId) : false;
    case "assignment.submit":
      return Boolean(projectId);
    case "map.view":
      return companyId ? canViewMap(access, companyId) : false;
    default:
      return false;
  }
}

/** Surfaces a teammate may open — founders keep full nav. */
export function navPermissions(access: AccessContext): {
  showCompanies: boolean;
  showTeam: boolean;
  showMyWork: boolean;
  showSettings: boolean;
  showProjects: boolean;
} {
  const founder = isFounder(access);
  return {
    showCompanies: founder || access.memberships.length > 0,
    showTeam: founder,
    showMyWork: !founder || access.projectMemberships.length > 0 || access.memberships.length > 0,
    showSettings: founder,
    showProjects: true,
  };
}
