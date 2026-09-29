import type { GhostClient } from "@/lib/auth/session";
import type {
  FounderRuleStatus,
  KnowledgeKind,
  MemoryProposalStatus,
  MemoryScope,
  ProjectStatus,
} from "@/lib/domain/status";
import { fromError, type QueryResult } from "@/lib/result";

export type FounderRuleRecord = {
  id: string;
  title: string;
  content: string;
  provenance: string;
  status: FounderRuleStatus;
  originProjectId: string | null;
  approvedAt: string | null;
  updatedAt: string;
};

export type ProjectKnowledgeRecord = {
  id: string;
  projectId: string;
  projectName: string;
  kind: KnowledgeKind;
  title: string;
  content: string;
  source: string;
};

export type MemoryProposalRecord = {
  id: string;
  projectId: string | null;
  scope: MemoryScope;
  title: string;
  content: string;
  provenance: string;
  status: MemoryProposalStatus;
  createdAt: string;
};

export type DecisionItem = {
  id: string;
  kind: "proposal" | "project";
  title: string;
  detail: string;
  href: string;
};

export async function loadFounderRules(
  supabase: GhostClient,
): Promise<QueryResult<FounderRuleRecord[]>> {
  const { data, error } = await supabase
    .from("founder_rules")
    .select("id, title, content, provenance, status, origin_project_id, approved_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    return fromError(error);
  }

  return {
    status: "ok",
    data: data.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      provenance: row.provenance,
      status: row.status,
      originProjectId: row.origin_project_id,
      approvedAt: row.approved_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function loadProjectKnowledge(
  supabase: GhostClient,
): Promise<QueryResult<ProjectKnowledgeRecord[]>> {
  const [knowledgeResult, projectsResult] = await Promise.all([
    supabase
      .from("project_knowledge")
      .select("id, project_id, kind, title, content, source")
      .order("created_at", { ascending: false }),
    supabase.from("projects").select("id, name"),
  ]);

  if (knowledgeResult.error) {
    return fromError(knowledgeResult.error);
  }
  if (projectsResult.error) {
    return fromError(projectsResult.error);
  }

  const names = new Map(projectsResult.data.map((project) => [project.id, project.name]));

  return {
    status: "ok",
    data: knowledgeResult.data.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: names.get(row.project_id) ?? "Unknown project",
      kind: row.kind,
      title: row.title,
      content: row.content,
      source: row.source,
    })),
  };
}

export async function loadMemoryProposals(
  supabase: GhostClient,
): Promise<QueryResult<MemoryProposalRecord[]>> {
  const { data, error } = await supabase
    .from("memory_proposals")
    .select("id, project_id, proposed_scope, title, content, provenance, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return fromError(error);
  }

  return {
    status: "ok",
    data: data.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      scope: row.proposed_scope,
      title: row.title,
      content: row.content,
      provenance: row.provenance,
      status: row.status,
      createdAt: row.created_at,
    })),
  };
}

export async function loadDecisionQueue(
  supabase: GhostClient,
): Promise<QueryResult<DecisionItem[]>> {
  const [proposalsResult, projectsResult] = await Promise.all([
    supabase
      .from("memory_proposals")
      .select("id, title, proposed_scope")
      .eq("status", "PENDING")
      .order("created_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, name, status")
      .eq("status", "NEEDS_DECISION")
      .order("updated_at", { ascending: false }),
  ]);

  if (proposalsResult.error) {
    return fromError(proposalsResult.error);
  }
  if (projectsResult.error) {
    return fromError(projectsResult.error);
  }

  const proposals: DecisionItem[] = proposalsResult.data.map((proposal) => ({
    id: proposal.id,
    kind: "proposal",
    title: proposal.title,
    detail: `Memory proposal · ${proposal.proposed_scope}`,
    href: "/memory",
  }));

  const projects: DecisionItem[] = projectsResult.data.map((project) => ({
    id: project.id,
    kind: "project",
    title: project.name,
    detail: project.status satisfies ProjectStatus,
    href: `/projects/${project.id}`,
  }));

  return { status: "ok", data: [...proposals, ...projects] };
}
