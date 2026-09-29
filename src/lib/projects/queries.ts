import type { GhostClient } from "@/lib/auth/session";
import type {
  ActionStatus,
  BlockerStatus,
  KnowledgeKind,
  ProjectStatus,
  VerificationCategory,
  VerificationState,
} from "@/lib/domain/status";
import type { Json } from "@/lib/database.types";
import { fromError, type QueryResult } from "@/lib/result";

export type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  currentMilestone: string;
  status: ProjectStatus;
  openBlockers: number;
  nextAction: string | null;
};

export type ProjectDetail = {
  id: string;
  name: string;
  slug: string;
  description: string;
  currentMilestone: string;
  status: ProjectStatus;
  repositoryUrl: string | null;
  updatedAt: string;
};

export type MilestoneRecord = {
  id: string;
  title: string;
  description: string;
  status: ProjectStatus;
  position: number;
};

export type KnowledgeRecord = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  content: string;
  source: string;
};

export type BlockerRecord = {
  id: string;
  title: string;
  description: string;
  status: BlockerStatus;
  createdAt: string;
  resolvedAt: string | null;
};

export type NextActionRecord = {
  id: string;
  title: string;
  description: string;
  status: ActionStatus;
  position: number;
};

export type VerificationRecord = {
  id: string;
  category: VerificationCategory;
  target: string;
  state: VerificationState;
  evidence: Json;
  checkedAt: string | null;
};

const PROJECT_LIST_COLUMNS =
  "id, name, description, current_milestone, status" as const;

export async function loadProjectSummaries(
  supabase: GhostClient,
): Promise<QueryResult<ProjectSummary[]>> {
  const [projectsResult, blockersResult, actionsResult] = await Promise.all([
    supabase.from("projects").select(PROJECT_LIST_COLUMNS).order("updated_at", { ascending: false }),
    supabase.from("blockers").select("project_id, status"),
    supabase
      .from("next_actions")
      .select("project_id, title, status, position")
      .order("position", { ascending: true }),
  ]);

  if (projectsResult.error) {
    return fromError(projectsResult.error);
  }
  if (blockersResult.error) {
    return fromError(blockersResult.error);
  }
  if (actionsResult.error) {
    return fromError(actionsResult.error);
  }

  const openBlockers = new Map<string, number>();
  for (const blocker of blockersResult.data) {
    if (blocker.status !== "OPEN") {
      continue;
    }
    openBlockers.set(blocker.project_id, (openBlockers.get(blocker.project_id) ?? 0) + 1);
  }

  const nextAction = new Map<string, string>();
  for (const action of actionsResult.data) {
    if (action.status === "OPEN" && !nextAction.has(action.project_id)) {
      nextAction.set(action.project_id, action.title);
    }
  }

  return {
    status: "ok",
    data: projectsResult.data.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      currentMilestone: project.current_milestone,
      status: project.status,
      openBlockers: openBlockers.get(project.id) ?? 0,
      nextAction: nextAction.get(project.id) ?? null,
    })),
  };
}

export async function loadProjectDetail(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<ProjectDetail | null>> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, slug, description, current_milestone, status, repository_url, updated_at")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    return fromError(error);
  }

  if (!data) {
    return { status: "ok", data: null };
  }

  return {
    status: "ok",
    data: {
      id: data.id,
      name: data.name,
      slug: data.slug,
      description: data.description,
      currentMilestone: data.current_milestone,
      status: data.status,
      repositoryUrl: data.repository_url,
      updatedAt: data.updated_at,
    },
  };
}

export async function loadMilestones(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<MilestoneRecord[]>> {
  const { data, error } = await supabase
    .from("milestones")
    .select("id, title, description, status, position")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) {
    return fromError(error);
  }

  return {
    status: "ok",
    data: data.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      position: row.position,
    })),
  };
}

export async function loadKnowledge(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<KnowledgeRecord[]>> {
  const { data, error } = await supabase
    .from("project_knowledge")
    .select("id, kind, title, content, source")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    return fromError(error);
  }

  return { status: "ok", data };
}

export async function loadBlockers(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<BlockerRecord[]>> {
  const { data, error } = await supabase
    .from("blockers")
    .select("id, title, description, status, created_at, resolved_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    return fromError(error);
  }

  return {
    status: "ok",
    data: data.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    })),
  };
}

export async function loadNextActions(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<NextActionRecord[]>> {
  const { data, error } = await supabase
    .from("next_actions")
    .select("id, title, description, status, position")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) {
    return fromError(error);
  }

  return {
    status: "ok",
    data: data.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      position: row.position,
    })),
  };
}

export async function loadVerification(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<VerificationRecord[]>> {
  const { data, error } = await supabase
    .from("verification_records")
    .select("id, category, target, state, evidence, checked_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    return fromError(error);
  }

  return {
    status: "ok",
    data: data.map((row) => ({
      id: row.id,
      category: row.category,
      target: row.target,
      state: row.state,
      evidence: row.evidence,
      checkedAt: row.checked_at,
    })),
  };
}
