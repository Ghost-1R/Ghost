import type { IdeaReadiness, IdeaStatus } from "@/lib/ideas/types";

export const IDEA_TRANSITIONS: Record<IdeaStatus, readonly IdeaStatus[]> = {
  CAPTURED: ["EXPLORING", "ARCHIVED", "REJECTED"],
  EXPLORING: ["CAPTURED", "VALIDATING", "NEEDS_DECISION", "ARCHIVED", "REJECTED"],
  VALIDATING: ["EXPLORING", "NEEDS_DECISION", "ARCHIVED", "REJECTED"],
  NEEDS_DECISION: ["VALIDATING", "EXPLORING", "APPROVED", "REJECTED", "ARCHIVED"],
  APPROVED: ["PROMOTED", "ARCHIVED", "EXPLORING"],
  REJECTED: ["ARCHIVED", "EXPLORING"],
  ARCHIVED: ["EXPLORING", "CAPTURED"],
  PROMOTED: ["ARCHIVED"],
};

export function canTransitionIdea(from: IdeaStatus, to: IdeaStatus): boolean {
  return IDEA_TRANSITIONS[from].includes(to);
}

export type ReadinessInput = {
  problem: string;
  targetUser: string;
  proposedSolution: string;
  evidenceCount: number;
  openValidationCount: number;
  supportedValidationCount: number;
  assumptionCount: number;
  riskCount: number;
};

/** Transparent readiness labels — never a fake success percentage. */
export function computeIdeaReadiness(input: ReadinessInput): {
  readiness: IdeaReadiness;
  reasons: string[];
} {
  const reasons: string[] = [];
  const hasProblem = input.problem.trim().length >= 12;
  const hasUser = input.targetUser.trim().length >= 8;
  const hasSolution = input.proposedSolution.trim().length >= 12;
  const hasEvidence = input.evidenceCount > 0;
  const hasRisks = input.riskCount > 0;
  const openValidations = input.openValidationCount;

  if (!hasProblem || !hasUser || !hasSolution) {
    reasons.push("Problem, who it is for, or proposed solution is still thin.");
    return { readiness: "EARLY", reasons };
  }

  if (!hasEvidence || openValidations > 0 || !hasRisks) {
    if (!hasEvidence) reasons.push("No founder evidence is recorded yet.");
    if (openValidations > 0) reasons.push(`${openValidations} validation question(s) remain open.`);
    if (!hasRisks) reasons.push("Risks have not been listed.");
    return { readiness: "NEEDS_EVIDENCE", reasons };
  }

  reasons.push("Problem, user, solution, risks, and at least one evidence record are present.");
  if (input.supportedValidationCount > 0) {
    reasons.push(`${input.supportedValidationCount} validation item(s) marked supported.`);
  }
  reasons.push("This is readiness to decide — not a prediction of success.");
  return { readiness: "DECISION_READY", reasons };
}

export function workingTitleFromRaw(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled idea";
  const first = cleaned.split(/[.!?]/)[0]?.trim() || cleaned;
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
}
