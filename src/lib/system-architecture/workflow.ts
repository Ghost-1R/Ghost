import type { ProductArchitectureStatus, ProductRequirement } from "@/lib/product-architect/types";
import type {
  CoverageMatrixRow,
  CoverageStatus,
  SystemArchitectureBundle,
  SystemArchitectureStatus,
  SystemComponent,
  SystemEntity,
  SystemEntityField,
  SystemInterface,
  SystemQuestion,
  SystemRecordStatus,
  SystemRelationship,
  SystemRequirementCoverage,
} from "./types";

export const LEGAL_SYSTEM_ARCHITECTURE_TRANSITIONS: Record<
  SystemArchitectureStatus,
  readonly SystemArchitectureStatus[]
> = {
  DRAFT: ["DESIGNING", "REVIEW"],
  DESIGNING: ["DRAFT", "REVIEW"],
  REVIEW: ["DESIGNING", "APPROVED", "DRAFT"],
  APPROVED: ["REVIEW", "ARCHITECTURE_READY", "DESIGNING"],
  ARCHITECTURE_READY: ["APPROVED", "REVIEW"],
};

export function canTransitionSystemArchitecture(from: SystemArchitectureStatus, to: SystemArchitectureStatus): boolean {
  return LEGAL_SYSTEM_ARCHITECTURE_TRANSITIONS[from].includes(to);
}

export type SystemHumanIdPrefix = "COMP" | "ENT" | "REL" | "API" | "DFLOW" | "INTG" | "RISK";

export function nextHumanId(prefix: SystemHumanIdPrefix, existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/** A record the founder has not rejected or retired. */
export function isLiveRecord(status: SystemRecordStatus): boolean {
  return status === "PROPOSED" || status === "APPROVED";
}

export function isApprovedRecord(status: SystemRecordStatus): boolean {
  return status === "APPROVED";
}

/**
 * Secret VALUES are never stored. Names only. This rejects anything that looks like a key, token,
 * JWT, or inline credential assignment.
 */
export function looksLikeSecretValue(text: string): boolean {
  return /(sk-[A-Za-z0-9]|gsk_|eyJ[A-Za-z0-9]|(secret|password|token|key)\s*[=:]\s*\S|[A-Za-z0-9+/]{40,}={0,2})/i.test(text);
}

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** Mirrors the database check on system_env_configs.variable_name. */
export function isValidEnvVariableName(name: string): { ok: boolean; reason: string | null } {
  const value = name.trim();
  if (!NAME_PATTERN.test(value)) {
    return { ok: false, reason: "Use an environment variable NAME such as SUPABASE_URL (letters, digits, underscore)." };
  }
  if (looksLikeSecretValue(value) || /(sk-|gsk_|eyJ|password|secret=)/i.test(value)) {
    return { ok: false, reason: "That looks like a secret value or contains a blocked word. Store the variable NAME only." };
  }
  return { ok: true, reason: null };
}

export function isValidSecretName(name: string): { ok: boolean; reason: string | null } {
  const value = name.trim();
  if (!NAME_PATTERN.test(value)) {
    return { ok: false, reason: `"${value.slice(0, 40)}" is not a valid secret NAME. Store names such as STRIPE_API_KEY, never values.` };
  }
  if (looksLikeSecretValue(value)) {
    return { ok: false, reason: "That looks like a secret value. Store the secret NAME only." };
  }
  return { ok: true, reason: null };
}

export type SystemReadinessGap = {
  code: string;
  message: string;
};

export type SystemReadinessResult = {
  architectureReady: boolean;
  gaps: SystemReadinessGap[];
  reasons: string[];
};

export type SchemaDefect = {
  code: string;
  message: string;
};

type EntityLike = Pick<SystemEntity, "id" | "humanId" | "name" | "ownershipField" | "rlsExpectation" | "sensitiveClass" | "status">;
type FieldLike = Pick<
  SystemEntityField,
  "entityId" | "name" | "isPk" | "isFk" | "referencesEntityId" | "sensitiveClass"
>;
type RelationshipLike = Pick<
  SystemRelationship,
  "humanId" | "sourceEntityId" | "targetEntityId" | "cardinality" | "junctionStrategy" | "status"
>;

/** Deterministic schema validation for the designed database. Never AI-decided. */
export function validateSchemaDefects(input: {
  entities: EntityLike[];
  fields: FieldLike[];
  relationships: RelationshipLike[];
}): SchemaDefect[] {
  const defects: SchemaDefect[] = [];
  const entities = input.entities.filter((entity) => isLiveRecord(entity.status));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));

  for (const entity of entities) {
    const fields = input.fields.filter((field) => field.entityId === entity.id);

    if (!fields.some((field) => field.isPk)) {
      defects.push({ code: `NO_PK_${entity.humanId}`, message: `${entity.humanId} (${entity.name}) has no primary key field.` });
    }

    const seen = new Set<string>();
    for (const field of fields) {
      const key = field.name.trim().toLowerCase();
      if (seen.has(key)) {
        defects.push({
          code: `DUP_FIELD_${entity.humanId}_${key}`,
          message: `${entity.humanId} has duplicate field name "${field.name}".`,
        });
      }
      seen.add(key);

      if (field.isFk) {
        const target = field.referencesEntityId ? entityById.get(field.referencesEntityId) : undefined;
        if (!target) {
          defects.push({
            code: `FK_MISSING_ENTITY_${entity.humanId}_${key}`,
            message: `${entity.humanId}.${field.name} is a foreign key but references no live entity.`,
          });
        }
      }
    }

    const ownerSignal =
      /owner|per[- ]user|user[- ]scoped|own rows|tenant/i.test(entity.rlsExpectation) ||
      fields.some((field) => /^(user|owner)_id$/i.test(field.name.trim()));
    if (ownerSignal && !entity.ownershipField.trim()) {
      defects.push({
        code: `NO_OWNERSHIP_${entity.humanId}`,
        message: `${entity.humanId} is owner-scoped but has no ownership_field.`,
      });
    }

    const sensitive = entity.sensitiveClass !== "NONE" || fields.some((field) => field.sensitiveClass !== "NONE");
    if (sensitive && !entity.rlsExpectation.trim()) {
      defects.push({
        code: `NO_RLS_${entity.humanId}`,
        message: `${entity.humanId} holds sensitive data but has no rls_expectation.`,
      });
    }
  }

  for (const relationship of input.relationships.filter((row) => isLiveRecord(row.status))) {
    if (!entityById.has(relationship.sourceEntityId) || !entityById.has(relationship.targetEntityId)) {
      defects.push({
        code: `REL_ENTITY_${relationship.humanId}`,
        message: `${relationship.humanId} references an entity that is missing, rejected, or retired.`,
      });
    }
    if (relationship.cardinality === "MANY_TO_MANY" && !relationship.junctionStrategy.trim()) {
      defects.push({
        code: `REL_M2M_${relationship.humanId}`,
        message: `${relationship.humanId} is many-to-many but has no junction_strategy.`,
      });
    }
  }

  return defects;
}

export type SystemReadinessInput = {
  architecture: {
    summary: string;
    authSummary: string;
    authorizationSummary: string;
    status: SystemArchitectureStatus;
  };
  components: Array<Pick<SystemComponent, "humanId" | "componentType" | "status">>;
  entities: EntityLike[];
  fields: FieldLike[];
  relationships: RelationshipLike[];
  requirements: Array<Pick<ProductRequirement, "id" | "humanId" | "approvalStatus" | "priority">>;
  coverage: Array<Pick<SystemRequirementCoverage, "requirementId" | "coverage">>;
  openQuestions: Array<Pick<SystemQuestion, "question" | "status">>;
  openDecisions: number;
  productStatus: ProductArchitectureStatus | null;
};

/** Deterministic readiness — never AI-decided. Design-ready is not implemented or deployed. */
export function computeSystemReadiness(input: SystemReadinessInput): SystemReadinessResult {
  const gaps: SystemReadinessGap[] = [];

  if (!input.architecture.summary.trim()) {
    gaps.push({ code: "SUMMARY", message: "System architecture summary is missing." });
  }

  const liveComponents = input.components.filter((row) => isLiveRecord(row.status));
  const liveEntities = input.entities.filter((row) => isLiveRecord(row.status));
  const needsAuth =
    liveComponents.some((row) => row.componentType === "AUTH") ||
    liveEntities.some((row) => row.ownershipField.trim().length > 0);
  if (needsAuth && !input.architecture.authSummary.trim()) {
    gaps.push({ code: "AUTH_SUMMARY", message: "Authentication summary is required (AUTH component or user-owned entities exist)." });
  }
  if (needsAuth && !input.architecture.authorizationSummary.trim()) {
    gaps.push({ code: "AUTHZ_SUMMARY", message: "Authorization summary is required (AUTH component or user-owned entities exist)." });
  }

  if (!input.components.some((row) => row.status === "APPROVED")) {
    gaps.push({ code: "NO_APPROVED_COMPONENT", message: "No approved component yet." });
  }

  const entityHasPk = liveEntities.some((entity) =>
    input.fields.some((field) => field.entityId === entity.id && field.isPk),
  );
  if (!entityHasPk) {
    gaps.push({ code: "NO_ENTITY_WITH_PK", message: "At least one entity with a primary key field is required." });
  }

  const entityIds = new Set(liveEntities.map((entity) => entity.id));
  for (const relationship of input.relationships.filter((row) => isLiveRecord(row.status))) {
    if (!entityIds.has(relationship.sourceEntityId) || !entityIds.has(relationship.targetEntityId)) {
      gaps.push({
        code: `REL_ENTITY_${relationship.humanId}`,
        message: `${relationship.humanId} references an entity that is missing, rejected, or retired.`,
      });
    }
    if (relationship.cardinality === "MANY_TO_MANY" && !relationship.junctionStrategy.trim()) {
      gaps.push({
        code: `REL_M2M_${relationship.humanId}`,
        message: `${relationship.humanId} is many-to-many but has no junction_strategy.`,
      });
    }
  }

  const coverageByRequirement = new Map(input.coverage.map((row) => [row.requirementId, row.coverage]));
  for (const requirement of input.requirements) {
    if (requirement.approvalStatus !== "ACCEPTED") continue;
    if (requirement.priority !== "CRITICAL" && requirement.priority !== "HIGH") continue;
    const coverage = coverageByRequirement.get(requirement.id) ?? "NOT_COVERED";
    if (coverage === "NOT_COVERED") {
      gaps.push({
        code: `COVERAGE_${requirement.humanId}`,
        message: `Accepted ${requirement.priority} requirement ${requirement.humanId} is NOT_COVERED by the system design.`,
      });
    }
  }

  for (const question of input.openQuestions.filter((row) => row.status === "OPEN" || row.status === "ESCALATED")) {
    gaps.push({ code: "OPEN_QUESTION", message: `Resolve system architecture question: ${question.question}` });
  }

  if (input.openDecisions > 0) {
    gaps.push({
      code: "OPEN_DECISIONS",
      message: `Resolve ${input.openDecisions} open decision${input.openDecisions === 1 ? "" : "s"}.`,
    });
  }

  if (input.productStatus !== "BUILD_READY") {
    gaps.push({
      code: "PRODUCT_NOT_BUILD_READY",
      message: `Product Architecture is ${input.productStatus ?? "missing"}; it must be BUILD_READY.`,
    });
  }

  if (input.architecture.status !== "APPROVED" && input.architecture.status !== "ARCHITECTURE_READY") {
    gaps.push({
      code: "NOT_APPROVED",
      message: `System architecture status is ${input.architecture.status}; founder approval is required before ARCHITECTURE_READY.`,
    });
  }

  const architectureReady = gaps.length === 0;
  return {
    architectureReady,
    gaps,
    reasons: architectureReady
      ? [
          "System summary present",
          "Approved components and a keyed database entity designed",
          "Critical and high requirements covered by the design",
          "Questions and decisions resolved",
          "Design is ready for a build plan. It is not implemented or deployed.",
        ]
      : gaps.map((gap) => gap.message),
  };
}

/** Readiness gaps plus schema defects, de-duplicated by code. Used to gate ARCHITECTURE_READY. */
export function evaluateSystemBundle(bundle: SystemArchitectureBundle): {
  readiness: SystemReadinessResult;
  defects: SchemaDefect[];
  blockers: SystemReadinessGap[];
} {
  const readiness = computeSystemReadiness({
    architecture: bundle.architecture,
    components: bundle.components,
    entities: bundle.entities,
    fields: bundle.fields,
    relationships: bundle.relationships,
    requirements: bundle.requirements,
    coverage: bundle.coverage,
    openQuestions: bundle.questions,
    openDecisions: bundle.openDecisionCount,
    productStatus: bundle.productStatus,
  });
  const defects = validateSchemaDefects({
    entities: bundle.entities,
    fields: bundle.fields,
    relationships: bundle.relationships,
  });
  const seen = new Set(readiness.gaps.map((gap) => gap.code));
  const blockers = [...readiness.gaps, ...defects.filter((defect) => !seen.has(defect.code))];
  return { readiness, defects, blockers };
}

// ---------------------------------------------------------------------------
// Coverage matrix helpers
// ---------------------------------------------------------------------------

export function buildCoverageMatrix(input: {
  requirements: Array<Pick<ProductRequirement, "id" | "humanId" | "title" | "priority" | "approvalStatus">>;
  coverage: Array<Pick<SystemRequirementCoverage, "requirementId" | "coverage" | "gapNote" | "supportingRefs">>;
  components: Array<Pick<SystemComponent, "humanId" | "requirementIds">>;
  interfaces: Array<Pick<SystemInterface, "humanId" | "requirementIds">>;
}): CoverageMatrixRow[] {
  const byRequirement = new Map(input.coverage.map((row) => [row.requirementId, row]));
  return input.requirements
    .filter((requirement) => requirement.approvalStatus === "ACCEPTED")
    .map((requirement) => {
      const row = byRequirement.get(requirement.id);
      return {
        requirementId: requirement.id,
        humanId: requirement.humanId,
        title: requirement.title,
        priority: requirement.priority,
        approvalStatus: requirement.approvalStatus,
        coverage: row?.coverage ?? "NOT_COVERED",
        gapNote: row?.gapNote ?? "",
        supportingRefs: row?.supportingRefs ?? [],
        componentRefs: input.components.filter((item) => item.requirementIds.includes(requirement.id)).map((item) => item.humanId),
        interfaceRefs: input.interfaces.filter((item) => item.requirementIds.includes(requirement.id)).map((item) => item.humanId),
      };
    });
}

export function summarizeCoverage(rows: Array<{ coverage: CoverageStatus }>): Record<CoverageStatus, number> {
  const summary: Record<CoverageStatus, number> = {
    COVERED: 0,
    PARTIALLY_COVERED: 0,
    NOT_COVERED: 0,
    NOT_APPLICABLE: 0,
  };
  for (const row of rows) summary[row.coverage] += 1;
  return summary;
}

export function uncoveredCriticalRequirements(rows: CoverageMatrixRow[]): CoverageMatrixRow[] {
  return rows.filter((row) => (row.priority === "CRITICAL" || row.priority === "HIGH") && row.coverage === "NOT_COVERED");
}

// ---------------------------------------------------------------------------
// Next action
// ---------------------------------------------------------------------------

export function suggestSystemNextAction(input: {
  readiness: SystemReadinessResult;
  defects: SchemaDefect[];
  architectureStatus: SystemArchitectureStatus;
  summaryPresent: boolean;
  componentCount: number;
  proposedRecordCount: number;
}): { title: string; description: string; sourceKind: string } | null {
  const sourceKind = "system_architecture";
  if (input.architectureStatus === "DRAFT" && (!input.summaryPresent || input.componentCount === 0)) {
    return {
      title: "Define system architecture summary and components",
      description: "Describe the runtime shape and components before proposing database or interface design.",
      sourceKind,
    };
  }
  if (input.proposedRecordCount > 0) {
    return {
      title: "Review proposed system architecture records",
      description: `${input.proposedRecordCount} proposed record${input.proposedRecordCount === 1 ? "" : "s"} awaiting founder approval.`,
      sourceKind,
    };
  }
  const decisionGap = input.readiness.gaps.find((gap) => gap.code === "OPEN_DECISIONS" || gap.code === "OPEN_QUESTION");
  if (decisionGap) {
    return { title: "Resolve system architecture question or decision", description: decisionGap.message, sourceKind };
  }
  const coverageGap = input.readiness.gaps.find((gap) => gap.code.startsWith("COVERAGE_"));
  if (coverageGap) {
    return { title: "Cover accepted product requirements", description: coverageGap.message, sourceKind };
  }
  if (input.defects.length > 0) {
    return { title: "Fix database schema defects", description: input.defects[0].message, sourceKind };
  }
  if (input.readiness.gaps.some((gap) => gap.code === "PRODUCT_NOT_BUILD_READY")) {
    return {
      title: "Bring Product Architecture to BUILD_READY",
      description: "System architecture can only be marked ready for a BUILD_READY product.",
      sourceKind,
    };
  }
  if (input.architectureStatus === "APPROVED" && !input.readiness.architectureReady) {
    return {
      title: "Close remaining System Architecture gaps",
      description: input.readiness.reasons[0] ?? "System architecture is not ready yet.",
      sourceKind,
    };
  }
  if (input.readiness.architectureReady && input.architectureStatus !== "ARCHITECTURE_READY") {
    return {
      title: "Mark System Architecture ARCHITECTURE READY",
      description: "Design gaps are closed. Ready means designed, not implemented or deployed.",
      sourceKind,
    };
  }
  return null;
}
