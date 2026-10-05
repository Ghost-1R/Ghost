export const DECISION_STATUSES = ["OPEN", "RESOLVED", "CANCELLED"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export type DecisionOption = { id: string; label: string };

export type DecisionDraft = {
  projectId?: string | null;
  ideaId?: string | null;
  strategyId?: string | null;
  title: string;
  question: string;
  context?: string;
  options?: DecisionOption[];
  recommendation?: string | null;
  evidence?: Array<{ type: string; id: string; title: string }>;
};

export type DecisionResolution = {
  status: "RESOLVED" | "CANCELLED";
  selectedOption?: string | null;
  founderResponse?: string | null;
  rationale?: string | null;
  followUpAction?: { title: string; description?: string } | null;
};

export function validateDecisionDraft(draft: DecisionDraft): string | null {
  if (!(draft.projectId?.trim() || draft.ideaId?.trim())) {
    return "A project or idea is required.";
  }
  if (!draft.title.trim()) return "A decision title is required.";
  if (!draft.question.trim()) return "A decision question is required.";
  if ((draft.options ?? []).some((option) => !option.label.trim())) return "Decision options must have labels.";
  return null;
}

export function validateDecisionResolution(input: DecisionResolution): string | null {
  if (input.status === "RESOLVED" && !(input.selectedOption?.trim() || input.founderResponse?.trim())) {
    return "A resolved decision needs the founder's selected option or response.";
  }
  if (input.status === "CANCELLED" && input.followUpAction) {
    return "A cancelled decision cannot create a follow-up action.";
  }
  return null;
}

/** Ghost may recommend. Ghost never becomes the resolver. */
export function founderRemainsDecisionMaker(resolvedByRole: "founder" | "ghost" | "system"): boolean {
  return resolvedByRole === "founder";
}

export function decisionCreatesFollowUp(input: DecisionResolution): boolean {
  return input.status === "RESOLVED" && Boolean(input.followUpAction?.title.trim());
}
