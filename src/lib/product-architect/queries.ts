import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";
import {
  asStringList,
  type DependencyKind,
  type DependencyStatus,
  type FeatureStatus,
  type ProductArchitecture,
  type ProductArchitectureStatus,
  type ProductArchitectureTransition,
  type ProductDependency,
  type ProductFeature,
  type ProductFlow,
  type ProductPriority,
  type ProductQuestion,
  type ProductQuestionStatus,
  type ProductRequirement,
  type RequirementApproval,
  type RequirementType,
} from "./types";
import { nextHumanId } from "./workflow";

const ARCH_COLUMNS =
  "id, project_id, idea_id, strategy_id, what, why, who, outcome, non_goals, assumptions, risks, constraints_json, status, note, approved_at, approved_by, created_at, updated_at" as const;

function mapArchitecture(row: {
  id: string;
  project_id: string;
  idea_id: string | null;
  strategy_id: string | null;
  what: string;
  why: string;
  who: string;
  outcome: string;
  non_goals: unknown;
  assumptions: unknown;
  risks: unknown;
  constraints_json: unknown;
  status: ProductArchitectureStatus;
  note: string;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}): ProductArchitecture {
  return {
    id: row.id,
    projectId: row.project_id,
    ideaId: row.idea_id,
    strategyId: row.strategy_id,
    what: row.what,
    why: row.why,
    who: row.who,
    outcome: row.outcome,
    nonGoals: asStringList(row.non_goals),
    assumptions: asStringList(row.assumptions),
    risks: asStringList(row.risks),
    constraints: asStringList(row.constraints_json),
    status: row.status,
    note: row.note,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadProductArchitecture(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<ProductArchitecture | null>> {
  const result = await supabase.from("product_architectures").select(ARCH_COLUMNS).eq("project_id", projectId).maybeSingle();
  if (result.error) {
    if (/product_architectures|does not exist|schema cache/i.test(result.error.message)) {
      return { status: "ok", data: null };
    }
    return fromError(result.error);
  }
  return { status: "ok", data: result.data ? mapArchitecture(result.data) : null };
}

export async function ensureProductArchitecture(
  supabase: GhostClient,
  input: {
    projectId: string;
    ideaId?: string | null;
    strategyId?: string | null;
    what?: string;
    why?: string;
    who?: string;
    outcome?: string;
    nonGoals?: string[];
    assumptions?: string[];
    risks?: string[];
    constraints?: string[];
  },
): Promise<QueryResult<ProductArchitecture>> {
  const existing = await loadProductArchitecture(supabase, input.projectId);
  if (existing.status === "error") return existing;
  if (existing.data) return { status: "ok", data: existing.data };

  const inserted = await supabase
    .from("product_architectures")
    .insert({
      project_id: input.projectId,
      idea_id: input.ideaId ?? null,
      strategy_id: input.strategyId ?? null,
      what: input.what ?? "",
      why: input.why ?? "",
      who: input.who ?? "",
      outcome: input.outcome ?? "",
      non_goals: input.nonGoals ?? [],
      assumptions: input.assumptions ?? [],
      risks: input.risks ?? [],
      constraints_json: input.constraints ?? [],
      status: "DRAFT",
      note: "Initialized for Product Architect. Strategy fields are provenance seeds, not silent approvals.",
    })
    .select(ARCH_COLUMNS)
    .single();
  if (inserted.error) return fromError(inserted.error);

  await supabase.from("product_architecture_transitions").insert({
    architecture_id: inserted.data.id,
    from_status: null,
    to_status: "DRAFT",
    changed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    actor: "FOUNDER",
    reason: "Product Architect created for project.",
  });

  return { status: "ok", data: mapArchitecture(inserted.data) };
}

export async function updateProductDefinition(
  supabase: GhostClient,
  architectureId: string,
  patch: Partial<Pick<ProductArchitecture, "what" | "why" | "who" | "outcome" | "nonGoals" | "assumptions" | "risks" | "constraints" | "note">>,
): Promise<QueryResult<ProductArchitecture>> {
  const payload: {
    updated_at: string;
    what?: string;
    why?: string;
    who?: string;
    outcome?: string;
    non_goals?: string[];
    assumptions?: string[];
    risks?: string[];
    constraints_json?: string[];
    note?: string;
  } = { updated_at: new Date().toISOString() };
  if (patch.what !== undefined) payload.what = patch.what;
  if (patch.why !== undefined) payload.why = patch.why;
  if (patch.who !== undefined) payload.who = patch.who;
  if (patch.outcome !== undefined) payload.outcome = patch.outcome;
  if (patch.nonGoals !== undefined) payload.non_goals = patch.nonGoals;
  if (patch.assumptions !== undefined) payload.assumptions = patch.assumptions;
  if (patch.risks !== undefined) payload.risks = patch.risks;
  if (patch.constraints !== undefined) payload.constraints_json = patch.constraints;
  if (patch.note !== undefined) payload.note = patch.note;

  const updated = await supabase.from("product_architectures").update(payload).eq("id", architectureId).select(ARCH_COLUMNS).single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapArchitecture(updated.data) };
}

export async function recordProductArchitectureTransition(
  supabase: GhostClient,
  architectureId: string,
  toStatus: ProductArchitectureStatus,
  reason: string,
): Promise<QueryResult<ProductArchitectureTransition>> {
  const result = await supabase.rpc("record_product_architecture_transition", {
    target_architecture_id: architectureId,
    next_status: toStatus,
    transition_reason: reason,
    transition_actor: "FOUNDER",
  });
  if (result.error) return fromError(result.error);
  const row = result.data;
  return {
    status: "ok",
    data: {
      id: row.id,
      architectureId: row.architecture_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      actor: row.actor,
      reason: row.reason,
    },
  };
}

export async function loadProductArchitectureHistory(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<ProductArchitectureTransition[]>> {
  const result = await supabase
    .from("product_architecture_transitions")
    .select("id, architecture_id, from_status, to_status, changed_at, changed_by, actor, reason")
    .eq("architecture_id", architectureId)
    .order("changed_at", { ascending: false });
  if (result.error) {
    if (/product_architecture_transitions|does not exist/i.test(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      architectureId: row.architecture_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      actor: row.actor,
      reason: row.reason,
    })),
  };
}

function mapRequirement(row: {
  id: string;
  architecture_id: string;
  project_id: string;
  human_id: string;
  title: string;
  description: string;
  req_type: RequirementType;
  priority: ProductPriority;
  approval_status: RequirementApproval;
  acceptance_criteria: unknown;
  source: string;
  provenance: string;
  created_at: string;
  updated_at: string;
}): ProductRequirement {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    humanId: row.human_id,
    title: row.title,
    description: row.description,
    reqType: row.req_type,
    priority: row.priority,
    approvalStatus: row.approval_status,
    acceptanceCriteria: asStringList(row.acceptance_criteria),
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const REQ_COLUMNS =
  "id, architecture_id, project_id, human_id, title, description, req_type, priority, approval_status, acceptance_criteria, source, provenance, created_at, updated_at" as const;

export async function loadProductRequirements(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<ProductRequirement[]>> {
  const result = await supabase
    .from("product_requirements")
    .select(REQ_COLUMNS)
    .eq("architecture_id", architectureId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (/product_requirements|does not exist/i.test(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapRequirement) };
}

export async function createProductRequirement(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    title: string;
    description?: string;
    reqType?: RequirementType;
    priority?: ProductPriority;
    acceptanceCriteria?: string[];
    source?: string;
    provenance?: string;
    approvalStatus?: RequirementApproval;
  },
): Promise<QueryResult<ProductRequirement>> {
  const existing = await loadProductRequirements(supabase, input.architectureId);
  if (existing.status === "error") return existing;
  const humanId = nextHumanId(
    "REQ",
    existing.data.map((row) => row.humanId),
  );
  const inserted = await supabase
    .from("product_requirements")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      human_id: humanId,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      req_type: input.reqType ?? "FUNCTIONAL",
      priority: input.priority ?? "NORMAL",
      approval_status: input.approvalStatus ?? "PROPOSED",
      acceptance_criteria: input.acceptanceCriteria ?? [],
      source: input.source?.trim() || "founder",
      provenance: input.provenance?.trim() || "founder",
    })
    .select(REQ_COLUMNS)
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapRequirement(inserted.data) };
}

export async function updateProductRequirement(
  supabase: GhostClient,
  requirementId: string,
  patch: Partial<{
    title: string;
    description: string;
    reqType: RequirementType;
    priority: ProductPriority;
    approvalStatus: RequirementApproval;
    acceptanceCriteria: string[];
  }>,
): Promise<QueryResult<ProductRequirement>> {
  const payload: {
    updated_at: string;
    title?: string;
    description?: string;
    req_type?: RequirementType;
    priority?: ProductPriority;
    approval_status?: RequirementApproval;
    acceptance_criteria?: string[];
  } = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.reqType !== undefined) payload.req_type = patch.reqType;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.approvalStatus !== undefined) payload.approval_status = patch.approvalStatus;
  if (patch.acceptanceCriteria !== undefined) payload.acceptance_criteria = patch.acceptanceCriteria;
  const updated = await supabase.from("product_requirements").update(payload).eq("id", requirementId).select(REQ_COLUMNS).single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapRequirement(updated.data) };
}

const FEATURE_COLUMNS =
  "id, architecture_id, project_id, human_id, name, purpose, priority, status, acceptance_criteria, source, provenance, created_at, updated_at" as const;

function mapFeature(
  row: {
    id: string;
    architecture_id: string;
    project_id: string;
    human_id: string;
    name: string;
    purpose: string;
    priority: ProductPriority;
    status: FeatureStatus;
    acceptance_criteria: unknown;
    source: string;
    provenance: string;
    created_at: string;
    updated_at: string;
  },
  requirementIds: string[] = [],
): ProductFeature {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    humanId: row.human_id,
    name: row.name,
    purpose: row.purpose,
    priority: row.priority,
    status: row.status,
    acceptanceCriteria: asStringList(row.acceptance_criteria),
    requirementIds,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadProductFeatures(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<ProductFeature[]>> {
  const result = await supabase
    .from("product_features")
    .select(FEATURE_COLUMNS)
    .eq("architecture_id", architectureId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (/product_features|does not exist/i.test(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  const links = await supabase
    .from("product_feature_requirements")
    .select("feature_id, requirement_id")
    .in(
      "feature_id",
      result.data.map((row) => row.id),
    );
  const byFeature = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    const list = byFeature.get(link.feature_id) ?? [];
    list.push(link.requirement_id);
    byFeature.set(link.feature_id, list);
  }
  return {
    status: "ok",
    data: result.data.map((row) => mapFeature(row, byFeature.get(row.id) ?? [])),
  };
}

export async function createProductFeature(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    name: string;
    purpose?: string;
    priority?: ProductPriority;
    status?: FeatureStatus;
    acceptanceCriteria?: string[];
    requirementIds?: string[];
    source?: string;
    provenance?: string;
  },
): Promise<QueryResult<ProductFeature>> {
  const existing = await loadProductFeatures(supabase, input.architectureId);
  if (existing.status === "error") return existing;
  const humanId = nextHumanId(
    "FEAT",
    existing.data.map((row) => row.humanId),
  );
  const inserted = await supabase
    .from("product_features")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      human_id: humanId,
      name: input.name.trim(),
      purpose: input.purpose?.trim() ?? "",
      priority: input.priority ?? "NORMAL",
      status: input.status ?? "PROPOSED",
      acceptance_criteria: input.acceptanceCriteria ?? [],
      source: input.source?.trim() || "founder",
      provenance: input.provenance?.trim() || "founder",
    })
    .select(FEATURE_COLUMNS)
    .single();
  if (inserted.error) return fromError(inserted.error);
  if (input.requirementIds?.length) {
    await supabase.from("product_feature_requirements").insert(
      input.requirementIds.map((requirementId) => ({
        feature_id: inserted.data.id,
        requirement_id: requirementId,
      })),
    );
  }
  return { status: "ok", data: mapFeature(inserted.data, input.requirementIds ?? []) };
}

export async function updateProductFeature(
  supabase: GhostClient,
  featureId: string,
  patch: Partial<{
    name: string;
    purpose: string;
    priority: ProductPriority;
    status: FeatureStatus;
    acceptanceCriteria: string[];
    requirementIds: string[];
  }>,
): Promise<QueryResult<ProductFeature>> {
  const payload: {
    updated_at: string;
    name?: string;
    purpose?: string;
    priority?: ProductPriority;
    status?: FeatureStatus;
    acceptance_criteria?: string[];
  } = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.purpose !== undefined) payload.purpose = patch.purpose;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.acceptanceCriteria !== undefined) payload.acceptance_criteria = patch.acceptanceCriteria;
  const updated = await supabase.from("product_features").update(payload).eq("id", featureId).select(FEATURE_COLUMNS).single();
  if (updated.error) return fromError(updated.error);
  if (patch.requirementIds) {
    await supabase.from("product_feature_requirements").delete().eq("feature_id", featureId);
    if (patch.requirementIds.length) {
      await supabase.from("product_feature_requirements").insert(
        patch.requirementIds.map((requirementId) => ({
          feature_id: featureId,
          requirement_id: requirementId,
        })),
      );
    }
  }
  const links = await supabase.from("product_feature_requirements").select("requirement_id").eq("feature_id", featureId);
  return {
    status: "ok",
    data: mapFeature(
      updated.data,
      (links.data ?? []).map((row) => row.requirement_id),
    ),
  };
}

const FLOW_COLUMNS =
  "id, architecture_id, project_id, human_id, name, actor, starting_condition, steps, expected_outcome, edge_cases, feature_id, created_at, updated_at" as const;

function mapFlow(row: {
  id: string;
  architecture_id: string;
  project_id: string;
  human_id: string;
  name: string;
  actor: string;
  starting_condition: string;
  steps: unknown;
  expected_outcome: string;
  edge_cases: unknown;
  feature_id: string | null;
  created_at: string;
  updated_at: string;
}): ProductFlow {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    humanId: row.human_id,
    name: row.name,
    actor: row.actor,
    startingCondition: row.starting_condition,
    steps: asStringList(row.steps),
    expectedOutcome: row.expected_outcome,
    edgeCases: asStringList(row.edge_cases),
    featureId: row.feature_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadProductFlows(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<ProductFlow[]>> {
  const result = await supabase
    .from("product_flows")
    .select(FLOW_COLUMNS)
    .eq("architecture_id", architectureId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (/product_flows|does not exist/i.test(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapFlow) };
}

export async function createProductFlow(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    name: string;
    actor?: string;
    startingCondition?: string;
    steps?: string[];
    expectedOutcome?: string;
    edgeCases?: string[];
    featureId?: string | null;
  },
): Promise<QueryResult<ProductFlow>> {
  const existing = await loadProductFlows(supabase, input.architectureId);
  if (existing.status === "error") return existing;
  const humanId = nextHumanId(
    "FLOW",
    existing.data.map((row) => row.humanId),
  );
  const inserted = await supabase
    .from("product_flows")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      human_id: humanId,
      name: input.name.trim(),
      actor: input.actor?.trim() ?? "",
      starting_condition: input.startingCondition?.trim() ?? "",
      steps: input.steps ?? [],
      expected_outcome: input.expectedOutcome?.trim() ?? "",
      edge_cases: input.edgeCases ?? [],
      feature_id: input.featureId ?? null,
    })
    .select(FLOW_COLUMNS)
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapFlow(inserted.data) };
}

export async function loadProductQuestions(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<ProductQuestion[]>> {
  const result = await supabase
    .from("product_questions")
    .select("id, architecture_id, project_id, question, status, decision_id, next_action_id, resolution, created_at, updated_at")
    .eq("architecture_id", architectureId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (/product_questions|does not exist/i.test(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      architectureId: row.architecture_id,
      projectId: row.project_id,
      question: row.question,
      status: row.status as ProductQuestionStatus,
      decisionId: row.decision_id,
      nextActionId: row.next_action_id,
      resolution: row.resolution,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function createProductQuestion(
  supabase: GhostClient,
  input: { architectureId: string; projectId: string; question: string },
): Promise<QueryResult<ProductQuestion>> {
  const inserted = await supabase
    .from("product_questions")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      question: input.question.trim(),
      status: "OPEN",
    })
    .select("id, architecture_id, project_id, question, status, decision_id, next_action_id, resolution, created_at, updated_at")
    .single();
  if (inserted.error) return fromError(inserted.error);
  const row = inserted.data;
  return {
    status: "ok",
    data: {
      id: row.id,
      architectureId: row.architecture_id,
      projectId: row.project_id,
      question: row.question,
      status: row.status as ProductQuestionStatus,
      decisionId: row.decision_id,
      nextActionId: row.next_action_id,
      resolution: row.resolution,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

export async function updateProductQuestion(
  supabase: GhostClient,
  questionId: string,
  patch: Partial<{ status: ProductQuestionStatus; resolution: string; decisionId: string | null; nextActionId: string | null }>,
): Promise<QueryResult<ProductQuestion>> {
  const payload: {
    updated_at: string;
    status?: ProductQuestionStatus;
    resolution?: string;
    decision_id?: string | null;
    next_action_id?: string | null;
  } = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.resolution !== undefined) payload.resolution = patch.resolution;
  if (patch.decisionId !== undefined) payload.decision_id = patch.decisionId;
  if (patch.nextActionId !== undefined) payload.next_action_id = patch.nextActionId;
  const updated = await supabase
    .from("product_questions")
    .update(payload)
    .eq("id", questionId)
    .select("id, architecture_id, project_id, question, status, decision_id, next_action_id, resolution, created_at, updated_at")
    .single();
  if (updated.error) return fromError(updated.error);
  const row = updated.data;
  return {
    status: "ok",
    data: {
      id: row.id,
      architectureId: row.architecture_id,
      projectId: row.project_id,
      question: row.question,
      status: row.status as ProductQuestionStatus,
      decisionId: row.decision_id,
      nextActionId: row.next_action_id,
      resolution: row.resolution,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

export async function loadProductDependencies(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<ProductDependency[]>> {
  const result = await supabase
    .from("product_dependencies")
    .select("id, architecture_id, project_id, from_kind, from_ref, to_kind, to_ref, status, note, created_at")
    .eq("architecture_id", architectureId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (/product_dependencies|does not exist/i.test(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      architectureId: row.architecture_id,
      projectId: row.project_id,
      fromKind: row.from_kind as DependencyKind,
      fromRef: row.from_ref,
      toKind: row.to_kind as DependencyKind,
      toRef: row.to_ref,
      status: row.status as DependencyStatus,
      note: row.note,
      createdAt: row.created_at,
    })),
  };
}

export async function createProductDependency(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    fromKind: DependencyKind;
    fromRef: string;
    toKind: DependencyKind;
    toRef: string;
    status?: DependencyStatus;
    note?: string;
  },
): Promise<QueryResult<ProductDependency>> {
  const inserted = await supabase
    .from("product_dependencies")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      from_kind: input.fromKind,
      from_ref: input.fromRef.trim(),
      to_kind: input.toKind,
      to_ref: input.toRef.trim(),
      status: input.status ?? "PROPOSED",
      note: input.note?.trim() ?? "",
    })
    .select("id, architecture_id, project_id, from_kind, from_ref, to_kind, to_ref, status, note, created_at")
    .single();
  if (inserted.error) return fromError(inserted.error);
  const row = inserted.data;
  return {
    status: "ok",
    data: {
      id: row.id,
      architectureId: row.architecture_id,
      projectId: row.project_id,
      fromKind: row.from_kind as DependencyKind,
      fromRef: row.from_ref,
      toKind: row.to_kind as DependencyKind,
      toRef: row.to_ref,
      status: row.status as DependencyStatus,
      note: row.note,
      createdAt: row.created_at,
    },
  };
}
