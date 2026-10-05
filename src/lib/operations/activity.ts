import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";

export type ActivityItem = {
  id: string;
  projectId: string;
  projectName: string;
  kind: "lifecycle" | "decision" | "next_action" | "verification";
  title: string;
  detail: string;
  at: string;
  href: string;
};

export async function loadRecentActivity(
  supabase: GhostClient,
  limit = 12,
): Promise<QueryResult<ActivityItem[]>> {
  const projects = await supabase.from("projects").select("id, name");
  if (projects.error) return fromError(projects.error);
  const names = new Map(projects.data.map((project) => [project.id, project.name]));
  const projectIds = projects.data.map((project) => project.id);
  if (projectIds.length === 0) return { status: "ok", data: [] };

  const [lifecycle, decisions, actions, verification] = await Promise.all([
    supabase
      .from("lifecycle_transitions")
      .select("id, project_id, from_stage, to_stage, actor, reason, changed_at")
      .in("project_id", projectIds)
      .order("changed_at", { ascending: false })
      .limit(limit),
    supabase
      .from("project_decisions")
      .select("id, project_id, title, status, selected_option, resolved_at, created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("next_actions")
      .select("id, project_id, title, status, provenance, completed_at, created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("verification_records")
      .select("id, project_id, category, target, state, checked_at, created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const items: ActivityItem[] = [];

  if (!lifecycle.error) {
    for (const row of lifecycle.data) {
      items.push({
        id: `life-${row.id}`,
        projectId: row.project_id,
        projectName: names.get(row.project_id) ?? "Project",
        kind: "lifecycle",
        title: `Lifecycle → ${row.to_stage}`,
        detail: row.from_stage
          ? `${row.from_stage} → ${row.to_stage}. ${row.reason}`
          : `Recorded as ${row.to_stage}. ${row.reason}`,
        at: row.changed_at,
        href: `/projects/${row.project_id}`,
      });
    }
  }

  if (!decisions.error) {
    for (const row of decisions.data) {
      if (!row.project_id) continue;
      items.push({
        id: `dec-${row.id}`,
        projectId: row.project_id,
        projectName: names.get(row.project_id) ?? "Project",
        kind: "decision",
        title:
          row.status === "OPEN"
            ? `Decision waiting: ${row.title}`
            : `Decision ${row.status.toLowerCase()}: ${row.title}`,
        detail: row.selected_option ? `Selected: ${row.selected_option}` : row.title,
        at: row.resolved_at ?? row.created_at,
        href: `/projects/${row.project_id}`,
      });
    }
  }

  if (!actions.error) {
    for (const row of actions.data) {
      if (row.status === "OPEN" && !row.completed_at) continue;
      items.push({
        id: `act-${row.id}`,
        projectId: row.project_id,
        projectName: names.get(row.project_id) ?? "Project",
        kind: "next_action",
        title: `Next action ${row.status.toLowerCase()}: ${row.title}`,
        detail: row.provenance,
        at: row.completed_at ?? row.created_at,
        href: `/projects/${row.project_id}`,
      });
    }
  }

  if (!verification.error) {
    for (const row of verification.data) {
      items.push({
        id: `ver-${row.id}`,
        projectId: row.project_id,
        projectName: names.get(row.project_id) ?? "Project",
        kind: "verification",
        title: `${row.category} · ${row.target}`,
        detail: `State: ${row.state}`,
        at: row.checked_at ?? row.created_at,
        href: `/projects/${row.project_id}`,
      });
    }
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { status: "ok", data: items.slice(0, limit) };
}
