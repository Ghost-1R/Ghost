import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";
import {
  asStringList,
  type IdeaEvidence,
  type IdeaEvidenceType,
  type IdeaListItem,
  type IdeaRecord,
  type IdeaStrategy,
  type IdeaStatus,
  type IdeaTransition,
  type IdeaValidation,
  type ValidationStatus,
} from "@/lib/ideas/types";
import { computeIdeaReadiness, workingTitleFromRaw } from "@/lib/ideas/workflow";

function mapIdea(row: {
  id: string;
  owner_id: string;
  title: string;
  raw_idea: string;
  summary: string;
  problem: string;
  target_user: string;
  proposed_solution: string;
  value_proposition: string;
  assumptions: unknown;
  risks: unknown;
  opportunities: unknown;
  constraints_json: unknown;
  open_questions: unknown;
  recommendation: string | null;
  status: IdeaStatus;
  readiness: IdeaRecord["readiness"];
  note: string;
  promoted_project_id: string | null;
  created_at: string;
  updated_at: string;
}): IdeaRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    rawIdea: row.raw_idea,
    summary: row.summary,
    problem: row.problem,
    targetUser: row.target_user,
    proposedSolution: row.proposed_solution,
    valueProposition: row.value_proposition,
    assumptions: asStringList(row.assumptions),
    risks: asStringList(row.risks),
    opportunities: asStringList(row.opportunities),
    constraints: asStringList(row.constraints_json),
    openQuestions: asStringList(row.open_questions),
    recommendation: row.recommendation,
    status: row.status,
    readiness: row.readiness,
    note: row.note,
    promotedProjectId: row.promoted_project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const IDEA_COLUMNS =
  "id, owner_id, title, raw_idea, summary, problem, target_user, proposed_solution, value_proposition, assumptions, risks, opportunities, constraints_json, open_questions, recommendation, status, readiness, note, promoted_project_id, created_at, updated_at" as const;

export async function listIdeas(supabase: GhostClient): Promise<QueryResult<IdeaListItem[]>> {
  const result = await supabase
    .from("ideas")
    .select("id, title, status, readiness, summary, updated_at, promoted_project_id")
    .order("updated_at", { ascending: false });
  if (result.error) {
    if (/ideas|does not exist|schema cache/i.test(result.error.message)) {
      return { status: "ok", data: [] };
    }
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      readiness: row.readiness,
      summary: row.summary,
      updatedAt: row.updated_at,
      promotedProjectId: row.promoted_project_id,
    })),
  };
}

export async function loadIdea(
  supabase: GhostClient,
  ideaId: string,
): Promise<QueryResult<IdeaRecord | null>> {
  const result = await supabase.from("ideas").select(IDEA_COLUMNS).eq("id", ideaId).maybeSingle();
  if (result.error) {
    if (/ideas|does not exist|schema cache/i.test(result.error.message)) {
      return { status: "ok", data: null };
    }
    return fromError(result.error);
  }
  return { status: "ok", data: result.data ? mapIdea(result.data) : null };
}

export async function captureIdea(
  supabase: GhostClient,
  input: { ownerId: string; rawIdea: string; title?: string; note?: string },
): Promise<QueryResult<IdeaRecord>> {
  const raw = input.rawIdea.trim();
  if (raw.length < 1) return { status: "error", message: "Enter an idea." };
  const title = (input.title?.trim() || workingTitleFromRaw(raw)).slice(0, 200);
  const inserted = await supabase
    .from("ideas")
    .insert({
      owner_id: input.ownerId,
      title,
      raw_idea: raw,
      note: input.note?.trim() ?? "",
      status: "CAPTURED",
      readiness: "EARLY",
    })
    .select(IDEA_COLUMNS)
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapIdea(inserted.data) };
}

export async function updateIdeaFields(
  supabase: GhostClient,
  ideaId: string,
  patch: Partial<{
    title: string;
    summary: string;
    problem: string;
    targetUser: string;
    proposedSolution: string;
    valueProposition: string;
    assumptions: string[];
    risks: string[];
    opportunities: string[];
    constraints: string[];
    openQuestions: string[];
    recommendation: string | null;
    note: string;
  }>,
): Promise<QueryResult<IdeaRecord>> {
  const payload: {
    title?: string;
    summary?: string;
    problem?: string;
    target_user?: string;
    proposed_solution?: string;
    value_proposition?: string;
    assumptions?: string[];
    risks?: string[];
    opportunities?: string[];
    constraints_json?: string[];
    open_questions?: string[];
    recommendation?: string | null;
    note?: string;
  } = {};
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.summary !== undefined) payload.summary = patch.summary;
  if (patch.problem !== undefined) payload.problem = patch.problem;
  if (patch.targetUser !== undefined) payload.target_user = patch.targetUser;
  if (patch.proposedSolution !== undefined) payload.proposed_solution = patch.proposedSolution;
  if (patch.valueProposition !== undefined) payload.value_proposition = patch.valueProposition;
  if (patch.assumptions !== undefined) payload.assumptions = patch.assumptions;
  if (patch.risks !== undefined) payload.risks = patch.risks;
  if (patch.opportunities !== undefined) payload.opportunities = patch.opportunities;
  if (patch.constraints !== undefined) payload.constraints_json = patch.constraints;
  if (patch.openQuestions !== undefined) payload.open_questions = patch.openQuestions;
  if (patch.recommendation !== undefined) payload.recommendation = patch.recommendation;
  if (patch.note !== undefined) payload.note = patch.note;

  const updated = await supabase.from("ideas").update(payload).eq("id", ideaId).select(IDEA_COLUMNS).single();
  if (updated.error) return fromError(updated.error);
  const mapped = mapIdea(updated.data);
  await refreshIdeaReadiness(supabase, mapped);
  const refreshed = await loadIdea(supabase, ideaId);
  if (refreshed.status === "error") return refreshed;
  if (!refreshed.data) return { status: "error", message: "Idea was not found." };
  return { status: "ok", data: refreshed.data };
}

export async function refreshIdeaReadiness(
  supabase: GhostClient,
  idea: IdeaRecord,
): Promise<QueryResult<IdeaRecord["readiness"]>> {
  const [evidence, validations] = await Promise.all([
    supabase.from("idea_evidence").select("id").eq("idea_id", idea.id),
    supabase.from("idea_validations").select("id, status").eq("idea_id", idea.id),
  ]);
  const evidenceCount = evidence.data?.length ?? 0;
  const openValidationCount = (validations.data ?? []).filter((row) => row.status === "OPEN" || row.status === "IN_PROGRESS").length;
  const supportedValidationCount = (validations.data ?? []).filter((row) => row.status === "SUPPORTED").length;
  const { readiness } = computeIdeaReadiness({
    problem: idea.problem,
    targetUser: idea.targetUser,
    proposedSolution: idea.proposedSolution,
    evidenceCount,
    openValidationCount,
    supportedValidationCount,
    assumptionCount: idea.assumptions.length,
    riskCount: idea.risks.length,
  });
  const updated = await supabase.from("ideas").update({ readiness }).eq("id", idea.id);
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: readiness };
}

export async function recordIdeaTransition(
  supabase: GhostClient,
  ideaId: string,
  toStatus: IdeaStatus,
  reason: string,
): Promise<QueryResult<IdeaTransition>> {
  const result = await supabase.rpc("record_idea_transition", {
    target_idea_id: ideaId,
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
      ideaId: row.idea_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      actor: row.actor,
      reason: row.reason,
    },
  };
}

export async function loadIdeaHistory(
  supabase: GhostClient,
  ideaId: string,
): Promise<QueryResult<IdeaTransition[]>> {
  const result = await supabase
    .from("idea_transitions")
    .select("id, idea_id, from_status, to_status, changed_at, changed_by, actor, reason")
    .eq("idea_id", ideaId)
    .order("changed_at", { ascending: false });
  if (result.error) {
    if (/idea_transitions|does not exist/i.test(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      ideaId: row.idea_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      actor: row.actor,
      reason: row.reason,
    })),
  };
}

export async function loadIdeaValidations(
  supabase: GhostClient,
  ideaId: string,
): Promise<QueryResult<IdeaValidation[]>> {
  const result = await supabase
    .from("idea_validations")
    .select("id, idea_id, question, reason, evidence_needed, status, result, source, created_at, updated_at")
    .eq("idea_id", ideaId)
    .order("created_at", { ascending: true });
  if (result.error) {
    if (/idea_validations|does not exist/i.test(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      ideaId: row.idea_id,
      question: row.question,
      reason: row.reason,
      evidenceNeeded: row.evidence_needed,
      status: row.status,
      result: row.result,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function addIdeaValidation(
  supabase: GhostClient,
  input: { ideaId: string; question: string; reason?: string; evidenceNeeded?: string; source?: string },
): Promise<QueryResult<IdeaValidation>> {
  const inserted = await supabase
    .from("idea_validations")
    .insert({
      idea_id: input.ideaId,
      question: input.question.trim(),
      reason: input.reason?.trim() ?? "",
      evidence_needed: input.evidenceNeeded?.trim() ?? "",
      source: input.source?.trim() || "founder",
      status: "OPEN",
    })
    .select("id, idea_id, question, reason, evidence_needed, status, result, source, created_at, updated_at")
    .single();
  if (inserted.error) return fromError(inserted.error);
  const row = inserted.data;
  return {
    status: "ok",
    data: {
      id: row.id,
      ideaId: row.idea_id,
      question: row.question,
      reason: row.reason,
      evidenceNeeded: row.evidence_needed,
      status: row.status,
      result: row.result,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

export async function updateValidationStatus(
  supabase: GhostClient,
  input: { id: string; status: ValidationStatus; result?: string },
): Promise<QueryResult<IdeaValidation>> {
  const updated = await supabase
    .from("idea_validations")
    .update({
      status: input.status,
      result: input.result?.trim() ?? "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select("id, idea_id, question, reason, evidence_needed, status, result, source, created_at, updated_at")
    .single();
  if (updated.error) return fromError(updated.error);
  const row = updated.data;
  return {
    status: "ok",
    data: {
      id: row.id,
      ideaId: row.idea_id,
      question: row.question,
      reason: row.reason,
      evidenceNeeded: row.evidence_needed,
      status: row.status,
      result: row.result,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

export async function loadIdeaEvidence(
  supabase: GhostClient,
  ideaId: string,
): Promise<QueryResult<IdeaEvidence[]>> {
  const result = await supabase
    .from("idea_evidence")
    .select("id, idea_id, evidence_type, statement, source, confidence, provenance, observed_at, created_at")
    .eq("idea_id", ideaId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (/idea_evidence|does not exist/i.test(result.error.message)) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return {
    status: "ok",
    data: result.data.map((row) => ({
      id: row.id,
      ideaId: row.idea_id,
      evidenceType: row.evidence_type,
      statement: row.statement,
      source: row.source,
      confidence: row.confidence,
      provenance: row.provenance,
      observedAt: row.observed_at,
      createdAt: row.created_at,
    })),
  };
}

export async function addIdeaEvidence(
  supabase: GhostClient,
  input: {
    ideaId: string;
    evidenceType: IdeaEvidenceType;
    statement: string;
    source?: string;
    confidence?: string | null;
    provenance?: string;
    observedAt?: string | null;
    createdBy?: string | null;
  },
): Promise<QueryResult<IdeaEvidence>> {
  const inserted = await supabase
    .from("idea_evidence")
    .insert({
      idea_id: input.ideaId,
      evidence_type: input.evidenceType,
      statement: input.statement.trim(),
      source: input.source?.trim() ?? "",
      confidence: input.confidence ?? null,
      provenance: input.provenance?.trim() || "founder",
      observed_at: input.observedAt ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("id, idea_id, evidence_type, statement, source, confidence, provenance, observed_at, created_at")
    .single();
  if (inserted.error) return fromError(inserted.error);
  const row = inserted.data;
  return {
    status: "ok",
    data: {
      id: row.id,
      ideaId: row.idea_id,
      evidenceType: row.evidence_type,
      statement: row.statement,
      source: row.source,
      confidence: row.confidence,
      provenance: row.provenance,
      observedAt: row.observed_at,
      createdAt: row.created_at,
    },
  };
}

export async function loadIdeaStrategy(
  supabase: GhostClient,
  ideaId: string,
): Promise<QueryResult<IdeaStrategy | null>> {
  const result = await supabase.from("idea_strategies").select("*").eq("idea_id", ideaId).maybeSingle();
  if (result.error) {
    if (/idea_strategies|does not exist/i.test(result.error.message)) return { status: "ok", data: null };
    return fromError(result.error);
  }
  if (!result.data) return { status: "ok", data: null };
  const row = result.data;
  return {
    status: "ok",
    data: {
      id: row.id,
      ideaId: row.idea_id,
      vision: row.vision,
      problem: row.problem,
      targetCustomer: row.target_customer,
      positioning: row.positioning,
      valueProposition: row.value_proposition,
      coreOffer: row.core_offer,
      differentiation: row.differentiation,
      valueModel: row.value_model,
      distribution: row.distribution,
      keyCapabilities: asStringList(row.key_capabilities),
      constraints: asStringList(row.constraints_json),
      risks: asStringList(row.risks),
      assumptions: asStringList(row.assumptions),
      successMeasures: asStringList(row.success_measures),
      nonGoals: asStringList(row.non_goals),
      initialScope: row.initial_scope,
      mvp: row.mvp,
      notBuilding: row.not_building,
      openDecisions: asStringList(row.open_decisions),
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

export async function upsertIdeaStrategy(
  supabase: GhostClient,
  ideaId: string,
  patch: Partial<Omit<IdeaStrategy, "id" | "ideaId" | "createdAt" | "updatedAt" | "approvedAt" | "approvedBy">>,
  options?: { approve?: boolean; approvedBy?: string | null },
): Promise<QueryResult<IdeaStrategy>> {
  const existing = await loadIdeaStrategy(supabase, ideaId);
  if (existing.status === "error") return existing;
  const payload = {
    idea_id: ideaId,
    vision: patch.vision ?? existing.data?.vision ?? "",
    problem: patch.problem ?? existing.data?.problem ?? "",
    target_customer: patch.targetCustomer ?? existing.data?.targetCustomer ?? "",
    positioning: patch.positioning ?? existing.data?.positioning ?? "",
    value_proposition: patch.valueProposition ?? existing.data?.valueProposition ?? "",
    core_offer: patch.coreOffer ?? existing.data?.coreOffer ?? "",
    differentiation: patch.differentiation ?? existing.data?.differentiation ?? "",
    value_model: patch.valueModel ?? existing.data?.valueModel ?? "",
    distribution: patch.distribution ?? existing.data?.distribution ?? "",
    key_capabilities: patch.keyCapabilities ?? existing.data?.keyCapabilities ?? [],
    constraints_json: patch.constraints ?? existing.data?.constraints ?? [],
    risks: patch.risks ?? existing.data?.risks ?? [],
    assumptions: patch.assumptions ?? existing.data?.assumptions ?? [],
    success_measures: patch.successMeasures ?? existing.data?.successMeasures ?? [],
    non_goals: patch.nonGoals ?? existing.data?.nonGoals ?? [],
    initial_scope: patch.initialScope ?? existing.data?.initialScope ?? "",
    mvp: patch.mvp ?? existing.data?.mvp ?? "",
    not_building: patch.notBuilding ?? existing.data?.notBuilding ?? "",
    open_decisions: patch.openDecisions ?? existing.data?.openDecisions ?? [],
    approved_at: options?.approve ? new Date().toISOString() : existing.data?.approvedAt ?? null,
    approved_by: options?.approve ? options.approvedBy ?? null : existing.data?.approvedBy ?? null,
    updated_at: new Date().toISOString(),
  };
  const saved = existing.data
    ? await supabase.from("idea_strategies").update(payload).eq("id", existing.data.id).select("*").single()
    : await supabase.from("idea_strategies").insert(payload).select("*").single();
  if (saved.error) return fromError(saved.error);
  const loaded = await loadIdeaStrategy(supabase, ideaId);
  if (loaded.status === "error") return loaded;
  if (!loaded.data) return { status: "error", message: "Strategy was not saved." };
  return { status: "ok", data: loaded.data };
}
