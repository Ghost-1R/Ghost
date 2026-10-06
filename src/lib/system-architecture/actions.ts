"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import { createNextAction } from "@/lib/operations/actions";
import { initializeSystemArchitectureFromProject } from "./initialize";
import {
  createSystemComponent,
  createSystemConstraint,
  createSystemDataFlow,
  createSystemEntity,
  createSystemEntityField,
  createSystemEnvConfig,
  createSystemIntegration,
  createSystemInterface,
  createSystemQuestion,
  createSystemRelationship,
  createSystemRisk,
  loadSystemArchitecture,
  loadSystemArchitectureBundle,
  recordSystemArchitectureTransition,
  updateSystemArchitectureOverview,
  updateSystemComponent,
  updateSystemConstraint,
  updateSystemDataFlow,
  updateSystemEntity,
  updateSystemEntityField,
  updateSystemEnvConfig,
  updateSystemIntegration,
  updateSystemInterface,
  updateSystemQuestion,
  updateSystemRelationship,
  updateSystemRisk,
  upsertRequirementCoverage,
} from "./queries";
import {
  CONFIG_CLASSIFICATIONS,
  COVERAGE_STATUSES,
  RELATIONSHIP_CARDINALITIES,
  SENSITIVE_CLASSES,
  SYSTEM_ARCHITECTURE_STATUSES,
  SYSTEM_COMPONENT_TYPES,
  SYSTEM_QUESTION_STATUSES,
  SYSTEM_RECORD_STATUSES,
  TECH_RISK_SEVERITIES,
  type SystemArchitecture,
  type SystemArchitectureStatus,
} from "./types";
import {
  canTransitionSystemArchitecture,
  evaluateSystemBundle,
  isValidEnvVariableName,
  isValidSecretName,
  suggestSystemNextAction,
} from "./workflow";

type Session = Extract<Awaited<ReturnType<typeof getSession>>, { status: "authenticated" }>;

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readBool(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function readEnum<T extends string>(formData: FormData, name: string, allowed: readonly T[], fallback: T): T {
  const value = readField(formData, name);
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readOptionalEnum<T extends string>(formData: FormData, name: string, allowed: readonly T[]): T | undefined {
  const value = readField(formData, name);
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

/** JSON object when valid, otherwise the text is kept as a description. Never executed. */
function parseShape(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  return { description: text };
}

function revalidateSystem(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/architecture`);
  revalidatePath("/dashboard");
}

async function authenticated(): Promise<Session | null> {
  const session = await getSession();
  return session.status === "authenticated" ? session : null;
}

const NOT_SIGNED_IN: ActionState = { error: "You are not signed in.", notice: null };

/** The architecture for the project, from the server — never trusted from hidden form fields. */
async function architectureFor(
  session: Session,
  projectId: string,
): Promise<{ architecture: SystemArchitecture } | { error: ActionState }> {
  const architecture = await loadSystemArchitecture(session.supabase, projectId);
  if (architecture.status === "error") return { error: { error: architecture.message, notice: null } };
  if (!architecture.data) return { error: { error: "System Architecture is not initialized for this project.", notice: null } };
  return { architecture: architecture.data };
}

export async function initializeSystemArchitectureAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const created = await initializeSystemArchitectureFromProject(session.supabase, { projectId });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  redirect(`/projects/${projectId}/architecture`);
}

export async function saveSystemOverviewAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const saved = await updateSystemArchitectureOverview(session.supabase, target.architecture.id, {
    summary: readField(formData, "summary"),
    authSummary: readField(formData, "authSummary"),
    authorizationSummary: readField(formData, "authorizationSummary"),
    runtimeTopology: linesToList(readField(formData, "runtimeTopology")),
    note: readField(formData, "note"),
  });
  if (saved.status === "error") return { error: saved.message, notice: null };
  if (target.architecture.status === "DRAFT") {
    await recordSystemArchitectureTransition(
      session.supabase,
      target.architecture.id,
      "DESIGNING",
      "Founder saved system architecture overview.",
    );
  }
  revalidateSystem(projectId);
  return { error: null, notice: "System overview saved. Design is not implementation." };
}

export async function transitionSystemArchitectureAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const toStatus = readField(formData, "toStatus") as SystemArchitectureStatus;
  if (!SYSTEM_ARCHITECTURE_STATUSES.includes(toStatus)) return { error: "Unknown system architecture status.", notice: null };
  const reason = readField(formData, "reason") || `Founder moved System Architecture to ${toStatus}.`;

  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  if (!canTransitionSystemArchitecture(target.architecture.status, toStatus)) {
    return { error: `Cannot move System Architecture from ${target.architecture.status} to ${toStatus}.`, notice: null };
  }

  if (toStatus === "ARCHITECTURE_READY") {
    const bundle = await loadSystemArchitectureBundle(session.supabase, target.architecture);
    if (bundle.status === "error") return { error: bundle.message, notice: null };
    const { blockers } = evaluateSystemBundle(bundle.data);
    if (blockers.length > 0) {
      return {
        error: `Not ARCHITECTURE READY (${blockers.length} blocker${blockers.length === 1 ? "" : "s"}). ${blockers[0].message}`,
        notice: null,
      };
    }
  }

  const transitioned = await recordSystemArchitectureTransition(session.supabase, target.architecture.id, toStatus, reason);
  if (transitioned.status === "error") return { error: transitioned.message, notice: null };
  revalidateSystem(projectId);
  return {
    error: null,
    notice:
      toStatus === "ARCHITECTURE_READY"
        ? "System Architecture is ARCHITECTURE_READY. This is a design, not an implementation or deployment."
        : `System Architecture is now ${toStatus}.`,
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export async function createSystemComponentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createSystemComponent(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    name: readField(formData, "name"),
    purpose: readField(formData, "purpose"),
    componentType: readEnum(formData, "componentType", SYSTEM_COMPONENT_TYPES, "OTHER"),
    responsibilities: linesToList(readField(formData, "responsibilities")),
    dependencyRefs: linesToList(readField(formData, "dependencyRefs")),
    requirementIds: formData.getAll("requirementIds").map(String).filter(Boolean),
    status: "PROPOSED",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `${created.data.humanId} proposed. Not approved until you approve it.` };
}

export async function updateSystemComponentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const status = readOptionalEnum(formData, "status", SYSTEM_RECORD_STATUSES);
  const updated = await updateSystemComponent(session.supabase, readField(formData, "componentId"), {
    name: readField(formData, "name") || undefined,
    purpose: formData.has("purpose") ? readField(formData, "purpose") : undefined,
    componentType: readOptionalEnum(formData, "componentType", SYSTEM_COMPONENT_TYPES),
    responsibilities: formData.has("responsibilities") ? linesToList(readField(formData, "responsibilities")) : undefined,
    dependencyRefs: formData.has("dependencyRefs") ? linesToList(readField(formData, "dependencyRefs")) : undefined,
    requirementIds: formData.has("requirementsPresent")
      ? formData.getAll("requirementIds").map(String).filter(Boolean)
      : undefined,
    status,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: status === "APPROVED" ? `${updated.data.humanId} approved by founder.` : `${updated.data.humanId} updated.` };
}

// ---------------------------------------------------------------------------
// Database: entities, fields, relationships
// ---------------------------------------------------------------------------

export async function createSystemEntityAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createSystemEntity(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    name: readField(formData, "name"),
    purpose: readField(formData, "purpose"),
    ownershipField: readField(formData, "ownershipField"),
    rlsExpectation: readField(formData, "rlsExpectation"),
    retentionNote: readField(formData, "retentionNote"),
    sensitiveClass: readEnum(formData, "sensitiveClass", SENSITIVE_CLASSES, "NONE"),
    status: "PROPOSED",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `${created.data.humanId} proposed as a designed table. It is not a deployed table.` };
}

export async function updateSystemEntityAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const status = readOptionalEnum(formData, "status", SYSTEM_RECORD_STATUSES);
  const updated = await updateSystemEntity(session.supabase, readField(formData, "entityId"), {
    name: readField(formData, "name") || undefined,
    purpose: formData.has("purpose") ? readField(formData, "purpose") : undefined,
    ownershipField: formData.has("ownershipField") ? readField(formData, "ownershipField") : undefined,
    rlsExpectation: formData.has("rlsExpectation") ? readField(formData, "rlsExpectation") : undefined,
    retentionNote: formData.has("retentionNote") ? readField(formData, "retentionNote") : undefined,
    sensitiveClass: readOptionalEnum(formData, "sensitiveClass", SENSITIVE_CLASSES),
    status,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: status === "APPROVED" ? `${updated.data.humanId} approved by founder.` : `${updated.data.humanId} updated.` };
}

export async function createSystemFieldAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const defaultValue = readField(formData, "defaultValue");
  if (/(sk-|gsk_|eyJ)/i.test(defaultValue)) {
    return { error: "A default value looks like a secret. Ghost never stores secret values.", notice: null };
  }
  const created = await createSystemEntityField(session.supabase, {
    entityId: readField(formData, "entityId"),
    architectureId: target.architecture.id,
    projectId,
    name: readField(formData, "name"),
    dataType: readField(formData, "dataType"),
    nullable: readBool(formData, "nullable"),
    defaultValue,
    isPk: readBool(formData, "isPk"),
    isUnique: readBool(formData, "isUnique"),
    isFk: readBool(formData, "isFk"),
    referencesEntityId: readField(formData, "referencesEntityId") || null,
    sensitiveClass: readEnum(formData, "sensitiveClass", SENSITIVE_CLASSES, "NONE"),
    note: readField(formData, "note"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `Field ${created.data.name} added to the design.` };
}

export async function updateSystemFieldAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const defaultValue = readField(formData, "defaultValue");
  if (/(sk-|gsk_|eyJ)/i.test(defaultValue)) {
    return { error: "A default value looks like a secret. Ghost never stores secret values.", notice: null };
  }
  const updated = await updateSystemEntityField(session.supabase, readField(formData, "fieldId"), {
    name: readField(formData, "name") || undefined,
    dataType: readField(formData, "dataType") || undefined,
    nullable: readBool(formData, "nullable"),
    defaultValue,
    isPk: readBool(formData, "isPk"),
    isUnique: readBool(formData, "isUnique"),
    isFk: readBool(formData, "isFk"),
    referencesEntityId: readField(formData, "referencesEntityId") || null,
    sensitiveClass: readOptionalEnum(formData, "sensitiveClass", SENSITIVE_CLASSES),
    note: readField(formData, "note"),
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `Field ${updated.data.name} updated.` };
}

export async function createSystemRelationshipAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const sourceEntityId = readField(formData, "sourceEntityId");
  const targetEntityId = readField(formData, "targetEntityId");
  if (!sourceEntityId || !targetEntityId) return { error: "Choose a source and target entity.", notice: null };
  const created = await createSystemRelationship(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    sourceEntityId,
    targetEntityId,
    cardinality: readEnum(formData, "cardinality", RELATIONSHIP_CARDINALITIES, "ONE_TO_MANY"),
    fkStrategy: readField(formData, "fkStrategy"),
    deleteBehavior: readField(formData, "deleteBehavior"),
    rationale: readField(formData, "rationale"),
    junctionStrategy: readField(formData, "junctionStrategy"),
    status: "PROPOSED",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `${created.data.humanId} proposed.` };
}

export async function updateSystemRelationshipAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const status = readOptionalEnum(formData, "status", SYSTEM_RECORD_STATUSES);
  const updated = await updateSystemRelationship(session.supabase, readField(formData, "relationshipId"), {
    cardinality: readOptionalEnum(formData, "cardinality", RELATIONSHIP_CARDINALITIES),
    fkStrategy: formData.has("fkStrategy") ? readField(formData, "fkStrategy") : undefined,
    deleteBehavior: formData.has("deleteBehavior") ? readField(formData, "deleteBehavior") : undefined,
    rationale: formData.has("rationale") ? readField(formData, "rationale") : undefined,
    junctionStrategy: formData.has("junctionStrategy") ? readField(formData, "junctionStrategy") : undefined,
    status,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: status === "APPROVED" ? `${updated.data.humanId} approved by founder.` : `${updated.data.humanId} updated.` };
}

// ---------------------------------------------------------------------------
// Interfaces and data flows
// ---------------------------------------------------------------------------

export async function createSystemInterfaceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createSystemInterface(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    name: readField(formData, "name"),
    purpose: readField(formData, "purpose"),
    caller: readField(formData, "caller"),
    receiver: readField(formData, "receiver"),
    operation: readField(formData, "operation"),
    inputShape: parseShape(readField(formData, "inputShape")),
    outputShape: parseShape(readField(formData, "outputShape")),
    authRequired: formData.has("authRequiredPresent") ? readBool(formData, "authRequired") : true,
    failureBehavior: readField(formData, "failureBehavior"),
    requirementIds: formData.getAll("requirementIds").map(String).filter(Boolean),
    status: "PROPOSED",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `${created.data.humanId} proposed as a designed interface. It is not a live endpoint.` };
}

export async function updateSystemInterfaceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const status = readOptionalEnum(formData, "status", SYSTEM_RECORD_STATUSES);
  const updated = await updateSystemInterface(session.supabase, readField(formData, "interfaceId"), {
    name: readField(formData, "name") || undefined,
    purpose: formData.has("purpose") ? readField(formData, "purpose") : undefined,
    caller: formData.has("caller") ? readField(formData, "caller") : undefined,
    receiver: formData.has("receiver") ? readField(formData, "receiver") : undefined,
    operation: formData.has("operation") ? readField(formData, "operation") : undefined,
    inputShape: formData.has("inputShape") ? parseShape(readField(formData, "inputShape")) : undefined,
    outputShape: formData.has("outputShape") ? parseShape(readField(formData, "outputShape")) : undefined,
    authRequired: formData.has("authRequiredPresent") ? readBool(formData, "authRequired") : undefined,
    failureBehavior: formData.has("failureBehavior") ? readField(formData, "failureBehavior") : undefined,
    requirementIds: formData.has("requirementsPresent")
      ? formData.getAll("requirementIds").map(String).filter(Boolean)
      : undefined,
    status,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: status === "APPROVED" ? `${updated.data.humanId} approved by founder.` : `${updated.data.humanId} updated.` };
}

export async function createSystemDataFlowAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createSystemDataFlow(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    name: readField(formData, "name"),
    sourceLabel: readField(formData, "sourceLabel"),
    processLabel: readField(formData, "processLabel"),
    storageLabel: readField(formData, "storageLabel"),
    resultLabel: readField(formData, "resultLabel"),
    steps: linesToList(readField(formData, "steps")),
    componentRefs: linesToList(readField(formData, "componentRefs")),
    status: "PROPOSED",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `${created.data.humanId} proposed.` };
}

export async function updateSystemDataFlowAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const status = readOptionalEnum(formData, "status", SYSTEM_RECORD_STATUSES);
  const updated = await updateSystemDataFlow(session.supabase, readField(formData, "flowId"), {
    name: readField(formData, "name") || undefined,
    sourceLabel: formData.has("sourceLabel") ? readField(formData, "sourceLabel") : undefined,
    processLabel: formData.has("processLabel") ? readField(formData, "processLabel") : undefined,
    storageLabel: formData.has("storageLabel") ? readField(formData, "storageLabel") : undefined,
    resultLabel: formData.has("resultLabel") ? readField(formData, "resultLabel") : undefined,
    steps: formData.has("steps") ? linesToList(readField(formData, "steps")) : undefined,
    componentRefs: formData.has("componentRefs") ? linesToList(readField(formData, "componentRefs")) : undefined,
    status,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: status === "APPROVED" ? `${updated.data.humanId} approved by founder.` : `${updated.data.humanId} updated.` };
}

// ---------------------------------------------------------------------------
// Integrations and env config — NAMES only, never values
// ---------------------------------------------------------------------------

function validateSecretNames(names: string[]): string | null {
  for (const name of names) {
    const check = isValidSecretName(name);
    if (!check.ok) return check.reason;
  }
  return null;
}

export async function createSystemIntegrationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const secretNames = linesToList(readField(formData, "secretNames"));
  const invalid = validateSecretNames(secretNames);
  if (invalid) return { error: invalid, notice: null };
  const created = await createSystemIntegration(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    provider: readField(formData, "provider"),
    purpose: readField(formData, "purpose"),
    required: readBool(formData, "required"),
    dataExchanged: linesToList(readField(formData, "dataExchanged")),
    secretNames,
    failureImpact: readField(formData, "failureImpact"),
    fallbackBehavior: readField(formData, "fallbackBehavior"),
    costNote: readField(formData, "costNote"),
    status: "PROPOSED",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `${created.data.humanId} proposed. Only secret names are stored.` };
}

export async function updateSystemIntegrationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const secretNames = formData.has("secretNames") ? linesToList(readField(formData, "secretNames")) : undefined;
  if (secretNames) {
    const invalid = validateSecretNames(secretNames);
    if (invalid) return { error: invalid, notice: null };
  }
  const status = readOptionalEnum(formData, "status", SYSTEM_RECORD_STATUSES);
  const updated = await updateSystemIntegration(session.supabase, readField(formData, "integrationId"), {
    provider: readField(formData, "provider") || undefined,
    purpose: formData.has("purpose") ? readField(formData, "purpose") : undefined,
    required: formData.has("requiredPresent") ? readBool(formData, "required") : undefined,
    dataExchanged: formData.has("dataExchanged") ? linesToList(readField(formData, "dataExchanged")) : undefined,
    secretNames,
    failureImpact: formData.has("failureImpact") ? readField(formData, "failureImpact") : undefined,
    fallbackBehavior: formData.has("fallbackBehavior") ? readField(formData, "fallbackBehavior") : undefined,
    costNote: formData.has("costNote") ? readField(formData, "costNote") : undefined,
    status,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: status === "APPROVED" ? `${updated.data.humanId} approved by founder.` : `${updated.data.humanId} updated.` };
}

export async function createSystemEnvConfigAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const variableName = readField(formData, "variableName");
  const check = isValidEnvVariableName(variableName);
  if (!check.ok) return { error: check.reason, notice: null };
  const created = await createSystemEnvConfig(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    variableName,
    purpose: readField(formData, "purpose"),
    classification: readEnum(formData, "classification", CONFIG_CLASSIFICATIONS, "SERVER_SECRET"),
    requiredEnvironments: linesToList(readField(formData, "requiredEnvironments")),
    status: "PROPOSED",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `${created.data.variableName} recorded by name only. No value is stored.` };
}

export async function updateSystemEnvConfigAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const status = readOptionalEnum(formData, "status", SYSTEM_RECORD_STATUSES);
  const updated = await updateSystemEnvConfig(session.supabase, readField(formData, "envConfigId"), {
    purpose: formData.has("purpose") ? readField(formData, "purpose") : undefined,
    classification: readOptionalEnum(formData, "classification", CONFIG_CLASSIFICATIONS),
    requiredEnvironments: formData.has("requiredEnvironments")
      ? linesToList(readField(formData, "requiredEnvironments"))
      : undefined,
    status,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `${updated.data.variableName} updated.` };
}

// ---------------------------------------------------------------------------
// Risks and constraints
// ---------------------------------------------------------------------------

export async function createSystemRiskAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createSystemRisk(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    description: readField(formData, "description"),
    severity: readEnum(formData, "severity", TECH_RISK_SEVERITIES, "MEDIUM"),
    likelihood: readField(formData, "likelihood"),
    mitigation: readField(formData, "mitigation"),
    linkedComponentRefs: linesToList(readField(formData, "linkedComponentRefs")),
    status: "PROPOSED",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `${created.data.humanId} proposed.` };
}

export async function updateSystemRiskAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const status = readOptionalEnum(formData, "status", SYSTEM_RECORD_STATUSES);
  const updated = await updateSystemRisk(session.supabase, readField(formData, "riskId"), {
    description: readField(formData, "description") || undefined,
    severity: readOptionalEnum(formData, "severity", TECH_RISK_SEVERITIES),
    likelihood: formData.has("likelihood") ? readField(formData, "likelihood") : undefined,
    mitigation: formData.has("mitigation") ? readField(formData, "mitigation") : undefined,
    linkedComponentRefs: formData.has("linkedComponentRefs")
      ? linesToList(readField(formData, "linkedComponentRefs"))
      : undefined,
    status,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: status === "APPROVED" ? `${updated.data.humanId} approved by founder.` : `${updated.data.humanId} updated.` };
}

export async function createSystemConstraintAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createSystemConstraint(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    statement: readField(formData, "statement"),
    constraintSource: readField(formData, "constraintSource") || "founder",
    // A constraint is only authoritative when the founder says so.
    authoritative: readBool(formData, "authoritative"),
    provenance: "founder",
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: "Technical constraint recorded." };
}

export async function updateSystemConstraintAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const updated = await updateSystemConstraint(session.supabase, readField(formData, "constraintId"), {
    statement: readField(formData, "statement") || undefined,
    constraintSource: formData.has("constraintSource") ? readField(formData, "constraintSource") : undefined,
    authoritative: formData.has("authoritativePresent") ? readBool(formData, "authoritative") : undefined,
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: "Technical constraint updated." };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export async function saveRequirementCoverageAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const requirementId = readField(formData, "requirementId");
  if (!requirementId) return { error: "Choose a requirement.", notice: null };
  const saved = await upsertRequirementCoverage(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    requirementId,
    coverage: readEnum(formData, "coverage", COVERAGE_STATUSES, "NOT_COVERED"),
    supportingRefs: linesToList(readField(formData, "supportingRefs")),
    gapNote: readField(formData, "gapNote"),
  });
  if (saved.status === "error") return { error: saved.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `Coverage recorded as ${saved.data.coverage}.` };
}

// ---------------------------------------------------------------------------
// Questions / decisions
// ---------------------------------------------------------------------------

export async function createSystemQuestionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const created = await createSystemQuestion(session.supabase, {
    architectureId: target.architecture.id,
    projectId,
    question: readField(formData, "question"),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: "Unresolved system question recorded." };
}

export async function resolveSystemQuestionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const updated = await updateSystemQuestion(session.supabase, readField(formData, "questionId"), {
    status: readEnum(formData, "status", SYSTEM_QUESTION_STATUSES, "RESOLVED"),
    resolution: readField(formData, "resolution"),
  });
  if (updated.status === "error") return { error: updated.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: "Question updated." };
}

export async function escalateSystemQuestionToDecisionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const questionId = readField(formData, "questionId");
  const question = readField(formData, "question");
  const inserted = await session.supabase
    .from("project_decisions")
    .insert({
      project_id: projectId,
      system_architecture_id: target.architecture.id,
      title: readField(formData, "title") || question.slice(0, 120),
      question,
      context: "Escalated from System Architecture unresolved questions.",
      options: [
        readField(formData, "optionA") ? { id: "a", label: readField(formData, "optionA") } : null,
        readField(formData, "optionB") ? { id: "b", label: readField(formData, "optionB") } : null,
      ].filter(Boolean),
      recommendation: readField(formData, "recommendation") || null,
      evidence: [{ type: "system_question", id: questionId, title: question.slice(0, 80) }],
      created_by: session.user.id,
      status: "OPEN",
    })
    .select("id")
    .single();
  if (inserted.error) return { error: inserted.error.message, notice: null };
  await updateSystemQuestion(session.supabase, questionId, { status: "ESCALATED", decisionId: inserted.data.id });
  revalidateSystem(projectId);
  return { error: null, notice: "Question escalated to Needs Your Decision." };
}

// ---------------------------------------------------------------------------
// Next action
// ---------------------------------------------------------------------------

export async function syncSystemNextActionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const session = await authenticated();
  if (!session) return NOT_SIGNED_IN;
  const projectId = readField(formData, "projectId");
  const target = await architectureFor(session, projectId);
  if ("error" in target) return target.error;
  const bundle = await loadSystemArchitectureBundle(session.supabase, target.architecture);
  if (bundle.status === "error") return { error: bundle.message, notice: null };
  const { readiness, defects } = evaluateSystemBundle(bundle.data);
  const data = bundle.data;
  const proposedRecordCount = [
    data.components,
    data.entities,
    data.relationships,
    data.interfaces,
    data.dataFlows,
    data.integrations,
    data.envConfigs,
    data.risks,
  ].reduce((sum, rows) => sum + rows.filter((row) => row.status === "PROPOSED").length, 0);
  const suggestion = suggestSystemNextAction({
    readiness,
    defects,
    architectureStatus: data.architecture.status,
    summaryPresent: data.architecture.summary.trim().length > 0,
    componentCount: data.components.length,
    proposedRecordCount,
  });
  if (!suggestion) {
    return { error: null, notice: "No System Architecture next action is justified by current records." };
  }
  const created = await createNextAction(session.supabase, {
    projectId,
    title: suggestion.title,
    description: suggestion.description,
    provenance: "FOUNDER_APPROVED_ACTION",
    sourceKind: suggestion.sourceKind,
    sourceRef: data.architecture.id,
    priority: "HIGH",
    requiresDecision: /decision|question/i.test(suggestion.title),
  });
  if (created.status === "error") return { error: created.message, notice: null };
  revalidateSystem(projectId);
  return { error: null, notice: `Next action recorded: ${created.data.title}` };
}
