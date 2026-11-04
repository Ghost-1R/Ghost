import type { GhostClient } from "@/lib/auth/session";
import { CATALOG_COMPANIES, type CompanyKind } from "@/lib/access/types";
import type { ProjectStatus } from "@/lib/domain/status";
import { fromError, type QueryResult } from "@/lib/result";

const MISSING_SCHEMA = /does not exist|schema cache|could not find/i;

export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  kind: CompanyKind;
  description: string;
  siteUrl: string | null;
  isCatalog: boolean;
  isOwner: boolean;
  projectCount: number;
  memberCount: number;
};

export type CompanyProject = {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  currentMilestone: string;
  openTasks: number;
};

export type CompanySiteLink = {
  id: string;
  label: string;
  url: string;
  connected: boolean;
};

export type CompanyActivity = {
  id: string;
  projectId: string | null;
  actorKind: "PERSON" | "AI" | "SYSTEM";
  actorLabel: string;
  summary: string;
  externalUnconnected: boolean;
  createdAt: string;
};

export type CompanyDetail = {
  company: CompanySummary;
  projects: CompanyProject[];
  openTaskCount: number;
  siteLinks: CompanySiteLink[];
  /** Real rows when the activity table exists; otherwise an empty stub. */
  activity: CompanyActivity[];
  activityAvailable: boolean;
  memberships: { active: number; pendingInvitations: number };
};

function catalogOrder(slug: string): number {
  const index = CATALOG_COMPANIES.findIndex((entry) => entry.slug === slug);
  return index === -1 ? CATALOG_COMPANIES.length : index;
}

type CompanyRow = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string;
  kind?: CompanyKind;
  site_url?: string | null;
  is_catalog?: boolean;
};

function toSummary(
  row: CompanyRow,
  userId: string,
  projectCount: number,
  memberCount: number,
): CompanySummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind ?? "OPERATING",
    description: row.description,
    siteUrl: row.site_url ?? null,
    isCatalog: row.is_catalog ?? false,
    isOwner: row.owner_id === userId,
    projectCount,
    memberCount,
  };
}

async function selectCompanies(
  supabase: GhostClient,
  filter?: { id: string },
): Promise<{ rows: CompanyRow[] } | { error: string }> {
  const full = "id, owner_id, name, slug, description, kind, site_url, is_catalog";
  const legacy = "id, owner_id, name, slug, description";

  let query = supabase.from("companies").select(full).order("name", { ascending: true });
  if (filter) query = query.eq("id", filter.id);
  let result = await query;

  if (result.error && MISSING_SCHEMA.test(result.error.message)) {
    // TODO types: migration 20261104210000 not applied yet — fall back to base columns.
    let legacyQuery = supabase.from("companies").select(legacy).order("name", { ascending: true });
    if (filter) legacyQuery = legacyQuery.eq("id", filter.id);
    result = (await legacyQuery) as unknown as typeof result;
  }

  if (result.error) return { error: result.error.message };
  return { rows: (result.data ?? []) as CompanyRow[] };
}

async function countActiveMembers(supabase: GhostClient): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await supabase
    .from("company_memberships")
    .select("company_id")
    .is("revoked_at", null);
  if (error) return counts; // soft-fail: table missing or not visible
  for (const row of data ?? []) {
    counts.set(row.company_id, (counts.get(row.company_id) ?? 0) + 1);
  }
  return counts;
}

/** Companies visible to the signed-in user (RLS scopes owners and members). */
export async function loadCompaniesForUser(
  supabase: GhostClient,
  userId: string,
): Promise<QueryResult<CompanySummary[]>> {
  const [companies, projects, members] = await Promise.all([
    selectCompanies(supabase),
    supabase.from("projects").select("id, company_id"),
    countActiveMembers(supabase),
  ]);

  if ("error" in companies) return { status: "error", message: companies.error };
  if (projects.error) return fromError(projects.error);

  const projectCounts = new Map<string, number>();
  for (const project of projects.data ?? []) {
    projectCounts.set(project.company_id, (projectCounts.get(project.company_id) ?? 0) + 1);
  }

  const summaries = companies.rows.map((row) =>
    toSummary(row, userId, projectCounts.get(row.id) ?? 0, members.get(row.id) ?? 0),
  );

  summaries.sort((a, b) => {
    const byCatalog = catalogOrder(a.slug) - catalogOrder(b.slug);
    return byCatalog !== 0 ? byCatalog : a.name.localeCompare(b.name);
  });

  return { status: "ok", data: summaries };
}

export async function loadCompanyDetail(
  supabase: GhostClient,
  userId: string,
  companyId: string,
): Promise<QueryResult<CompanyDetail | null>> {
  const companies = await selectCompanies(supabase, { id: companyId });
  if ("error" in companies) return { status: "error", message: companies.error };
  const row = companies.rows[0];
  if (!row) return { status: "ok", data: null };

  const [projectsResult, linksResult, activityResult, membersResult, invitesResult] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, description, status, current_milestone")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("company_site_links")
        .select("id, label, url, connected")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true }),
      supabase
        .from("project_activity_events")
        .select("id, project_id, actor_kind, actor_label, summary, external_unconnected, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("company_memberships")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .is("revoked_at", null),
      supabase
        .from("team_invitations")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "PENDING"),
    ]);

  if (projectsResult.error) return fromError(projectsResult.error);

  const projectRows = projectsResult.data ?? [];
  const openTasks = new Map<string, number>();
  if (projectRows.length > 0) {
    const { data: actions } = await supabase
      .from("next_actions")
      .select("project_id, status")
      .in(
        "project_id",
        projectRows.map((project) => project.id),
      );
    for (const action of actions ?? []) {
      if (action.status === "OPEN" || action.status === "IN_PROGRESS" || action.status === "BLOCKED") {
        openTasks.set(action.project_id, (openTasks.get(action.project_id) ?? 0) + 1);
      }
    }
  }

  const projects: CompanyProject[] = projectRows.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    currentMilestone: project.current_milestone,
    openTasks: openTasks.get(project.id) ?? 0,
  }));

  const activityAvailable = !activityResult.error;
  const activity: CompanyActivity[] = (activityResult.data ?? []).map((event) => ({
    id: event.id,
    projectId: event.project_id,
    actorKind: event.actor_kind,
    actorLabel: event.actor_label,
    summary: event.summary,
    externalUnconnected: event.external_unconnected,
    createdAt: event.created_at,
  }));

  return {
    status: "ok",
    data: {
      company: toSummary(row, userId, projects.length, membersResult.count ?? 0),
      projects,
      openTaskCount: projects.reduce((sum, project) => sum + project.openTasks, 0),
      siteLinks: linksResult.error ? [] : (linksResult.data ?? []),
      activity,
      activityAvailable,
      memberships: {
        active: membersResult.count ?? 0,
        pendingInvitations: invitesResult.count ?? 0,
      },
    },
  };
}
