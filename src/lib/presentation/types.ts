export const EVIDENCE_CHECK_TYPES = [
  "lint",
  "typecheck",
  "test",
  "build",
  "git_state",
  "migration_applied",
  "prod_health",
  "security",
  "customer_flows",
  "responsive",
  "regression",
  "requirements",
] as const;

export type EvidenceCheckType = (typeof EVIDENCE_CHECK_TYPES)[number];

export const EVIDENCE_STATUSES = ["passed", "failed", "blocked", "skipped"] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const PRESENTATION_RESULTS = ["READY", "READY_WITH_GAPS", "NOT_READY"] as const;

export type PresentationResult = (typeof PRESENTATION_RESULTS)[number];

export const FINDING_SEVERITIES = ["BLOCKER", "HIGH", "MEDIUM", "LOW"] as const;

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const REQUIREMENT_STATUSES = ["PASS", "FAIL", "NOT_VERIFIED", "NOT_APPLICABLE", "OBSERVED", "BLOCKED", "FUTURE_SCOPE"] as const;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export type EvidenceWriter = "runner" | "client" | "llm";

export type EvidenceRecord = {
  id: string;
  ownerId: string;
  projectId: string;
  runId: string;
  checkType: EvidenceCheckType;
  commitSha: string;
  treeHash: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  outputHash: string;
  logExcerpt: string;
  runner: "inspector";
  environment: "local" | "production";
  status: EvidenceStatus;
  createdAt: string;
};

export type TraceRow = {
  requirement: string;
  implementationEvidence: string | null;
  verificationEvidence: string | null;
  status: RequirementStatus;
};

export type ReviewFinding = {
  severity: FindingSeverity;
  category: string;
  description: string;
  evidence: string;
  recommendedFix: string;
  verificationNeeded: string;
};

export type ApprovalRecord = {
  id: string;
  ownerId: string;
  projectId: string;
  operation: string;
  target: string;
  commitSha: string;
  riskLevel: "SAFE" | "CAUTION" | "HIGH" | "CRITICAL";
  evidenceIdsShown: string[];
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  fingerprint: string;
};

export type OverrideRecord = {
  id: string;
  ownerId: string;
  projectId: string;
  reason: string;
  founderId: string;
  createdAt: string;
  target: string;
  commitSha: string;
  affectedChecks: string[];
};

export type PresentationReview = {
  id: string;
  ownerId: string;
  projectId: string;
  commitSha: string;
  treeHash: string;
  environment: "local" | "production";
  createdAt: string;
  evidenceIds: string[];
  findings: ReviewFinding[];
  traceability: TraceRow[];
  result: PresentationResult;
  gaps: string[];
  fixQueue: ReviewFinding[];
  overrides: OverrideRecord[];
};
