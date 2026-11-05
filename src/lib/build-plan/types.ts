import type { ProductArchitectureStatus, ProductFeature, ProductRequirement } from "@/lib/product-architect/types";
import type {
  ConfigClassification,
  SystemArchitectureStatus,
  SystemComponent,
  SystemEntity,
  SystemInterface,
  SystemRecordStatus,
} from "@/lib/system-architecture/types";

export const BUILD_PLAN_STATUSES = ["DRAFT", "PLANNING", "REVIEW", "APPROVED", "BUILD_PLAN_READY"] as const;
export type BuildPlanStatus = (typeof BUILD_PLAN_STATUSES)[number];

export const WORK_PACKAGE_STATUSES = [
  "PLANNED",
  "READY",
  "BLOCKED",
  "IN_PROGRESS",
  "IMPLEMENTED",
  "VERIFIED",
  "DEPLOYED",
] as const;
export type WorkPackageStatus = (typeof WORK_PACKAGE_STATUSES)[number];

/** V8 Build Plan may only set these package statuses. Later stages need implementation evidence. */
export const V8_WORK_PACKAGE_STATUSES = ["PLANNED", "READY", "BLOCKED"] as const;
export type V8WorkPackageStatus = (typeof V8_WORK_PACKAGE_STATUSES)[number];

export const WORK_PACKAGE_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type WorkPackagePriority = (typeof WORK_PACKAGE_PRIORITIES)[number];

export const DEPENDENCY_EDGE_KINDS = ["DEPENDS_ON", "BLOCKS", "CAN_RUN_WITH"] as const;
export type DependencyEdgeKind = (typeof DEPENDENCY_EDGE_KINDS)[number];

export const PATH_CERTAINTIES = ["CONFIRMED_PATH", "EXPECTED_AREA", "UNKNOWN"] as const;
export type PathCertainty = (typeof PATH_CERTAINTIES)[number];

export const ARCHITECTURE_LINK_KINDS = [
  "COMPONENT",
  "ENTITY",
  "INTERFACE",
  "DATA_FLOW",
  "INTEGRATION",
  "OTHER",
] as const;
export type ArchitectureLinkKind = (typeof ARCHITECTURE_LINK_KINDS)[number];

export const VERIFICATION_KINDS = [
  "UNIT",
  "INTEGRATION",
  "SECURITY",
  "RLS",
  "PROVIDER",
  "E2E",
  "RESPONSIVE",
  "BUILD",
  "PRODUCTION",
  "MANUAL",
] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export const MANUAL_ACTION_STATUSES = ["REQUIRED", "NOT_REQUIRED", "PENDING", "DONE"] as const;
export type ManualActionStatus = (typeof MANUAL_ACTION_STATUSES)[number];

/** V8 may not mark manual actions DONE — that needs founder evidence in a later stage. */
export const V8_MANUAL_ACTION_STATUSES = ["REQUIRED", "NOT_REQUIRED", "PENDING"] as const;
export type V8ManualActionStatus = (typeof V8_MANUAL_ACTION_STATUSES)[number];

export const BUILD_RISK_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type BuildRiskSeverity = (typeof BUILD_RISK_SEVERITIES)[number];

export type BuildPlan = {
  id: string;
  projectId: string;
  productArchitectureId: string;
  systemArchitectureId: string;
  summary: string;
  deploymentSequence: string[];
  rollbackSummary: string;
  status: BuildPlanStatus;
  note: string;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BuildPlanTransition = {
  id: string;
  planId: string;
  fromStatus: BuildPlanStatus | null;
  toStatus: BuildPlanStatus;
  changedAt: string;
  changedBy: string | null;
  actor: string;
  reason: string;
};

export type BuildPhase = {
  id: string;
  planId: string;
  projectId: string;
  humanId: string;
  name: string;
  objective: string;
  position: number;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkPackage = {
  id: string;
  planId: string;
  projectId: string;
  phaseId: string | null;
  humanId: string;
  title: string;
  objective: string;
  description: string;
  status: WorkPackageStatus;
  priority: WorkPackagePriority;
  likelyCodeAreas: string[];
  pathCertainty: PathCertainty;
  databaseImpact: string;
  integrationImpact: string;
  securityImpact: string;
  definitionOfDone: string[];
  acceptanceCriteria: string[];
  rollbackConsideration: string;
  irreversible: boolean;
  riskNote: string;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkPackageDependency = {
  id: string;
  planId: string;
  projectId: string;
  fromPackageId: string;
  toPackageId: string;
  edgeKind: DependencyEdgeKind;
  note: string;
  createdAt: string;
};

export type WorkPackageRequirementLink = {
  workPackageId: string;
  requirementId: string;
  createdAt: string;
};

export type WorkPackageFeatureLink = {
  workPackageId: string;
  featureId: string;
  createdAt: string;
};

export type WorkPackageArchitectureLink = {
  id: string;
  workPackageId: string;
  planId: string;
  projectId: string;
  linkKind: ArchitectureLinkKind;
  recordRef: string;
  note: string;
  createdAt: string;
};

export type WorkPackageVerification = {
  id: string;
  workPackageId: string;
  planId: string;
  projectId: string;
  kind: VerificationKind;
  description: string;
  observableSignal: string;
  position: number;
  createdAt: string;
};

export type BuildManualAction = {
  id: string;
  planId: string;
  projectId: string;
  workPackageId: string | null;
  humanId: string;
  title: string;
  description: string;
  status: ManualActionStatus;
  evidenceNote: string;
  createdAt: string;
  updatedAt: string;
};

export type BuildConfigRequirement = {
  id: string;
  planId: string;
  projectId: string;
  workPackageId: string | null;
  variableName: string;
  purpose: string;
  environment: string;
  classification: ConfigClassification;
  founderActionRequired: boolean;
  createdAt: string;
};

export type BuildPlanRisk = {
  id: string;
  planId: string;
  projectId: string;
  workPackageId: string | null;
  humanId: string;
  description: string;
  severity: BuildRiskSeverity;
  mitigation: string;
  createdAt: string;
};

export type ArchitectureRecordRef = {
  humanId: string;
  name: string;
  kind: ArchitectureLinkKind;
  status: SystemRecordStatus;
};

/** Everything the page, readiness gate, and Ask Ghost context need in one load. */
export type BuildPlanBundle = {
  plan: BuildPlan;
  phases: BuildPhase[];
  packages: WorkPackage[];
  dependencies: WorkPackageDependency[];
  requirementLinks: WorkPackageRequirementLink[];
  featureLinks: WorkPackageFeatureLink[];
  architectureLinks: WorkPackageArchitectureLink[];
  verifications: WorkPackageVerification[];
  manualActions: BuildManualAction[];
  configRequirements: BuildConfigRequirement[];
  risks: BuildPlanRisk[];
  requirements: ProductRequirement[];
  features: ProductFeature[];
  architectureRecords: ArchitectureRecordRef[];
  productStatus: ProductArchitectureStatus | null;
  systemStatus: SystemArchitectureStatus | null;
  openDecisionCount: number;
};

export { asStringList } from "@/lib/product-architect/types";
export type { ConfigClassification, SystemComponent, SystemEntity, SystemInterface };

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
