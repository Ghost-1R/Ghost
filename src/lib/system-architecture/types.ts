import type { ProductArchitectureStatus, ProductPriority, ProductRequirement, RequirementApproval } from "@/lib/product-architect/types";

export const SYSTEM_ARCHITECTURE_STATUSES = [
  "DRAFT",
  "DESIGNING",
  "REVIEW",
  "APPROVED",
  "ARCHITECTURE_READY",
] as const;
export type SystemArchitectureStatus = (typeof SYSTEM_ARCHITECTURE_STATUSES)[number];

export const SYSTEM_COMPONENT_TYPES = [
  "WEB_APPLICATION",
  "API_SERVER",
  "DATABASE",
  "AUTH",
  "STORAGE",
  "BACKGROUND_WORKER",
  "AI_PROVIDER",
  "PAYMENT_PROVIDER",
  "EMAIL",
  "EXTERNAL_INTEGRATION",
  "OTHER",
] as const;
export type SystemComponentType = (typeof SYSTEM_COMPONENT_TYPES)[number];

export const SYSTEM_RECORD_STATUSES = ["PROPOSED", "APPROVED", "REJECTED", "RETIRED"] as const;
export type SystemRecordStatus = (typeof SYSTEM_RECORD_STATUSES)[number];

export const RELATIONSHIP_CARDINALITIES = ["ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_MANY"] as const;
export type RelationshipCardinality = (typeof RELATIONSHIP_CARDINALITIES)[number];

export const COVERAGE_STATUSES = ["COVERED", "PARTIALLY_COVERED", "NOT_COVERED", "NOT_APPLICABLE"] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const SENSITIVE_CLASSES = ["NONE", "PII", "SECRET", "FINANCIAL", "HEALTH", "CREDENTIAL"] as const;
export type SensitiveClass = (typeof SENSITIVE_CLASSES)[number];

export const CONFIG_CLASSIFICATIONS = ["PUBLIC", "SERVER_SECRET", "DATABASE", "PROVIDER", "RUNTIME"] as const;
export type ConfigClassification = (typeof CONFIG_CLASSIFICATIONS)[number];

export const TECH_RISK_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TechRiskSeverity = (typeof TECH_RISK_SEVERITIES)[number];

export const SYSTEM_QUESTION_STATUSES = ["OPEN", "ESCALATED", "RESOLVED", "CLOSED"] as const;
export type SystemQuestionStatus = (typeof SYSTEM_QUESTION_STATUSES)[number];

export type SystemArchitecture = {
  id: string;
  projectId: string;
  productArchitectureId: string;
  summary: string;
  authSummary: string;
  authorizationSummary: string;
  runtimeTopology: string[];
  status: SystemArchitectureStatus;
  note: string;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SystemArchitectureTransition = {
  id: string;
  architectureId: string;
  fromStatus: SystemArchitectureStatus | null;
  toStatus: SystemArchitectureStatus;
  changedAt: string;
  changedBy: string | null;
  actor: string;
  reason: string;
};

export type SystemComponent = {
  id: string;
  architectureId: string;
  projectId: string;
  humanId: string;
  name: string;
  purpose: string;
  componentType: SystemComponentType;
  responsibilities: string[];
  dependencyRefs: string[];
  requirementIds: string[];
  status: SystemRecordStatus;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type SystemEntity = {
  id: string;
  architectureId: string;
  projectId: string;
  humanId: string;
  name: string;
  purpose: string;
  ownershipField: string;
  rlsExpectation: string;
  retentionNote: string;
  sensitiveClass: SensitiveClass;
  status: SystemRecordStatus;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type SystemEntityField = {
  id: string;
  entityId: string;
  architectureId: string;
  projectId: string;
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
  position: number;
  createdAt: string;
};

export type SystemRelationship = {
  id: string;
  architectureId: string;
  projectId: string;
  humanId: string;
  sourceEntityId: string;
  targetEntityId: string;
  cardinality: RelationshipCardinality;
  fkStrategy: string;
  deleteBehavior: string;
  rationale: string;
  junctionStrategy: string;
  status: SystemRecordStatus;
  source: string;
  provenance: string;
  createdAt: string;
};

export type SystemInterface = {
  id: string;
  architectureId: string;
  projectId: string;
  humanId: string;
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
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type SystemDataFlow = {
  id: string;
  architectureId: string;
  projectId: string;
  humanId: string;
  name: string;
  sourceLabel: string;
  processLabel: string;
  storageLabel: string;
  resultLabel: string;
  steps: string[];
  componentRefs: string[];
  status: SystemRecordStatus;
  source: string;
  provenance: string;
  createdAt: string;
};

/** Integrations hold secret NAMES only — never secret values. */
export type SystemIntegration = {
  id: string;
  architectureId: string;
  projectId: string;
  humanId: string;
  provider: string;
  purpose: string;
  required: boolean;
  dataExchanged: string[];
  secretNames: string[];
  failureImpact: string;
  fallbackBehavior: string;
  costNote: string;
  status: SystemRecordStatus;
  source: string;
  provenance: string;
  createdAt: string;
};

/** Env config holds variable NAMES only — never values. */
export type SystemEnvConfig = {
  id: string;
  architectureId: string;
  projectId: string;
  variableName: string;
  purpose: string;
  classification: ConfigClassification;
  requiredEnvironments: string[];
  status: SystemRecordStatus;
  createdAt: string;
};

export type SystemTechnicalRisk = {
  id: string;
  architectureId: string;
  projectId: string;
  humanId: string;
  description: string;
  severity: TechRiskSeverity;
  likelihood: string;
  mitigation: string;
  linkedComponentRefs: string[];
  status: SystemRecordStatus;
  source: string;
  provenance: string;
  createdAt: string;
};

export type SystemTechnicalConstraint = {
  id: string;
  architectureId: string;
  projectId: string;
  statement: string;
  constraintSource: string;
  authoritative: boolean;
  provenance: string;
  createdAt: string;
};

export type SystemRequirementCoverage = {
  id: string;
  architectureId: string;
  projectId: string;
  requirementId: string;
  coverage: CoverageStatus;
  supportingRefs: string[];
  gapNote: string;
  updatedAt: string;
};

export type SystemQuestion = {
  id: string;
  architectureId: string;
  projectId: string;
  question: string;
  status: SystemQuestionStatus;
  decisionId: string | null;
  nextActionId: string | null;
  resolution: string;
  createdAt: string;
  updatedAt: string;
};

export type CoverageMatrixRow = {
  requirementId: string;
  humanId: string;
  title: string;
  priority: ProductPriority;
  approvalStatus: RequirementApproval;
  coverage: CoverageStatus;
  gapNote: string;
  supportingRefs: string[];
  componentRefs: string[];
  interfaceRefs: string[];
};

/** Everything the page, readiness gate, and Ask Ghost context need in one load. */
export type SystemArchitectureBundle = {
  architecture: SystemArchitecture;
  components: SystemComponent[];
  entities: SystemEntity[];
  fields: SystemEntityField[];
  relationships: SystemRelationship[];
  interfaces: SystemInterface[];
  dataFlows: SystemDataFlow[];
  integrations: SystemIntegration[];
  envConfigs: SystemEnvConfig[];
  risks: SystemTechnicalRisk[];
  constraints: SystemTechnicalConstraint[];
  coverage: SystemRequirementCoverage[];
  questions: SystemQuestion[];
  requirements: ProductRequirement[];
  productStatus: ProductArchitectureStatus | null;
  openDecisionCount: number;
};

export { asStringList } from "@/lib/product-architect/types";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
