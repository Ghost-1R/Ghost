export const PROJECT_STATUSES = [
  "IDEA",
  "PLANNING",
  "READY",
  "BUILDING",
  "BLOCKED",
  "NEEDS_DECISION",
  "READY_FOR_INSPECTION",
  "VERIFIED",
  "DEPLOYED",
  "ON_HOLD",
  "COMPLETED",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const KNOWLEDGE_KINDS = [
  "FACT",
  "REQUIREMENT",
  "DECISION",
  "CONSTRAINT",
  "LESSON",
] as const;

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const FOUNDER_RULE_STATUSES = ["PROPOSED", "ACTIVE", "RETIRED"] as const;

export type FounderRuleStatus = (typeof FOUNDER_RULE_STATUSES)[number];

export const BLOCKER_STATUSES = ["OPEN", "RESOLVED"] as const;

export type BlockerStatus = (typeof BLOCKER_STATUSES)[number];

export const ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const LIFECYCLE_STAGES = [
  "IDEA",
  "STRATEGY",
  "DESIGN",
  "BUILD",
  "TEST",
  "DEPLOY",
  "LEARN",
  "COMPLETED",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const ACTION_PRIORITIES = ["HIGH", "NORMAL", "LOW"] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

export const ACTION_PROVENANCES = ["FACT", "RECOMMENDATION", "FOUNDER_APPROVED_ACTION"] as const;
export type ActionProvenance = (typeof ACTION_PROVENANCES)[number];

export const DECISION_STATUSES = ["OPEN", "RESOLVED", "CANCELLED"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const VERIFICATION_CATEGORIES = [
  "APPLICATION",
  "DATABASE",
  "AUTHENTICATION",
  "PRODUCTION",
  "OTHER",
] as const;

export type VerificationCategory = (typeof VERIFICATION_CATEGORIES)[number];

export const VERIFICATION_STATES = [
  "CLAIMED",
  "OBSERVED",
  "VERIFIED",
  "FAILED",
  "NOT_VERIFIED",
] as const;

export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const MEMORY_SCOPES = ["FOUNDER_RULE", "PROJECT_KNOWLEDGE"] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_PROPOSAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PROJECT_ONLY",
] as const;

export type MemoryProposalStatus = (typeof MEMORY_PROPOSAL_STATUSES)[number];

export const REVIEW_DECISIONS = ["APPROVED", "REJECTED", "PROJECT_ONLY"] as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
