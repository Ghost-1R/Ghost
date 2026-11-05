import type { GhostClient } from "@/lib/auth/session";
import type { Database, Json } from "@/lib/database.types";
import { loadProductArchitecture, loadProductRequirements } from "@/lib/product-architect/queries";
import { fromError, type QueryResult } from "@/lib/result";
import {
  asRecord,
  asStringList,
  type ConfigClassification,
  type CoverageMatrixRow,
  type CoverageStatus,
  type RelationshipCardinality,
  type SensitiveClass,
  type SystemArchitecture,
  type SystemArchitectureBundle,
  type SystemArchitectureStatus,
  type SystemArchitectureTransition,
  type SystemComponent,
  type SystemComponentType,
  type SystemDataFlow,
  type SystemEntity,
  type SystemEntityField,
  type SystemEnvConfig,
  type SystemIntegration,
  type SystemInterface,
  type SystemQuestion,
  type SystemQuestionStatus,
  type SystemRecordStatus,
  type SystemRelationship,
  type SystemRequirementCoverage,
  type SystemTechnicalConstraint,
  type SystemTechnicalRisk,
  type TechRiskSeverity,
} from "./types";
import { buildCoverageMatrix, nextHumanId } from "./workflow";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

function isMissing(message: string, table: string): boolean {
  return new RegExp(`${table}|does not exist|schema cache`, "i").test(message);
}

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Architecture root + history
// ---------------------------------------------------------------------------

function mapArchitecture(row: Row<"system_architectures">): SystemArchitecture {
  return {
    id: row.id,
    projectId: row.project_id,
    productArchitectureId: row.product_architecture_id,
    summary: row.summary,
    authSummary: row.auth_summary,
    authorizationSummary: row.authorization_summary,
    runtimeTopology: asStringList(row.runtime_topology),
    status: row.status,
    note: row.note,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadSystemArchitecture(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<SystemArchitecture | null>> {
  const result = await supabase.from("system_architectures").select("*").eq("project_id", projectId).maybeSingle();
  if (result.error) {
    if (isMissing(result.error.message, "system_architectures")) return { status: "ok", data: null };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data ? mapArchitecture(result.data) : null };
}

export async function ensureSystemArchitecture(
  supabase: GhostClient,
  input: { projectId: string; productArchitectureId: string; summary?: string },
): Promise<QueryResult<SystemArchitecture>> {
  const existing = await loadSystemArchitecture(supabase, input.projectId);
  if (existing.status === "error") return existing;
  if (existing.data) return { status: "ok", data: existing.data };

  const inserted = await supabase
    .from("system_architectures")
    .insert({
      project_id: input.projectId,
      product_architecture_id: input.productArchitectureId,
      summary: input.summary ?? "",
      status: "DRAFT",
      note: "Initialized from a BUILD_READY Product Architecture. Design only; nothing is implemented or deployed.",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);

  await supabase.from("system_architecture_transitions").insert({
    architecture_id: inserted.data.id,
    from_status: null,
    to_status: "DRAFT",
    changed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    actor: "FOUNDER",
    reason: "System Architecture created for project.",
  });

  return { status: "ok", data: mapArchitecture(inserted.data) };
}

export async function updateSystemArchitectureOverview(
  supabase: GhostClient,
  architectureId: string,
  patch: Partial<Pick<SystemArchitecture, "summary" | "authSummary" | "authorizationSummary" | "runtimeTopology" | "note">>,
): Promise<QueryResult<SystemArchitecture>> {
  const payload: Database["public"]["Tables"]["system_architectures"]["Update"] = { updated_at: now() };
  if (patch.summary !== undefined) payload.summary = patch.summary;
  if (patch.authSummary !== undefined) payload.auth_summary = patch.authSummary;
  if (patch.authorizationSummary !== undefined) payload.authorization_summary = patch.authorizationSummary;
  if (patch.runtimeTopology !== undefined) payload.runtime_topology = patch.runtimeTopology;
  if (patch.note !== undefined) payload.note = patch.note;
  const updated = await supabase.from("system_architectures").update(payload).eq("id", architectureId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapArchitecture(updated.data) };
}

export async function recordSystemArchitectureTransition(
  supabase: GhostClient,
  architectureId: string,
  toStatus: SystemArchitectureStatus,
  reason: string,
): Promise<QueryResult<SystemArchitectureTransition>> {
  const result = await supabase.rpc("record_system_architecture_transition", {
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

export async function loadSystemArchitectureHistory(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemArchitectureTransition[]>> {
  const result = await supabase
    .from("system_architecture_transitions")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("changed_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "system_architecture_transitions")) return { status: "ok", data: [] };
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

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function mapComponent(row: Row<"system_components">, requirementIds: string[] = []): SystemComponent {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    humanId: row.human_id,
    name: row.name,
    purpose: row.purpose,
    componentType: row.component_type,
    responsibilities: asStringList(row.responsibilities),
    dependencyRefs: asStringList(row.dependency_refs),
    requirementIds,
    status: row.status,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadSystemComponents(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemComponent[]>> {
  const result = await supabase
    .from("system_components")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "system_components")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  const links = result.data.length
    ? await supabase
        .from("system_component_requirements")
        .select("component_id, requirement_id")
        .in(
          "component_id",
          result.data.map((row) => row.id),
        )
    : { data: [] as Array<{ component_id: string; requirement_id: string }> };
  const byComponent = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    const list = byComponent.get(link.component_id) ?? [];
    list.push(link.requirement_id);
    byComponent.set(link.component_id, list);
  }
  return { status: "ok", data: result.data.map((row) => mapComponent(row, byComponent.get(row.id) ?? [])) };
}

async function replaceComponentRequirements(supabase: GhostClient, componentId: string, requirementIds: string[]) {
  await supabase.from("system_component_requirements").delete().eq("component_id", componentId);
  if (requirementIds.length) {
    await supabase
      .from("system_component_requirements")
      .insert(requirementIds.map((requirementId) => ({ component_id: componentId, requirement_id: requirementId })));
  }
}

export async function createSystemComponent(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    name: string;
    purpose?: string;
    componentType?: SystemComponentType;
    responsibilities?: string[];
    dependencyRefs?: string[];
    requirementIds?: string[];
    status?: SystemRecordStatus;
    source?: string;
    provenance?: string;
  },
): Promise<QueryResult<SystemComponent>> {
  const existing = await loadSystemComponents(supabase, input.architectureId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("system_components")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      human_id: nextHumanId("COMP", existing.data.map((row) => row.humanId)),
      name: input.name.trim(),
      purpose: input.purpose?.trim() ?? "",
      component_type: input.componentType ?? "OTHER",
      responsibilities: input.responsibilities ?? [],
      dependency_refs: input.dependencyRefs ?? [],
      status: input.status ?? "PROPOSED",
      source: input.source?.trim() || "founder",
      provenance: input.provenance?.trim() || "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  if (input.requirementIds?.length) await replaceComponentRequirements(supabase, inserted.data.id, input.requirementIds);
  return { status: "ok", data: mapComponent(inserted.data, input.requirementIds ?? []) };
}

export async function updateSystemComponent(
  supabase: GhostClient,
  componentId: string,
  patch: Partial<{
    name: string;
    purpose: string;
    componentType: SystemComponentType;
    responsibilities: string[];
    dependencyRefs: string[];
    requirementIds: string[];
    status: SystemRecordStatus;
  }>,
): Promise<QueryResult<SystemComponent>> {
  const payload: Database["public"]["Tables"]["system_components"]["Update"] = { updated_at: now() };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.purpose !== undefined) payload.purpose = patch.purpose;
  if (patch.componentType !== undefined) payload.component_type = patch.componentType;
  if (patch.responsibilities !== undefined) payload.responsibilities = patch.responsibilities;
  if (patch.dependencyRefs !== undefined) payload.dependency_refs = patch.dependencyRefs;
  if (patch.status !== undefined) payload.status = patch.status;
  const updated = await supabase.from("system_components").update(payload).eq("id", componentId).select("*").single();
  if (updated.error) return fromError(updated.error);
  if (patch.requirementIds) await replaceComponentRequirements(supabase, componentId, patch.requirementIds);
  const links = await supabase.from("system_component_requirements").select("requirement_id").eq("component_id", componentId);
  return { status: "ok", data: mapComponent(updated.data, (links.data ?? []).map((row) => row.requirement_id)) };
}

// ---------------------------------------------------------------------------
// Entities, fields, relationships
// ---------------------------------------------------------------------------

function mapEntity(row: Row<"system_entities">): SystemEntity {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    humanId: row.human_id,
    name: row.name,
    purpose: row.purpose,
    ownershipField: row.ownership_field,
    rlsExpectation: row.rls_expectation,
    retentionNote: row.retention_note,
    sensitiveClass: row.sensitive_class,
    status: row.status,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadSystemEntities(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemEntity[]>> {
  const result = await supabase
    .from("system_entities")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "system_entities")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapEntity) };
}

export async function createSystemEntity(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    name: string;
    purpose?: string;
    ownershipField?: string;
    rlsExpectation?: string;
    retentionNote?: string;
    sensitiveClass?: SensitiveClass;
    status?: SystemRecordStatus;
    source?: string;
    provenance?: string;
  },
): Promise<QueryResult<SystemEntity>> {
  const existing = await loadSystemEntities(supabase, input.architectureId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("system_entities")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      human_id: nextHumanId("ENT", existing.data.map((row) => row.humanId)),
      name: input.name.trim(),
      purpose: input.purpose?.trim() ?? "",
      ownership_field: input.ownershipField?.trim() ?? "",
      rls_expectation: input.rlsExpectation?.trim() ?? "",
      retention_note: input.retentionNote?.trim() ?? "",
      sensitive_class: input.sensitiveClass ?? "NONE",
      status: input.status ?? "PROPOSED",
      source: input.source?.trim() || "founder",
      provenance: input.provenance?.trim() || "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapEntity(inserted.data) };
}

export async function updateSystemEntity(
  supabase: GhostClient,
  entityId: string,
  patch: Partial<{
    name: string;
    purpose: string;
    ownershipField: string;
    rlsExpectation: string;
    retentionNote: string;
    sensitiveClass: SensitiveClass;
    status: SystemRecordStatus;
  }>,
): Promise<QueryResult<SystemEntity>> {
  const payload: Database["public"]["Tables"]["system_entities"]["Update"] = { updated_at: now() };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.purpose !== undefined) payload.purpose = patch.purpose;
  if (patch.ownershipField !== undefined) payload.ownership_field = patch.ownershipField.trim();
  if (patch.rlsExpectation !== undefined) payload.rls_expectation = patch.rlsExpectation;
  if (patch.retentionNote !== undefined) payload.retention_note = patch.retentionNote;
  if (patch.sensitiveClass !== undefined) payload.sensitive_class = patch.sensitiveClass;
  if (patch.status !== undefined) payload.status = patch.status;
  const updated = await supabase.from("system_entities").update(payload).eq("id", entityId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapEntity(updated.data) };
}

function mapField(row: Row<"system_entity_fields">): SystemEntityField {
  return {
    id: row.id,
    entityId: row.entity_id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    name: row.name,
    dataType: row.data_type,
    nullable: row.nullable,
    defaultValue: row.default_value,
    isPk: row.is_pk,
    isUnique: row.is_unique,
    isFk: row.is_fk,
    referencesEntityId: row.references_entity_id,
    sensitiveClass: row.sensitive_class,
    note: row.note,
    position: row.position,
    createdAt: row.created_at,
  };
}

export async function loadSystemEntityFields(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemEntityField[]>> {
  const result = await supabase
    .from("system_entity_fields")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "system_entity_fields")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapField) };
}

export async function createSystemEntityField(
  supabase: GhostClient,
  input: {
    entityId: string;
    architectureId: string;
    projectId: string;
    name: string;
    dataType?: string;
    nullable?: boolean;
    defaultValue?: string;
    isPk?: boolean;
    isUnique?: boolean;
    isFk?: boolean;
    referencesEntityId?: string | null;
    sensitiveClass?: SensitiveClass;
    note?: string;
  },
): Promise<QueryResult<SystemEntityField>> {
  const siblings = await supabase.from("system_entity_fields").select("position").eq("entity_id", input.entityId);
  if (siblings.error) return fromError(siblings.error);
  const position = Math.max(-1, ...siblings.data.map((row) => row.position)) + 1;
  const inserted = await supabase
    .from("system_entity_fields")
    .insert({
      entity_id: input.entityId,
      architecture_id: input.architectureId,
      project_id: input.projectId,
      name: input.name.trim(),
      data_type: input.dataType?.trim() || "text",
      nullable: input.nullable ?? true,
      default_value: input.defaultValue?.trim() ?? "",
      is_pk: input.isPk ?? false,
      is_unique: input.isUnique ?? false,
      is_fk: input.isFk ?? false,
      references_entity_id: input.referencesEntityId ?? null,
      sensitive_class: input.sensitiveClass ?? "NONE",
      note: input.note?.trim() ?? "",
      position,
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapField(inserted.data) };
}

export async function updateSystemEntityField(
  supabase: GhostClient,
  fieldId: string,
  patch: Partial<{
    name: string;
    dataType: string;
    nullable: boolean;
    defaultValue: string;
    isPk: boolean;
    isUnique: boolean;
    isFk: boolean;
    referencesEntityId: string | null;
    sensitiveClass: SensitiveClass;
    note: string;
  }>,
): Promise<QueryResult<SystemEntityField>> {
  const payload: Database["public"]["Tables"]["system_entity_fields"]["Update"] = {};
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.dataType !== undefined) payload.data_type = patch.dataType.trim() || "text";
  if (patch.nullable !== undefined) payload.nullable = patch.nullable;
  if (patch.defaultValue !== undefined) payload.default_value = patch.defaultValue;
  if (patch.isPk !== undefined) payload.is_pk = patch.isPk;
  if (patch.isUnique !== undefined) payload.is_unique = patch.isUnique;
  if (patch.isFk !== undefined) payload.is_fk = patch.isFk;
  if (patch.referencesEntityId !== undefined) payload.references_entity_id = patch.referencesEntityId;
  if (patch.sensitiveClass !== undefined) payload.sensitive_class = patch.sensitiveClass;
  if (patch.note !== undefined) payload.note = patch.note;
  const updated = await supabase.from("system_entity_fields").update(payload).eq("id", fieldId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapField(updated.data) };
}

function mapRelationship(row: Row<"system_relationships">): SystemRelationship {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    humanId: row.human_id,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    cardinality: row.cardinality,
    fkStrategy: row.fk_strategy,
    deleteBehavior: row.delete_behavior,
    rationale: row.rationale,
    junctionStrategy: row.junction_strategy,
    status: row.status,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
  };
}

export async function loadSystemRelationships(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemRelationship[]>> {
  const result = await supabase
    .from("system_relationships")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "system_relationships")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapRelationship) };
}

export async function createSystemRelationship(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    sourceEntityId: string;
    targetEntityId: string;
    cardinality: RelationshipCardinality;
    fkStrategy?: string;
    deleteBehavior?: string;
    rationale?: string;
    junctionStrategy?: string;
    status?: SystemRecordStatus;
    source?: string;
    provenance?: string;
  },
): Promise<QueryResult<SystemRelationship>> {
  const existing = await loadSystemRelationships(supabase, input.architectureId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("system_relationships")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      human_id: nextHumanId("REL", existing.data.map((row) => row.humanId)),
      source_entity_id: input.sourceEntityId,
      target_entity_id: input.targetEntityId,
      cardinality: input.cardinality,
      fk_strategy: input.fkStrategy?.trim() ?? "",
      delete_behavior: input.deleteBehavior?.trim() ?? "",
      rationale: input.rationale?.trim() ?? "",
      junction_strategy: input.junctionStrategy?.trim() ?? "",
      status: input.status ?? "PROPOSED",
      source: input.source?.trim() || "founder",
      provenance: input.provenance?.trim() || "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapRelationship(inserted.data) };
}

export async function updateSystemRelationship(
  supabase: GhostClient,
  relationshipId: string,
  patch: Partial<{
    cardinality: RelationshipCardinality;
    fkStrategy: string;
    deleteBehavior: string;
    rationale: string;
    junctionStrategy: string;
    status: SystemRecordStatus;
  }>,
): Promise<QueryResult<SystemRelationship>> {
  const payload: Database["public"]["Tables"]["system_relationships"]["Update"] = {};
  if (patch.cardinality !== undefined) payload.cardinality = patch.cardinality;
  if (patch.fkStrategy !== undefined) payload.fk_strategy = patch.fkStrategy;
  if (patch.deleteBehavior !== undefined) payload.delete_behavior = patch.deleteBehavior;
  if (patch.rationale !== undefined) payload.rationale = patch.rationale;
  if (patch.junctionStrategy !== undefined) payload.junction_strategy = patch.junctionStrategy;
  if (patch.status !== undefined) payload.status = patch.status;
  const updated = await supabase.from("system_relationships").update(payload).eq("id", relationshipId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapRelationship(updated.data) };
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

function mapInterface(row: Row<"system_interfaces">, requirementIds: string[] = []): SystemInterface {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    humanId: row.human_id,
    name: row.name,
    purpose: row.purpose,
    caller: row.caller,
    receiver: row.receiver,
    operation: row.operation,
    inputShape: asRecord(row.input_shape),
    outputShape: asRecord(row.output_shape),
    authRequired: row.auth_required,
    failureBehavior: row.failure_behavior,
    requirementIds,
    status: row.status,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadSystemInterfaces(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemInterface[]>> {
  const result = await supabase
    .from("system_interfaces")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "system_interfaces")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  const links = result.data.length
    ? await supabase
        .from("system_interface_requirements")
        .select("interface_id, requirement_id")
        .in(
          "interface_id",
          result.data.map((row) => row.id),
        )
    : { data: [] as Array<{ interface_id: string; requirement_id: string }> };
  const byInterface = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    const list = byInterface.get(link.interface_id) ?? [];
    list.push(link.requirement_id);
    byInterface.set(link.interface_id, list);
  }
  return { status: "ok", data: result.data.map((row) => mapInterface(row, byInterface.get(row.id) ?? [])) };
}

async function replaceInterfaceRequirements(supabase: GhostClient, interfaceId: string, requirementIds: string[]) {
  await supabase.from("system_interface_requirements").delete().eq("interface_id", interfaceId);
  if (requirementIds.length) {
    await supabase
      .from("system_interface_requirements")
      .insert(requirementIds.map((requirementId) => ({ interface_id: interfaceId, requirement_id: requirementId })));
  }
}

export async function createSystemInterface(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    name: string;
    purpose?: string;
    caller?: string;
    receiver?: string;
    operation?: string;
    inputShape?: Record<string, unknown>;
    outputShape?: Record<string, unknown>;
    authRequired?: boolean;
    failureBehavior?: string;
    requirementIds?: string[];
    status?: SystemRecordStatus;
    source?: string;
    provenance?: string;
  },
): Promise<QueryResult<SystemInterface>> {
  const existing = await loadSystemInterfaces(supabase, input.architectureId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("system_interfaces")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      human_id: nextHumanId("API", existing.data.map((row) => row.humanId)),
      name: input.name.trim(),
      purpose: input.purpose?.trim() ?? "",
      caller: input.caller?.trim() ?? "",
      receiver: input.receiver?.trim() ?? "",
      operation: input.operation?.trim() ?? "",
      input_shape: (input.inputShape ?? {}) as Json,
      output_shape: (input.outputShape ?? {}) as Json,
      auth_required: input.authRequired ?? true,
      failure_behavior: input.failureBehavior?.trim() ?? "",
      status: input.status ?? "PROPOSED",
      source: input.source?.trim() || "founder",
      provenance: input.provenance?.trim() || "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  if (input.requirementIds?.length) await replaceInterfaceRequirements(supabase, inserted.data.id, input.requirementIds);
  return { status: "ok", data: mapInterface(inserted.data, input.requirementIds ?? []) };
}

export async function updateSystemInterface(
  supabase: GhostClient,
  interfaceId: string,
  patch: Partial<{
    name: string;
    purpose: string;
    caller: string;
    receiver: string;
    operation: string;
    inputShape: Record<string, unknown>;
    outputShape: Record<string, unknown>;
    authRequired: boolean;
    failureBehavior: string;
    requirementIds: string[];
    status: SystemRecordStatus;
  }>,
): Promise<QueryResult<SystemInterface>> {
  const payload: Database["public"]["Tables"]["system_interfaces"]["Update"] = { updated_at: now() };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.purpose !== undefined) payload.purpose = patch.purpose;
  if (patch.caller !== undefined) payload.caller = patch.caller;
  if (patch.receiver !== undefined) payload.receiver = patch.receiver;
  if (patch.operation !== undefined) payload.operation = patch.operation;
  if (patch.inputShape !== undefined) payload.input_shape = patch.inputShape as Json;
  if (patch.outputShape !== undefined) payload.output_shape = patch.outputShape as Json;
  if (patch.authRequired !== undefined) payload.auth_required = patch.authRequired;
  if (patch.failureBehavior !== undefined) payload.failure_behavior = patch.failureBehavior;
  if (patch.status !== undefined) payload.status = patch.status;
  const updated = await supabase.from("system_interfaces").update(payload).eq("id", interfaceId).select("*").single();
  if (updated.error) return fromError(updated.error);
  if (patch.requirementIds) await replaceInterfaceRequirements(supabase, interfaceId, patch.requirementIds);
  const links = await supabase.from("system_interface_requirements").select("requirement_id").eq("interface_id", interfaceId);
  return { status: "ok", data: mapInterface(updated.data, (links.data ?? []).map((row) => row.requirement_id)) };
}

// ---------------------------------------------------------------------------
// Data flows
// ---------------------------------------------------------------------------

function mapDataFlow(row: Row<"system_data_flows">): SystemDataFlow {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    humanId: row.human_id,
    name: row.name,
    sourceLabel: row.source_label,
    processLabel: row.process_label,
    storageLabel: row.storage_label,
    resultLabel: row.result_label,
    steps: asStringList(row.steps),
    componentRefs: asStringList(row.component_refs),
    status: row.status,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
  };
}

export async function loadSystemDataFlows(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemDataFlow[]>> {
  const result = await supabase
    .from("system_data_flows")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "system_data_flows")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapDataFlow) };
}

export async function createSystemDataFlow(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    name: string;
    sourceLabel?: string;
    processLabel?: string;
    storageLabel?: string;
    resultLabel?: string;
    steps?: string[];
    componentRefs?: string[];
    status?: SystemRecordStatus;
    source?: string;
    provenance?: string;
  },
): Promise<QueryResult<SystemDataFlow>> {
  const existing = await loadSystemDataFlows(supabase, input.architectureId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("system_data_flows")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      human_id: nextHumanId("DFLOW", existing.data.map((row) => row.humanId)),
      name: input.name.trim(),
      source_label: input.sourceLabel?.trim() ?? "",
      process_label: input.processLabel?.trim() ?? "",
      storage_label: input.storageLabel?.trim() ?? "",
      result_label: input.resultLabel?.trim() ?? "",
      steps: input.steps ?? [],
      component_refs: input.componentRefs ?? [],
      status: input.status ?? "PROPOSED",
      source: input.source?.trim() || "founder",
      provenance: input.provenance?.trim() || "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapDataFlow(inserted.data) };
}

export async function updateSystemDataFlow(
  supabase: GhostClient,
  flowId: string,
  patch: Partial<{
    name: string;
    sourceLabel: string;
    processLabel: string;
    storageLabel: string;
    resultLabel: string;
    steps: string[];
    componentRefs: string[];
    status: SystemRecordStatus;
  }>,
): Promise<QueryResult<SystemDataFlow>> {
  const payload: Database["public"]["Tables"]["system_data_flows"]["Update"] = {};
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.sourceLabel !== undefined) payload.source_label = patch.sourceLabel;
  if (patch.processLabel !== undefined) payload.process_label = patch.processLabel;
  if (patch.storageLabel !== undefined) payload.storage_label = patch.storageLabel;
  if (patch.resultLabel !== undefined) payload.result_label = patch.resultLabel;
  if (patch.steps !== undefined) payload.steps = patch.steps;
  if (patch.componentRefs !== undefined) payload.component_refs = patch.componentRefs;
  if (patch.status !== undefined) payload.status = patch.status;
  const updated = await supabase.from("system_data_flows").update(payload).eq("id", flowId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapDataFlow(updated.data) };
}

// ---------------------------------------------------------------------------
// Integrations (secret NAMES only) and env config (variable NAMES only)
// ---------------------------------------------------------------------------

function mapIntegration(row: Row<"system_integrations">): SystemIntegration {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    humanId: row.human_id,
    provider: row.provider,
    purpose: row.purpose,
    required: row.required,
    dataExchanged: asStringList(row.data_exchanged),
    secretNames: asStringList(row.secret_names),
    failureImpact: row.failure_impact,
    fallbackBehavior: row.fallback_behavior,
    costNote: row.cost_note,
    status: row.status,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
  };
}

export async function loadSystemIntegrations(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemIntegration[]>> {
  const result = await supabase
    .from("system_integrations")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "system_integrations")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapIntegration) };
}

export async function createSystemIntegration(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    provider: string;
    purpose?: string;
    required?: boolean;
    dataExchanged?: string[];
    secretNames?: string[];
    failureImpact?: string;
    fallbackBehavior?: string;
    costNote?: string;
    status?: SystemRecordStatus;
    source?: string;
    provenance?: string;
  },
): Promise<QueryResult<SystemIntegration>> {
  const existing = await loadSystemIntegrations(supabase, input.architectureId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("system_integrations")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      human_id: nextHumanId("INTG", existing.data.map((row) => row.humanId)),
      provider: input.provider.trim(),
      purpose: input.purpose?.trim() ?? "",
      required: input.required ?? true,
      data_exchanged: input.dataExchanged ?? [],
      secret_names: input.secretNames ?? [],
      failure_impact: input.failureImpact?.trim() ?? "",
      fallback_behavior: input.fallbackBehavior?.trim() ?? "",
      cost_note: input.costNote?.trim() ?? "",
      status: input.status ?? "PROPOSED",
      source: input.source?.trim() || "founder",
      provenance: input.provenance?.trim() || "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapIntegration(inserted.data) };
}

export async function updateSystemIntegration(
  supabase: GhostClient,
  integrationId: string,
  patch: Partial<{
    provider: string;
    purpose: string;
    required: boolean;
    dataExchanged: string[];
    secretNames: string[];
    failureImpact: string;
    fallbackBehavior: string;
    costNote: string;
    status: SystemRecordStatus;
  }>,
): Promise<QueryResult<SystemIntegration>> {
  const payload: Database["public"]["Tables"]["system_integrations"]["Update"] = {};
  if (patch.provider !== undefined) payload.provider = patch.provider.trim();
  if (patch.purpose !== undefined) payload.purpose = patch.purpose;
  if (patch.required !== undefined) payload.required = patch.required;
  if (patch.dataExchanged !== undefined) payload.data_exchanged = patch.dataExchanged;
  if (patch.secretNames !== undefined) payload.secret_names = patch.secretNames;
  if (patch.failureImpact !== undefined) payload.failure_impact = patch.failureImpact;
  if (patch.fallbackBehavior !== undefined) payload.fallback_behavior = patch.fallbackBehavior;
  if (patch.costNote !== undefined) payload.cost_note = patch.costNote;
  if (patch.status !== undefined) payload.status = patch.status;
  const updated = await supabase.from("system_integrations").update(payload).eq("id", integrationId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapIntegration(updated.data) };
}

function mapEnvConfig(row: Row<"system_env_configs">): SystemEnvConfig {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    variableName: row.variable_name,
    purpose: row.purpose,
    classification: row.classification,
    requiredEnvironments: asStringList(row.required_environments),
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function loadSystemEnvConfigs(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemEnvConfig[]>> {
  const result = await supabase
    .from("system_env_configs")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("variable_name", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "system_env_configs")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapEnvConfig) };
}

export async function createSystemEnvConfig(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    variableName: string;
    purpose?: string;
    classification?: ConfigClassification;
    requiredEnvironments?: string[];
    status?: SystemRecordStatus;
  },
): Promise<QueryResult<SystemEnvConfig>> {
  const inserted = await supabase
    .from("system_env_configs")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      variable_name: input.variableName.trim(),
      purpose: input.purpose?.trim() ?? "",
      classification: input.classification ?? "SERVER_SECRET",
      required_environments: input.requiredEnvironments?.length ? input.requiredEnvironments : ["production"],
      status: input.status ?? "PROPOSED",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapEnvConfig(inserted.data) };
}

export async function updateSystemEnvConfig(
  supabase: GhostClient,
  envConfigId: string,
  patch: Partial<{
    purpose: string;
    classification: ConfigClassification;
    requiredEnvironments: string[];
    status: SystemRecordStatus;
  }>,
): Promise<QueryResult<SystemEnvConfig>> {
  const payload: Database["public"]["Tables"]["system_env_configs"]["Update"] = {};
  if (patch.purpose !== undefined) payload.purpose = patch.purpose;
  if (patch.classification !== undefined) payload.classification = patch.classification;
  if (patch.requiredEnvironments !== undefined) payload.required_environments = patch.requiredEnvironments;
  if (patch.status !== undefined) payload.status = patch.status;
  const updated = await supabase.from("system_env_configs").update(payload).eq("id", envConfigId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapEnvConfig(updated.data) };
}

// ---------------------------------------------------------------------------
// Risks and constraints
// ---------------------------------------------------------------------------

function mapRisk(row: Row<"system_technical_risks">): SystemTechnicalRisk {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    humanId: row.human_id,
    description: row.description,
    severity: row.severity,
    likelihood: row.likelihood,
    mitigation: row.mitigation,
    linkedComponentRefs: asStringList(row.linked_component_refs),
    status: row.status,
    source: row.source,
    provenance: row.provenance,
    createdAt: row.created_at,
  };
}

export async function loadSystemRisks(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemTechnicalRisk[]>> {
  const result = await supabase
    .from("system_technical_risks")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("human_id", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "system_technical_risks")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapRisk) };
}

export async function createSystemRisk(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    description: string;
    severity?: TechRiskSeverity;
    likelihood?: string;
    mitigation?: string;
    linkedComponentRefs?: string[];
    status?: SystemRecordStatus;
    source?: string;
    provenance?: string;
  },
): Promise<QueryResult<SystemTechnicalRisk>> {
  const existing = await loadSystemRisks(supabase, input.architectureId);
  if (existing.status === "error") return existing;
  const inserted = await supabase
    .from("system_technical_risks")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      human_id: nextHumanId("RISK", existing.data.map((row) => row.humanId)),
      description: input.description.trim(),
      severity: input.severity ?? "MEDIUM",
      likelihood: input.likelihood?.trim() || "UNKNOWN",
      mitigation: input.mitigation?.trim() ?? "",
      linked_component_refs: input.linkedComponentRefs ?? [],
      status: input.status ?? "PROPOSED",
      source: input.source?.trim() || "founder",
      provenance: input.provenance?.trim() || "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapRisk(inserted.data) };
}

export async function updateSystemRisk(
  supabase: GhostClient,
  riskId: string,
  patch: Partial<{
    description: string;
    severity: TechRiskSeverity;
    likelihood: string;
    mitigation: string;
    linkedComponentRefs: string[];
    status: SystemRecordStatus;
  }>,
): Promise<QueryResult<SystemTechnicalRisk>> {
  const payload: Database["public"]["Tables"]["system_technical_risks"]["Update"] = {};
  if (patch.description !== undefined) payload.description = patch.description.trim();
  if (patch.severity !== undefined) payload.severity = patch.severity;
  if (patch.likelihood !== undefined) payload.likelihood = patch.likelihood;
  if (patch.mitigation !== undefined) payload.mitigation = patch.mitigation;
  if (patch.linkedComponentRefs !== undefined) payload.linked_component_refs = patch.linkedComponentRefs;
  if (patch.status !== undefined) payload.status = patch.status;
  const updated = await supabase.from("system_technical_risks").update(payload).eq("id", riskId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapRisk(updated.data) };
}

function mapConstraint(row: Row<"system_technical_constraints">): SystemTechnicalConstraint {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    statement: row.statement,
    constraintSource: row.constraint_source,
    authoritative: row.authoritative,
    provenance: row.provenance,
    createdAt: row.created_at,
  };
}

export async function loadSystemConstraints(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemTechnicalConstraint[]>> {
  const result = await supabase
    .from("system_technical_constraints")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("created_at", { ascending: true });
  if (result.error) {
    if (isMissing(result.error.message, "system_technical_constraints")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapConstraint) };
}

export async function createSystemConstraint(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    statement: string;
    constraintSource?: string;
    authoritative?: boolean;
    provenance?: string;
  },
): Promise<QueryResult<SystemTechnicalConstraint>> {
  const inserted = await supabase
    .from("system_technical_constraints")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      statement: input.statement.trim(),
      constraint_source: input.constraintSource?.trim() || "founder",
      authoritative: input.authoritative ?? false,
      provenance: input.provenance?.trim() || "founder",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapConstraint(inserted.data) };
}

export async function updateSystemConstraint(
  supabase: GhostClient,
  constraintId: string,
  patch: Partial<{ statement: string; constraintSource: string; authoritative: boolean }>,
): Promise<QueryResult<SystemTechnicalConstraint>> {
  const payload: Database["public"]["Tables"]["system_technical_constraints"]["Update"] = {};
  if (patch.statement !== undefined) payload.statement = patch.statement.trim();
  if (patch.constraintSource !== undefined) payload.constraint_source = patch.constraintSource;
  if (patch.authoritative !== undefined) payload.authoritative = patch.authoritative;
  const updated = await supabase.from("system_technical_constraints").update(payload).eq("id", constraintId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapConstraint(updated.data) };
}

// ---------------------------------------------------------------------------
// Requirement coverage
// ---------------------------------------------------------------------------

function mapCoverage(row: Row<"system_requirement_coverage">): SystemRequirementCoverage {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    coverage: row.coverage,
    supportingRefs: asStringList(row.supporting_refs),
    gapNote: row.gap_note,
    updatedAt: row.updated_at,
  };
}

export async function loadSystemCoverage(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemRequirementCoverage[]>> {
  const result = await supabase.from("system_requirement_coverage").select("*").eq("architecture_id", architectureId);
  if (result.error) {
    if (isMissing(result.error.message, "system_requirement_coverage")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapCoverage) };
}

export async function upsertRequirementCoverage(
  supabase: GhostClient,
  input: {
    architectureId: string;
    projectId: string;
    requirementId: string;
    coverage: CoverageStatus;
    supportingRefs?: string[];
    gapNote?: string;
  },
): Promise<QueryResult<SystemRequirementCoverage>> {
  const upserted = await supabase
    .from("system_requirement_coverage")
    .upsert(
      {
        architecture_id: input.architectureId,
        project_id: input.projectId,
        requirement_id: input.requirementId,
        coverage: input.coverage,
        supporting_refs: input.supportingRefs ?? [],
        gap_note: input.gapNote?.trim() ?? "",
        updated_at: now(),
      },
      { onConflict: "architecture_id,requirement_id" },
    )
    .select("*")
    .single();
  if (upserted.error) return fromError(upserted.error);
  return { status: "ok", data: mapCoverage(upserted.data) };
}

export async function loadCoverageMatrix(
  supabase: GhostClient,
  architecture: Pick<SystemArchitecture, "id" | "productArchitectureId">,
): Promise<QueryResult<CoverageMatrixRow[]>> {
  const [requirements, coverage, components, interfaces] = await Promise.all([
    loadProductRequirements(supabase, architecture.productArchitectureId),
    loadSystemCoverage(supabase, architecture.id),
    loadSystemComponents(supabase, architecture.id),
    loadSystemInterfaces(supabase, architecture.id),
  ]);
  if (requirements.status === "error") return requirements;
  if (coverage.status === "error") return coverage;
  if (components.status === "error") return components;
  if (interfaces.status === "error") return interfaces;
  return {
    status: "ok",
    data: buildCoverageMatrix({
      requirements: requirements.data,
      coverage: coverage.data,
      components: components.data,
      interfaces: interfaces.data,
    }),
  };
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function mapQuestion(row: Row<"system_questions">): SystemQuestion {
  return {
    id: row.id,
    architectureId: row.architecture_id,
    projectId: row.project_id,
    question: row.question,
    status: row.status as SystemQuestionStatus,
    decisionId: row.decision_id,
    nextActionId: row.next_action_id,
    resolution: row.resolution,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadSystemQuestions(
  supabase: GhostClient,
  architectureId: string,
): Promise<QueryResult<SystemQuestion[]>> {
  const result = await supabase
    .from("system_questions")
    .select("*")
    .eq("architecture_id", architectureId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (isMissing(result.error.message, "system_questions")) return { status: "ok", data: [] };
    return fromError(result.error);
  }
  return { status: "ok", data: result.data.map(mapQuestion) };
}

export async function createSystemQuestion(
  supabase: GhostClient,
  input: { architectureId: string; projectId: string; question: string },
): Promise<QueryResult<SystemQuestion>> {
  const inserted = await supabase
    .from("system_questions")
    .insert({
      architecture_id: input.architectureId,
      project_id: input.projectId,
      question: input.question.trim(),
      status: "OPEN",
    })
    .select("*")
    .single();
  if (inserted.error) return fromError(inserted.error);
  return { status: "ok", data: mapQuestion(inserted.data) };
}

export async function updateSystemQuestion(
  supabase: GhostClient,
  questionId: string,
  patch: Partial<{ status: SystemQuestionStatus; resolution: string; decisionId: string | null; nextActionId: string | null }>,
): Promise<QueryResult<SystemQuestion>> {
  const payload: Database["public"]["Tables"]["system_questions"]["Update"] = { updated_at: now() };
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.resolution !== undefined) payload.resolution = patch.resolution;
  if (patch.decisionId !== undefined) payload.decision_id = patch.decisionId;
  if (patch.nextActionId !== undefined) payload.next_action_id = patch.nextActionId;
  const updated = await supabase.from("system_questions").update(payload).eq("id", questionId).select("*").single();
  if (updated.error) return fromError(updated.error);
  return { status: "ok", data: mapQuestion(updated.data) };
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

/** Loads every record the page, readiness gate, and Ask Ghost context depend on. */
export async function loadSystemArchitectureBundle(
  supabase: GhostClient,
  architecture: SystemArchitecture,
): Promise<QueryResult<SystemArchitectureBundle>> {
  const [
    components,
    entities,
    fields,
    relationships,
    interfaces,
    dataFlows,
    integrations,
    envConfigs,
    risks,
    constraints,
    coverage,
    questions,
    requirements,
    product,
    openDecisions,
  ] = await Promise.all([
    loadSystemComponents(supabase, architecture.id),
    loadSystemEntities(supabase, architecture.id),
    loadSystemEntityFields(supabase, architecture.id),
    loadSystemRelationships(supabase, architecture.id),
    loadSystemInterfaces(supabase, architecture.id),
    loadSystemDataFlows(supabase, architecture.id),
    loadSystemIntegrations(supabase, architecture.id),
    loadSystemEnvConfigs(supabase, architecture.id),
    loadSystemRisks(supabase, architecture.id),
    loadSystemConstraints(supabase, architecture.id),
    loadSystemCoverage(supabase, architecture.id),
    loadSystemQuestions(supabase, architecture.id),
    loadProductRequirements(supabase, architecture.productArchitectureId),
    loadProductArchitecture(supabase, architecture.projectId),
    supabase.from("project_decisions").select("id").eq("project_id", architecture.projectId).eq("status", "OPEN"),
  ]);

  for (const result of [
    components,
    entities,
    fields,
    relationships,
    interfaces,
    dataFlows,
    integrations,
    envConfigs,
    risks,
    constraints,
    coverage,
    questions,
    requirements,
    product,
  ]) {
    if (result.status === "error") return { status: "error", message: result.message };
  }
  if (
    components.status !== "ok" ||
    entities.status !== "ok" ||
    fields.status !== "ok" ||
    relationships.status !== "ok" ||
    interfaces.status !== "ok" ||
    dataFlows.status !== "ok" ||
    integrations.status !== "ok" ||
    envConfigs.status !== "ok" ||
    risks.status !== "ok" ||
    constraints.status !== "ok" ||
    coverage.status !== "ok" ||
    questions.status !== "ok" ||
    requirements.status !== "ok" ||
    product.status !== "ok"
  ) {
    return { status: "error", message: "System architecture records could not be loaded." };
  }

  return {
    status: "ok",
    data: {
      architecture,
      components: components.data,
      entities: entities.data,
      fields: fields.data,
      relationships: relationships.data,
      interfaces: interfaces.data,
      dataFlows: dataFlows.data,
      integrations: integrations.data,
      envConfigs: envConfigs.data,
      risks: risks.data,
      constraints: constraints.data,
      coverage: coverage.data,
      questions: questions.data,
      requirements: requirements.data,
      productStatus: product.data?.status ?? null,
      openDecisionCount: openDecisions.data?.length ?? 0,
    },
  };
}
