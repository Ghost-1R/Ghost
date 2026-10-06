import type {
  FeatureStatus,
  ProductArchitectureStatus,
  ProductFeature,
  ProductQuestion,
  ProductRequirement,
  RequirementApproval,
} from "./types";

export const LEGAL_PRODUCT_ARCHITECTURE_TRANSITIONS: Record<
  ProductArchitectureStatus,
  readonly ProductArchitectureStatus[]
> = {
  DRAFT: ["DEFINING", "REVIEW"],
  DEFINING: ["DRAFT", "REVIEW"],
  REVIEW: ["DEFINING", "APPROVED", "DRAFT"],
  APPROVED: ["REVIEW", "BUILD_READY", "DEFINING"],
  BUILD_READY: ["APPROVED", "REVIEW"],
};

export function canTransitionProductArchitecture(
  from: ProductArchitectureStatus,
  to: ProductArchitectureStatus,
): boolean {
  return LEGAL_PRODUCT_ARCHITECTURE_TRANSITIONS[from].includes(to);
}

export type ProductReadinessGap = {
  code: string;
  message: string;
};

export type ProductReadinessResult = {
  buildReady: boolean;
  gaps: ProductReadinessGap[];
  reasons: string[];
};

/** Deterministic readiness — never AI-decided. */
export function computeProductReadiness(input: {
  architecture: {
    what: string;
    why: string;
    who: string;
    outcome: string;
    status: ProductArchitectureStatus;
  };
  requirements: Array<Pick<ProductRequirement, "humanId" | "approvalStatus" | "acceptanceCriteria" | "priority">>;
  features: Array<Pick<ProductFeature, "humanId" | "status" | "acceptanceCriteria" | "requirementIds">>;
  openQuestions: Array<Pick<ProductQuestion, "question" | "status">>;
  openCriticalDecisions: number;
}): ProductReadinessResult {
  const gaps: ProductReadinessGap[] = [];

  if (!input.architecture.what.trim()) gaps.push({ code: "DEFINITION_WHAT", message: "Product definition (what) is missing." });
  if (!input.architecture.why.trim()) gaps.push({ code: "DEFINITION_WHY", message: "Product definition (why) is missing." });
  if (!input.architecture.who.trim()) gaps.push({ code: "DEFINITION_WHO", message: "Target users (who) are missing." });
  if (!input.architecture.outcome.trim()) gaps.push({ code: "DEFINITION_OUTCOME", message: "Desired outcome is missing." });

  const accepted = input.requirements.filter((row) => row.approvalStatus === "ACCEPTED");
  if (accepted.length === 0) {
    gaps.push({ code: "NO_ACCEPTED_REQUIREMENTS", message: "No accepted requirements yet." });
  }

  for (const req of accepted) {
    if (req.acceptanceCriteria.length === 0 && (req.priority === "CRITICAL" || req.priority === "HIGH")) {
      gaps.push({
        code: `REQ_AC_${req.humanId}`,
        message: `Add acceptance criteria to ${req.humanId}.`,
      });
    }
  }

  const approvedFeatures = input.features.filter(
    (row) => row.status === "APPROVED" || row.status === "BUILD_READY" || row.status === "IN_PROGRESS" || row.status === "VERIFIED",
  );
  if (approvedFeatures.length === 0) {
    gaps.push({ code: "NO_APPROVED_FEATURES", message: "No approved features yet." });
  }
  for (const feature of approvedFeatures) {
    if (feature.acceptanceCriteria.length === 0) {
      gaps.push({
        code: `FEAT_AC_${feature.humanId}`,
        message: `Add acceptance criteria to ${feature.humanId}.`,
      });
    }
    if (feature.requirementIds.length === 0) {
      gaps.push({
        code: `FEAT_REQ_${feature.humanId}`,
        message: `Link at least one accepted requirement to ${feature.humanId}.`,
      });
    }
  }

  const openQuestions = input.openQuestions.filter((row) => row.status === "OPEN" || row.status === "ESCALATED");
  for (const question of openQuestions) {
    gaps.push({
      code: "OPEN_QUESTION",
      message: `Resolve product question: ${question.question}`,
    });
  }

  if (input.openCriticalDecisions > 0) {
    gaps.push({
      code: "OPEN_DECISIONS",
      message: `Resolve ${input.openCriticalDecisions} open product decision${input.openCriticalDecisions === 1 ? "" : "s"}.`,
    });
  }

  if (input.architecture.status !== "APPROVED" && input.architecture.status !== "BUILD_READY") {
    gaps.push({
      code: "NOT_APPROVED",
      message: `Architecture status is ${input.architecture.status}; founder approval is required before BUILD_READY.`,
    });
  }

  const buildReady = gaps.length === 0;
  return {
    buildReady,
    gaps,
    reasons: buildReady
      ? [
          "Product definition present",
          "Accepted requirements present",
          "Approved features with acceptance criteria",
          "Critical decisions and questions resolved",
        ]
      : gaps.map((gap) => gap.message),
  };
}

export function nextHumanId(prefix: "REQ" | "FEAT" | "FLOW", existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export function isAuthoritativeRequirement(status: RequirementApproval): boolean {
  return status === "ACCEPTED";
}

export function isAuthoritativeFeature(status: FeatureStatus): boolean {
  return status === "APPROVED" || status === "BUILD_READY" || status === "IN_PROGRESS" || status === "VERIFIED";
}

export function suggestProductNextAction(input: {
  readiness: ProductReadinessResult;
  architectureStatus: ProductArchitectureStatus;
  proposedRequirementCount: number;
  proposedFeatureCount: number;
}): { title: string; description: string; sourceKind: string } | null {
  if (input.architectureStatus === "DRAFT") {
    return {
      title: "Define product what / why / who / outcome",
      description: "Fill the Product Architect definition before proposing requirements.",
      sourceKind: "product_architect",
    };
  }
  if (input.proposedRequirementCount > 0) {
    return {
      title: "Review proposed requirements",
      description: `${input.proposedRequirementCount} proposed requirement${input.proposedRequirementCount === 1 ? "" : "s"} awaiting founder approval.`,
      sourceKind: "product_architect",
    };
  }
  const decisionGap = input.readiness.gaps.find((gap) => gap.code === "OPEN_DECISIONS" || gap.code === "OPEN_QUESTION");
  if (decisionGap) {
    return {
      title: "Resolve product decision or question",
      description: decisionGap.message,
      sourceKind: "product_architect",
    };
  }
  const criteriaGap = input.readiness.gaps.find((gap) => gap.code.startsWith("FEAT_AC_") || gap.code.startsWith("REQ_AC_"));
  if (criteriaGap) {
    return {
      title: "Define acceptance criteria",
      description: criteriaGap.message,
      sourceKind: "product_architect",
    };
  }
  if (input.proposedFeatureCount > 0) {
    return {
      title: "Review proposed features",
      description: `${input.proposedFeatureCount} proposed feature${input.proposedFeatureCount === 1 ? "" : "s"} awaiting founder approval.`,
      sourceKind: "product_architect",
    };
  }
  if (input.architectureStatus === "APPROVED" && !input.readiness.buildReady) {
    return {
      title: "Close remaining Product Architect gaps",
      description: input.readiness.reasons[0] ?? "Product architecture is not build-ready yet.",
      sourceKind: "product_architect",
    };
  }
  if (input.readiness.buildReady && input.architectureStatus !== "BUILD_READY") {
    return {
      title: "Mark Product Architecture BUILD READY",
      description: "Definition, requirements, features, and blockers are resolved.",
      sourceKind: "product_architect",
    };
  }
  return null;
}
