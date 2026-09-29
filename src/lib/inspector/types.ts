export const INSPECTION_STATUSES = [
  "CLAIMED",
  "OBSERVED",
  "VERIFIED",
  "FAILED",
  "BLOCKED",
  "NOT_VERIFIED",
] as const;

export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const INSPECTION_TYPES = [
  "LINT",
  "TYPESCRIPT",
  "TEST",
  "BUILD",
  "GIT_STATUS",
  "REPOSITORY_FILE",
  "DATABASE_REMOTE",
  "AUTH_ROUTE",
  "HTTP_ROUTE",
  "MODEL_GROUNDING",
  "DEPLOYMENT",
  "CUSTOM",
] as const;

export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const RISK_LEVELS = ["SAFE", "CAUTION", "HIGH", "CRITICAL"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export const APPROVAL_STATES = [
  "NOT_REQUIRED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "EXECUTED",
] as const;

export type ApprovalState = (typeof APPROVAL_STATES)[number];

export type CheckDefinition = {
  id: string;
  name: string;
  type: InspectionType;
  scope: "local" | "remote";
  risk: RiskLevel;
  command: string[] | null;
  expectedExit: number | null;
  timeoutMs: number;
};

export type InspectionResult = {
  id: string;
  ownerId: string;
  projectId: string | null;
  checkId: string;
  checkType: InspectionType;
  name: string;
  status: InspectionStatus;
  risk: RiskLevel;
  startedAt: string;
  completedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  commit: string | null;
  workingTree: "clean" | "dirty" | null;
  treeStamp: string | null;
  scope: "local" | "remote";
  summary: string;
};

export type ActionRequest = {
  actionType: string;
  target: string;
  parameters: Record<string, string>;
  projectId: string;
  reason: string;
  expectedEffect: string;
  verificationPlan: string;
  rollbackPlan: string;
};

export type ActionApproval = {
  id: string;
  ownerId: string;
  projectId: string;
  actionType: string;
  target: string;
  parameters: Record<string, string>;
  fingerprint: string;
  risk: RiskLevel;
  reason: string;
  expectedEffect: string;
  verificationPlan: string;
  rollbackPlan: string;
  status: ApprovalState;
  createdAt: string;
  decidedAt: string | null;
};
