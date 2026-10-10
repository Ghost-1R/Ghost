import type { AgentAuthorizationKind } from "@/lib/agent-runtime/types";

/** Founder-visible remote development task statuses (Build 09.10). */
export const REMOTE_DEV_TASK_STATUSES = [
  "AWAITING_APPROVAL",
  "QUEUED",
  "RUNNING",
  "BLOCKED",
  "FAILED",
  "AWAITING_FOUNDER_REVIEW",
  "VERIFIED",
  "CANCELLED",
] as const;

export type RemoteDevTaskStatus = (typeof REMOTE_DEV_TASK_STATUSES)[number];

export const REMOTE_PROVIDER_KINDS = ["FAKE", "CURSOR_CLOUD", "GITHUB_ACTIONS"] as const;
export type RemoteProviderKind = (typeof REMOTE_PROVIDER_KINDS)[number];

export const EVIDENCE_VERIFICATION_STATES = [
  "UNVERIFIED",
  "VERIFIED",
  "FAILED",
  "REJECTED",
] as const;
export type EvidenceVerificationState = (typeof EVIDENCE_VERIFICATION_STATES)[number];

export type SpendingLimit = {
  /** Soft budget label — never a live payment instrument. */
  maxEstimatedCostUsd: number | null;
  currency: "USD";
};

export type DurationLimit = {
  maxDurationMs: number;
};

export type GitTarget = {
  repository: string;
  approvedBaseBranch: string;
  baseCommitSha: string | null;
  taskBranch: string | null;
};

export type RemoteDevTaskBinding = {
  authorizationId: string;
  authorizationKind: AgentAuthorizationKind;
  actionType: string;
  actionScope: string;
  environmentLabel: string;
  scopeFingerprint: string;
};

export type RemoteDevCheckpoint = {
  id: string;
  sequence: number;
  label: string;
  progressRef: string;
  at: string;
};

export type RemoteDevError = {
  code: string;
  message: string;
  retryable: boolean;
  at: string;
};

export type GitHubEvidence = {
  repository: string;
  baseCommitSha: string | null;
  taskBranch: string | null;
  commitSha: string | null;
  pullRequestRef: string | null;
  testResultsRef: string | null;
  artifactHashes: string[];
  verificationState: EvidenceVerificationState;
  /** Provider claims remain UNVERIFIED until independently checked. */
  providerClaimedAt: string | null;
  independentlyCheckedAt: string | null;
};

export type RemoteDevTask = {
  id: string;
  ownerId: string;
  projectId: string;
  projectName: string;
  objective: string;
  status: RemoteDevTaskStatus;
  binding: RemoteDevTaskBinding;
  spending: SpendingLimit;
  duration: DurationLimit;
  git: GitTarget;
  providerKind: RemoteProviderKind;
  externalJobId: string | null;
  /**
   * 1:1 link to agent_tasks execution row (Build 09.13).
   * Null until durable authorized queue binds an execution task.
   */
  agentTaskId: string | null;
  requiresIndependentReview: boolean;
  /** Deployment never inferred from development authorization. */
  deploymentAuthorized: false;
  checkpoints: RemoteDevCheckpoint[];
  lastError: RemoteDevError | null;
  evidence: GitHubEvidence | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type CreateRemoteDevTaskInput = {
  ownerId: string;
  projectId: string;
  projectName?: string;
  objective: string;
  authorizationId: string;
  authorizationKind: AgentAuthorizationKind;
  actionType: string;
  actionScope: string;
  environmentLabel?: string;
  scopeFingerprint: string;
  repository: string;
  approvedBaseBranch: string;
  baseCommitSha?: string | null;
  maxEstimatedCostUsd?: number | null;
  maxDurationMs?: number;
  idempotencyKey: string;
  requiresIndependentReview?: boolean;
  at?: string;
};

export type RemoteProviderStatusEvent = {
  externalJobId: string;
  providerKind: RemoteProviderKind;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMEOUT";
  detail: string;
  occurredAt: string;
  eventId: string;
  signature: string;
};
