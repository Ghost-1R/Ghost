import type { BuildPlan, BuildPlanStatus, DependencyEdgeKind, WorkPackage, WorkPackageDependency, WorkPackageFeatureLink, WorkPackageRequirementLink } from "@/lib/build-plan/types";
import type { ProductFeature, ProductRequirement } from "@/lib/product-architect/types";

export const BUILD_EXECUTION_STATUSES = [
  "NOT_STARTED",
  "EXECUTING",
  "IMPLEMENTATION_REVIEW",
  "IMPLEMENTED",
] as const;
export type BuildExecutionStatus = (typeof BUILD_EXECUTION_STATUSES)[number];

export const PACKAGE_EXECUTION_STATUSES = [
  "QUEUED",
  "READY",
  "IN_PROGRESS",
  "BLOCKED",
  "IMPLEMENTED",
] as const;
export type PackageExecutionStatus = (typeof PACKAGE_EXECUTION_STATUSES)[number];

export const IMPLEMENTATION_EVIDENCE_KINDS = [
  "COMMIT",
  "CHANGED_FILE",
  "MIGRATION",
  "DATABASE_OBJECT",
  "API_ROUTE",
  "COMPONENT",
  "CONFIGURATION",
  "MANUAL_RECORD",
] as const;
export type ImplementationEvidenceKind = (typeof IMPLEMENTATION_EVIDENCE_KINDS)[number];

export const EXECUTION_BLOCKER_STATUSES = ["OPEN", "RESOLVED"] as const;
export type ExecutionBlockerStatus = (typeof EXECUTION_BLOCKER_STATUSES)[number];

export const UPSTREAM_CHANGE_STATUSES = ["OPEN", "RESOLVED", "SUPERSEDED"] as const;
export type UpstreamChangeStatus = (typeof UPSTREAM_CHANGE_STATUSES)[number];

export const UPSTREAM_ARTIFACT_KINDS = [
  "PRODUCT_ARCHITECTURE",
  "SYSTEM_ARCHITECTURE",
  "BUILD_PLAN",
  "WORK_PACKAGE",
  "OTHER",
] as const;
export type UpstreamArtifactKind = (typeof UPSTREAM_ARTIFACT_KINDS)[number];

export type BuildExecution = {
  id: string;
  projectId: string;
  buildPlanId: string;
  productArchitectureId: string;
  systemArchitectureId: string;
  summary: string;
  status: BuildExecutionStatus;
  note: string;
  implementedAt: string | null;
  implementedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BuildExecutionTransition = {
  id: string;
  executionId: string;
  fromStatus: BuildExecutionStatus | null;
  toStatus: BuildExecutionStatus;
  changedAt: string;
  changedBy: string | null;
  actor: string;
  reason: string;
};

export type WorkPackageExecution = {
  id: string;
  executionId: string;
  projectId: string;
  workPackageId: string;
  status: PackageExecutionStatus;
  implementationNotes: string;
  startedAt: string | null;
  completedAt: string | null;
  startedBy: string | null;
  completedBy: string | null;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type ImplementationEvidence = {
  id: string;
  packageExecutionId: string;
  executionId: string;
  projectId: string;
  kind: ImplementationEvidenceKind;
  reference: string;
  summary: string;
  source: string;
  provenance: string;
  createdAt: string;
  createdBy: string | null;
};

export type ExecutionBlocker = {
  id: string;
  packageExecutionId: string;
  executionId: string;
  projectId: string;
  description: string;
  status: ExecutionBlockerStatus;
  resolution: string;
  createdAt: string;
  createdBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  source: string;
  provenance: string;
};

export type UpstreamChange = {
  id: string;
  executionId: string;
  projectId: string;
  packageExecutionId: string | null;
  artifactKind: UpstreamArtifactKind;
  artifactRef: string;
  issue: string;
  status: UpstreamChangeStatus;
  decisionId: string | null;
  resolution: string;
  createdAt: string;
  resolvedAt: string | null;
  source: string;
  provenance: string;
};

/** Everything the page, completion gate, and Ask Ghost context need in one load. */
export type BuildExecutionBundle = {
  execution: BuildExecution;
  planStatus: BuildPlanStatus | null;
  plan: BuildPlan | null;
  packages: WorkPackage[];
  packageExecutions: WorkPackageExecution[];
  dependencies: WorkPackageDependency[];
  requirementLinks: WorkPackageRequirementLink[];
  featureLinks: WorkPackageFeatureLink[];
  evidence: ImplementationEvidence[];
  blockers: ExecutionBlocker[];
  upstreamChanges: UpstreamChange[];
  requirements: ProductRequirement[];
  features: ProductFeature[];
  openDecisionCount: number;
  openDecisions: Array<{ id: string; title: string; question: string }>;
};

export type { DependencyEdgeKind, WorkPackage, WorkPackageDependency };

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
