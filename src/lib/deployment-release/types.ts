import type { VerificationProgramStatus } from "@/lib/verification/types";

export const RELEASE_STATUSES = [
  "DRAFT",
  "DEPLOYMENT_READY",
  "DEPLOYING",
  "DEPLOYED",
  "PRODUCTION_VERIFICATION",
  "PRODUCTION_VERIFIED",
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const DEPLOYMENT_ATTEMPT_STATUSES = [
  "QUEUED",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
  "ROLLED_BACK",
  "CANCELLED",
] as const;
export type DeploymentAttemptStatus = (typeof DEPLOYMENT_ATTEMPT_STATUSES)[number];

export const DEPLOYMENT_ENVIRONMENT_TYPES = ["LOCAL", "PREVIEW", "STAGING", "PRODUCTION"] as const;
export type DeploymentEnvironmentType = (typeof DEPLOYMENT_ENVIRONMENT_TYPES)[number];

export const CONFIG_PRESENCE_STATUSES = ["PRESENT", "MISSING", "UNKNOWN"] as const;
export type ConfigPresenceStatus = (typeof CONFIG_PRESENCE_STATUSES)[number];

export const RELEASE_MIGRATION_STATUSES = ["PENDING", "APPLIED", "FAILED", "NOT_REQUIRED"] as const;
export type ReleaseMigrationStatus = (typeof RELEASE_MIGRATION_STATUSES)[number];

export const DEPLOYMENT_HEALTH_STATUSES = ["PENDING", "PASSED", "FAILED", "SKIPPED"] as const;
export type DeploymentHealthStatus = (typeof DEPLOYMENT_HEALTH_STATUSES)[number];

export const ROLLBACK_STATUSES = ["AVAILABLE", "REQUESTED", "IN_PROGRESS", "COMPLETED", "FAILED"] as const;
export type RollbackStatus = (typeof ROLLBACK_STATUSES)[number];

export const MANUAL_ACTION_STATUSES = ["PENDING", "COMPLETED", "BLOCKED", "SKIPPED"] as const;
export type DeploymentManualActionStatus = (typeof MANUAL_ACTION_STATUSES)[number];

export const DEPLOYMENT_EVIDENCE_KINDS = [
  "PROVIDER_STATUS",
  "HEALTH_RESPONSE",
  "LIVE_SHA",
  "INSPECTOR_RUN",
  "PRESENTATION_GATE",
  "MANUAL_OBSERVATION",
  "COMMAND_RESULT",
  "MIGRATION_CONFIRMATION",
] as const;
export type DeploymentEvidenceKind = (typeof DEPLOYMENT_EVIDENCE_KINDS)[number];

export type DeploymentEnvironment = {
  id: string;
  projectId: string;
  name: string;
  environmentType: DeploymentEnvironmentType;
  provider: string;
  applicationUrl: string;
  healthEndpoint: string;
  serviceIdentity: string;
  isActive: boolean;
  note: string;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type Release = {
  id: string;
  projectId: string;
  verificationProgramId: string;
  buildExecutionId: string;
  buildPlanId: string;
  productArchitectureId: string;
  systemArchitectureId: string;
  environmentId: string | null;
  humanId: string;
  summary: string;
  status: ReleaseStatus;
  sourceBranch: string;
  sourceCommitSha: string;
  releaseVersion: string;
  deploymentSequence: string[];
  rollbackStrategy: string;
  rollbackTargetReleaseId: string | null;
  rollbackTargetCommitSha: string;
  note: string;
  deployedAt: string | null;
  productionVerifiedAt: string | null;
  productionVerifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type ReleaseTransition = {
  id: string;
  releaseId: string;
  fromStatus: ReleaseStatus | null;
  toStatus: ReleaseStatus;
  changedAt: string;
  changedBy: string | null;
  actor: string;
  reason: string;
};

export type ReleaseConfigRequirement = {
  id: string;
  releaseId: string;
  projectId: string;
  environmentId: string | null;
  variableName: string;
  isRequired: boolean;
  isSecret: boolean;
  presence: ConfigPresenceStatus;
  verifiedAt: string | null;
  note: string;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type ReleaseMigration = {
  id: string;
  releaseId: string;
  projectId: string;
  environmentId: string | null;
  migrationPath: string;
  isRequired: boolean;
  status: ReleaseMigrationStatus;
  appliedAt: string | null;
  evidenceRef: string;
  note: string;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type Deployment = {
  id: string;
  releaseId: string;
  projectId: string;
  environmentId: string;
  humanId: string;
  status: DeploymentAttemptStatus;
  provider: string;
  providerDeploymentId: string;
  expectedCommitSha: string;
  liveCommitSha: string;
  deploymentUrl: string;
  failureReason: string;
  startedAt: string | null;
  completedAt: string | null;
  inspectorResult: string;
  presentationResult: string;
  note: string;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type DeploymentEvidence = {
  id: string;
  deploymentId: string;
  releaseId: string;
  projectId: string;
  kind: DeploymentEvidenceKind;
  reference: string;
  summary: string;
  source: string;
  provenance: string;
  createdAt: string;
  createdBy: string | null;
};

export type DeploymentHealthCheck = {
  id: string;
  deploymentId: string;
  releaseId: string;
  projectId: string;
  checkName: string;
  status: DeploymentHealthStatus;
  expectedValue: string;
  observedValue: string;
  evidenceRef: string;
  checkedAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type DeploymentManualAction = {
  id: string;
  releaseId: string;
  projectId: string;
  deploymentId: string | null;
  title: string;
  instruction: string;
  isRequired: boolean;
  status: DeploymentManualActionStatus;
  evidenceRef: string;
  completedAt: string | null;
  note: string;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type ReleaseRollback = {
  id: string;
  releaseId: string;
  projectId: string;
  targetReleaseId: string | null;
  targetCommitSha: string;
  status: RollbackStatus;
  reason: string;
  evidenceRef: string;
  requestedAt: string | null;
  completedAt: string | null;
  note: string;
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

/** Everything the page, readiness gates, and Ask Ghost context need in one load. */
export type ReleaseBundle = {
  release: Release;
  verificationStatus: VerificationProgramStatus | null;
  environments: DeploymentEnvironment[];
  configRequirements: ReleaseConfigRequirement[];
  migrations: ReleaseMigration[];
  deployments: Deployment[];
  evidence: DeploymentEvidence[];
  healthChecks: DeploymentHealthCheck[];
  manualActions: DeploymentManualAction[];
  rollbacks: ReleaseRollback[];
  openDecisionCount: number;
  openDecisions: Array<{ id: string; title: string; question: string }>;
  history?: ReleaseTransition[];
};
