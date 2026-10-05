export const IDEA_STATUSES = [
  "CAPTURED",
  "EXPLORING",
  "VALIDATING",
  "NEEDS_DECISION",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
  "PROMOTED",
] as const;

export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const IDEA_READINESS = ["EARLY", "NEEDS_EVIDENCE", "DECISION_READY"] as const;
export type IdeaReadiness = (typeof IDEA_READINESS)[number];

export const VALIDATION_STATUSES = ["OPEN", "IN_PROGRESS", "SUPPORTED", "REFUTED", "INCONCLUSIVE"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const IDEA_EVIDENCE_TYPES = [
  "OBSERVATION",
  "CUSTOMER_FEEDBACK",
  "TEST_RESULT",
  "METRIC",
  "DOCUMENT",
  "LINK",
  "TECHNICAL_RESULT",
  "FOUNDER_DECISION",
] as const;
export type IdeaEvidenceType = (typeof IDEA_EVIDENCE_TYPES)[number];

export const IDEA_CLAIM_KINDS = [
  "FACT",
  "FOUNDER_INPUT",
  "ASSUMPTION",
  "HYPOTHESIS",
  "INFERENCE",
  "UNKNOWN",
  "RECOMMENDATION",
] as const;
export type IdeaClaimKind = (typeof IDEA_CLAIM_KINDS)[number];

export type IdeaListItem = {
  id: string;
  title: string;
  status: IdeaStatus;
  readiness: IdeaReadiness;
  summary: string;
  updatedAt: string;
  promotedProjectId: string | null;
};

export type IdeaRecord = {
  id: string;
  ownerId: string;
  title: string;
  rawIdea: string;
  summary: string;
  problem: string;
  targetUser: string;
  proposedSolution: string;
  valueProposition: string;
  assumptions: string[];
  risks: string[];
  opportunities: string[];
  constraints: string[];
  openQuestions: string[];
  recommendation: string | null;
  status: IdeaStatus;
  readiness: IdeaReadiness;
  note: string;
  promotedProjectId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IdeaTransition = {
  id: string;
  ideaId: string;
  fromStatus: IdeaStatus | null;
  toStatus: IdeaStatus;
  changedAt: string;
  changedBy: string | null;
  actor: string;
  reason: string;
};

export type IdeaValidation = {
  id: string;
  ideaId: string;
  question: string;
  reason: string;
  evidenceNeeded: string;
  status: ValidationStatus;
  result: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type IdeaEvidence = {
  id: string;
  ideaId: string;
  evidenceType: IdeaEvidenceType;
  statement: string;
  source: string;
  confidence: string | null;
  provenance: string;
  observedAt: string | null;
  createdAt: string;
};

export type IdeaStrategy = {
  id: string;
  ideaId: string;
  vision: string;
  problem: string;
  targetCustomer: string;
  positioning: string;
  valueProposition: string;
  coreOffer: string;
  differentiation: string;
  valueModel: string;
  distribution: string;
  keyCapabilities: string[];
  constraints: string[];
  risks: string[];
  assumptions: string[];
  successMeasures: string[];
  nonGoals: string[];
  initialScope: string;
  mvp: string;
  notBuilding: string;
  openDecisions: string[];
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}
