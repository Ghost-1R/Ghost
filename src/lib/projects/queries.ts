import type { GhostClient } from "@/lib/auth/session";
import { seedLifecycleFromProjectStatus } from "@/lib/lifecycle/stages";
import type {
  ActionProvenance,
  ActionStatus,
  BlockerStatus,
  KnowledgeKind,
  LifecycleStage,
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
  lifecycleStage: LifecycleStage;
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
  lifecycleStage: LifecycleStage;
  repositoryUrl: string | null;
  repositoryProvider: string | null;
  repositoryBranch: string | null;
  repositoryCommit: string | null;
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
  provenance: ActionProvenance;
  requiresDecision: boolean;
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
  "id, name, description, current_milestone, status, lifecycle_stage" as const;

export async function loadProjectSummaries(
  supabase: GhostClient,
): Promise<QueryResult<ProjectSummary[]>> {
  const [projectsResult, blockersResult, actionsResult] = await Promise.all([
    supabase.from("projects").select(PROJECT_LIST_COLUMNS).order("updated_at", { ascending: false }),
    supabase.from("blockers").select("project_id, status"),
    supabase
      .from("next_actions")
      .select("project_id, title, status, position, provenance")
      .order("position", { ascending: true }),
  ]);

  let projects = projectsResult;
  if (projects.error && /lifecycle_stage/.test(projects.error.message)) {
    projects = (await supabase
      .from("projects")
      .select("id, name, description, current_milestone, status")
      .order("updated_at", { ascending: false })) as typeof projectsResult;
  }

  if (projects.error) {
    return fromError(projects.error);
  }
  if (blockersResult.error) {
    return fromError(blockersResult.error);
  }

  let actions = actionsResult;
  if (actions.error && /provenance/.test(actions.error.message)) {
    actions = (await supabase
      .from("next_actions")
      .select("project_id, title, status, position")
      .order("position", { ascending: true })) as typeof actionsResult;
  }
  if (actions.error) {
    return fromError(actions.error);
  }

  const openBlockers = new Map<string, number>();
  for (const blocker of blockersResult.data) {
    if (blocker.status !== "OPEN") {
      continue;
    }
    openBlockers.set(blocker.project_id, (openBlockers.get(blocker.project_id) ?? 0) + 1);
  }

  const nextAction = new Map<string, string>();
  for (const action of actions.data) {
    const provenance = "provenance" in action ? action.provenance : "FOUNDER_APPROVED_ACTION";
    if (
      (action.status === "OPEN" || action.status === "IN_PROGRESS" || action.status === "BLOCKED") &&
      provenance !== "RECOMMENDATION" &&
      !nextAction.has(action.project_id)
    ) {
      nextAction.set(action.project_id, action.title);
    }
  }

  return {
    status: "ok",
    data: projects.data.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      currentMilestone: project.current_milestone,
      status: project.status,
      lifecycleStage:
        "lifecycle_stage" in project && typeof project.lifecycle_stage === "string"
          ? (project.lifecycle_stage as LifecycleStage)
          : seedLifecycleFromProjectStatus(project.status),
      openBlockers: openBlockers.get(project.id) ?? 0,
      nextAction: nextAction.get(project.id) ?? null,
    })),
  };
}

export async function loadProjectDetail(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<ProjectDetail | null>> {
  let result = await supabase
    .from("projects")
    .select("id, name, slug, description, current_milestone, status, lifecycle_stage, repository_url, repository_provider, repository_branch, repository_commit, updated_at")
    .eq("id", projectId)
    .maybeSingle();

  if (result.error && /lifecycle_stage/.test(result.error.message)) {
    result = (await supabase
      .from("projects")
      .select("id, name, slug, description, current_milestone, status, repository_url, repository_provider, repository_branch, repository_commit, updated_at")
      .eq("id", projectId)
      .maybeSingle()) as typeof result;
  }

  if (result.error) {
    return fromError(result.error);
  }

  if (!result.data) {
    return { status: "ok", data: null };
  }

  const data = result.data;
  return {
    status: "ok",
    data: {
      id: data.id,
      name: data.name,
      slug: data.slug,
      description: data.description,
      currentMilestone: data.current_milestone,
      status: data.status,
      lifecycleStage:
        "lifecycle_stage" in data && typeof data.lifecycle_stage === "string"
          ? (data.lifecycle_stage as LifecycleStage)
          : seedLifecycleFromProjectStatus(data.status),
      repositoryUrl: data.repository_url,
      repositoryProvider: data.repository_provider,
      repositoryBranch: data.repository_branch,
      repositoryCommit: data.repository_commit,
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
  let result = await supabase
    .from("next_actions")
    .select("id, title, description, status, position, provenance, requires_decision")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (result.error && /provenance|requires_decision/.test(result.error.message)) {
    result = (await supabase
      .from("next_actions")
      .select("id, title, description, status, position")
      .eq("project_id", projectId)
      .order("position", { ascending: true })) as typeof result;
  }

  if (result.error) {
    return fromError(result.error);
  }

  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      position: row.position,
      provenance: "provenance" in row && row.provenance ? row.provenance : "FOUNDER_APPROVED_ACTION",
      requiresDecision: "requires_decision" in row ? Boolean(row.requires_decision) : false,
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
