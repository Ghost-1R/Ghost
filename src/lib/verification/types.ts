import type { BuildExecutionStatus, WorkPackageExecution } from "@/lib/build-execution/types";
import type { BuildPlan, WorkPackage, WorkPackageFeatureLink, WorkPackageRequirementLink } from "@/lib/build-plan/types";
import type { ProductFeature, ProductRequirement } from "@/lib/product-architect/types";

export const VERIFICATION_PROGRAM_STATUSES = [
  "NOT_STARTED",
  "TESTING",
  "VERIFICATION_REVIEW",
  "VERIFIED",
] as const;
export type VerificationProgramStatus = (typeof VERIFICATION_PROGRAM_STATUSES)[number];

export const VERIFICATION_CASE_STATUSES = [
  "PLANNED",
  "READY",
  "RUNNING",
  "PASSED",
  "FAILED",
  "BLOCKED",
  "NOT_APPLICABLE",
] as const;
export type VerificationCaseStatus = (typeof VERIFICATION_CASE_STATUSES)[number];

export const VERIFICATION_CASE_KINDS = [
  "AUTOMATED",
  "MANUAL_FUNCTIONAL",
  "INTEGRATION",
  "REGRESSION",
  "SECURITY",
  "RESPONSIVE",
  "DATABASE_RLS",
  "ACCEPTANCE",
] as const;
export type VerificationCaseKind = (typeof VERIFICATION_CASE_KINDS)[number];

export const VERIFICATION_EVIDENCE_KINDS = [
  "AUTOMATED_RESULT",
  "COMMAND_RESULT",
  "INSPECTOR_EVIDENCE",
  "SCREENSHOT_REF",
  "MANUAL_OBSERVATION",
  "API_RESPONSE_SUMMARY",
  "RLS_PROBE",
  "BROWSER_QA",
  "SECURITY_SCAN",
] as const;
export type VerificationEvidenceKind = (typeof VERIFICATION_EVIDENCE_KINDS)[number];

export const VERIFICATION_DEFECT_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "RETEST_REQUIRED",
  "CLOSED",
] as const;
export type VerificationDefectStatus = (typeof VERIFICATION_DEFECT_STATUSES)[number];

export const VERIFICATION_DEFECT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type VerificationDefectSeverity = (typeof VERIFICATION_DEFECT_SEVERITIES)[number];

export type VerificationProgram = {
  id: string;
  projectId: string;
  buildExecutionId: string;
  buildPlanId: string;
  productArchitectureId: string;
  systemArchitectureId: string;
  summary: string;
  status: VerificationProgramStatus;
  note: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VerificationProgramTransition = {
  id: string;
  programId: string;
  fromStatus: VerificationProgramStatus | null;
  toStatus: VerificationProgramStatus;
  changedAt: string;
  changedBy: string | null;
  actor: string;
  reason: string;
};

export type VerificationCase = {
  id: string;
  programId: string;
  projectId: string;
  humanId: string;
  title: string;
  purpose: string;
  caseKind: VerificationCaseKind;
  isAutomated: boolean;
  isRequired: boolean;
  isRegression: boolean;
  status: VerificationCaseStatus;
  preconditions: string;
  expectedResult: string;
  actualResult: string;
  workPackageId: string | null;
  packageExecutionId: string | null;
  planVerificationId: string | null;
  requirementId: string | null;
  featureId: string | null;
  source: string;
  provenance: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VerificationEvidence = {
  id: string;
  caseId: string;
  programId: string;
  projectId: string;
  kind: VerificationEvidenceKind;
  reference: string;
  summary: string;
  isAutomated: boolean;
  source: string;
  provenance: string;
  createdAt: string;
  createdBy: string | null;
};

export type VerificationDefect = {
  id: string;
  programId: string;
  projectId: string;
  caseId: string;
  humanId: string;
  title: string;
  description: string;
  severity: VerificationDefectSeverity;
  blocking: boolean;
  status: VerificationDefectStatus;
  resolution: string;
  packageExecutionId: string | null;
  requirementId: string | null;
  featureId: string | null;
  retestCaseId: string | null;
  discoveredAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type RetestEvent = {
  id: string;
  defectId: string;
  programId: string;
  projectId: string;
  caseId: string;
  resultStatus: VerificationCaseStatus;
  evidenceId: string | null;
  note: string;
  createdAt: string;
  createdBy: string | null;
};

/** Everything the page, completion gate, and Ask Ghost context need in one load. */
export type VerificationBundle = {
  program: VerificationProgram;
  executionStatus: BuildExecutionStatus | null;
  plan: BuildPlan | null;
  packages: WorkPackage[];
  packageExecutions: WorkPackageExecution[];
  requirementLinks: WorkPackageRequirementLink[];
  featureLinks: WorkPackageFeatureLink[];
  cases: VerificationCase[];
  evidence: VerificationEvidence[];
  defects: VerificationDefect[];
  retestEvents: RetestEvent[];
  requirements: ProductRequirement[];
  features: ProductFeature[];
  openDecisionCount: number;
  openDecisions: Array<{ id: string; title: string; question: string }>;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
