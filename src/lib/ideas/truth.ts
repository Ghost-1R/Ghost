import type { IdeaEvidence, IdeaRecord, IdeaStrategy, IdeaValidation } from "@/lib/ideas/types";

export type TruthAnswer = {
  answer: "YES" | "NO" | "UNKNOWN";
  reason: string;
};

/** Pure truth-boundary answers — never treat AI analysis as validation. */
export function isIdeaValidated(input: {
  idea: Pick<IdeaRecord, "status">;
  validations: Array<Pick<IdeaValidation, "status">>;
  evidence: Array<Pick<IdeaEvidence, "evidenceType">>;
}): TruthAnswer {
  const supported = input.validations.some((item) => item.status === "SUPPORTED");
  const customerEvidence = input.evidence.some((item) => item.evidenceType === "CUSTOMER_FEEDBACK");
  if (supported && customerEvidence) {
    return { answer: "YES", reason: "At least one validation is SUPPORTED with customer feedback evidence." };
  }
  if (input.validations.length === 0 && input.evidence.length === 0) {
    return {
      answer: "NO",
      reason: "Only analysis or structure exists. No validation records or evidence. AI analysis is not validation.",
    };
  }
  return { answer: "NO", reason: "Validation is incomplete. AI analysis is not validation." };
}

export function didCustomersConfirmProblem(evidence: Array<Pick<IdeaEvidence, "evidenceType">>): TruthAnswer {
  if (evidence.some((item) => item.evidenceType === "CUSTOMER_FEEDBACK")) {
    return { answer: "YES", reason: "Customer feedback evidence is recorded." };
  }
  return { answer: "UNKNOWN", reason: "No customer feedback evidence is recorded." };
}

export function isStrategyApproved(strategy: Pick<IdeaStrategy, "approvedAt"> | null): TruthAnswer {
  if (strategy?.approvedAt) {
    return { answer: "YES", reason: `Strategy approved at ${strategy.approvedAt}.` };
  }
  return { answer: "NO", reason: "No founder strategy approval timestamp exists." };
}

export function isProductBuilt(input: {
  idea: Pick<IdeaRecord, "status" | "promotedProjectId">;
  lifecycleStage?: string | null;
}): TruthAnswer {
  if (input.idea.status === "PROMOTED" || input.idea.promotedProjectId) {
    return {
      answer: "NO",
      reason: "Project creation/promotion is not implementation. No build evidence is implied.",
    };
  }
  if (input.lifecycleStage === "BUILD" || input.lifecycleStage === "VERIFY" || input.lifecycleStage === "SHIP") {
    return {
      answer: "UNKNOWN",
      reason: "Lifecycle may include build work, but Idea Lab alone does not prove the product is built.",
    };
  }
  return { answer: "NO", reason: "No implementation evidence is present." };
}

export function isDeployed(verificationState: string | null | undefined): TruthAnswer {
  if (verificationState === "VERIFIED" || verificationState === "DEPLOYED") {
    return { answer: "YES", reason: "Deployment verification evidence exists." };
  }
  return { answer: "NO", reason: "Only deployment evidence can establish deployment. Promotion is not deployment." };
}

export function answerIdeaTruthQuestion(
  question: string,
  input: {
    idea: IdeaRecord;
    strategy: IdeaStrategy | null;
    validations: IdeaValidation[];
    evidence: IdeaEvidence[];
    lifecycleStage?: string | null;
    productionVerification?: string | null;
  },
): TruthAnswer | null {
  const q = question.toLowerCase();
  if (/is this idea validated|validated\?/.test(q)) {
    return isIdeaValidated(input);
  }
  if (/customers? confirm|customer (feedback|evidence)|did customers/.test(q)) {
    return didCustomersConfirmProblem(input.evidence);
  }
  if (/strategy approved|is this strategy approved/.test(q)) {
    return isStrategyApproved(input.strategy);
  }
  if (/product built|is (this|the) (product|app) built|implemented\?/.test(q)) {
    return isProductBuilt({ idea: input.idea, lifecycleStage: input.lifecycleStage });
  }
  if (/is (this|it) deployed|deployed\?/.test(q)) {
    return isDeployed(input.productionVerification);
  }
  return null;
}
