export const PRODUCT_ARCHITECTURE_STATUSES = [
  "DRAFT",
  "DEFINING",
  "REVIEW",
  "APPROVED",
  "BUILD_READY",
] as const;
export type ProductArchitectureStatus = (typeof PRODUCT_ARCHITECTURE_STATUSES)[number];

export const REQUIREMENT_TYPES = [
  "FUNCTIONAL",
  "NON_FUNCTIONAL",
  "SECURITY",
  "PERFORMANCE",
  "UX",
  "OPERATIONAL",
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const REQUIREMENT_APPROVALS = ["PROPOSED", "ACCEPTED", "REJECTED", "RETIRED"] as const;
export type RequirementApproval = (typeof REQUIREMENT_APPROVALS)[number];

export const FEATURE_STATUSES = ["PROPOSED", "APPROVED", "BUILD_READY", "IN_PROGRESS", "VERIFIED"] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export const PRODUCT_PRIORITIES = ["CRITICAL", "HIGH", "NORMAL", "LOW"] as const;
export type ProductPriority = (typeof PRODUCT_PRIORITIES)[number];

export const PRODUCT_QUESTION_STATUSES = ["OPEN", "ESCALATED", "RESOLVED", "CLOSED"] as const;
export type ProductQuestionStatus = (typeof PRODUCT_QUESTION_STATUSES)[number];

export const DEPENDENCY_KINDS = ["FEATURE", "REQUIREMENT", "DECISION", "EXTERNAL", "ARCHITECTURE_WORK"] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export const DEPENDENCY_STATUSES = ["PROPOSED", "CONFIRMED", "UNRESOLVED"] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export type ProductArchitecture = {
  id: string;
  projectId: string;
  ideaId: string | null;
  strategyId: string | null;
  what: string;
  why: string;
  who: string;
  outcome: string;
  nonGoals: string[];
  assumptions: string[];
  risks: string[];
  constraints: string[];
  status: ProductArchitectureStatus;
  note: string;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductArchitectureTransition = {
  id: string;
  architectureId: string;
  fromStatus: ProductArchitectureStatus | null;
  toStatus: ProductArchitectureStatus;
  changedAt: string;
  changedBy: string | null;
  actor: string;
  reason: string;
};

export type ProductRequirement = {
  id: string;
  architectureId: string;
  projectId: string;
  humanId: string;
  title: string;
  description: string;
  reqType: RequirementType;
  priority: ProductPriority;
  approvalStatus: RequirementApproval;
  acceptanceCriteria: string[];
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductFeature = {
  id: string;
  architectureId: string;
  projectId: string;
  humanId: string;
  name: string;
  purpose: string;
  priority: ProductPriority;
  status: FeatureStatus;
  acceptanceCriteria: string[];
  requirementIds: string[];
  source: string;
  provenance: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductFlow = {
  id: string;
  architectureId: string;
  projectId: string;
  humanId: string;
  name: string;
  actor: string;
  startingCondition: string;
  steps: string[];
  expectedOutcome: string;
  edgeCases: string[];
  featureId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductQuestion = {
  id: string;
  architectureId: string;
  projectId: string;
  question: string;
  status: ProductQuestionStatus;
  decisionId: string | null;
  nextActionId: string | null;
  resolution: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductDependency = {
  id: string;
  architectureId: string;
  projectId: string;
  fromKind: DependencyKind;
  fromRef: string;
  toKind: DependencyKind;
  toRef: string;
  status: DependencyStatus;
  note: string;
  createdAt: string;
};

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}
