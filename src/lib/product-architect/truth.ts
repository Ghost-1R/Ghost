import type { ProductArchitecture, ProductFeature, ProductRequirement } from "./types";
import { isAuthoritativeFeature, isAuthoritativeRequirement } from "./workflow";

export type ProductTruthAnswer = {
  answer: "YES" | "NO" | "UNKNOWN";
  reason: string;
  kind:
    | "RECORDED_FACT"
    | "ACCEPTED_REQUIREMENT"
    | "PROPOSED_REQUIREMENT"
    | "APPROVED_FEATURE"
    | "PROPOSED_FEATURE"
    | "ASSUMPTION"
    | "MODEL_SUGGESTION"
    | "UNKNOWN";
};

export function isRequirementAuthoritative(requirement: Pick<ProductRequirement, "approvalStatus" | "humanId">): ProductTruthAnswer {
  if (isAuthoritativeRequirement(requirement.approvalStatus)) {
    return {
      answer: "YES",
      reason: `${requirement.humanId} is ACCEPTED. Founder approval makes it authoritative.`,
      kind: "ACCEPTED_REQUIREMENT",
    };
  }
  if (requirement.approvalStatus === "PROPOSED") {
    return {
      answer: "NO",
      reason: `${requirement.humanId} is PROPOSED. AI or draft proposals are not requirements until accepted.`,
      kind: "PROPOSED_REQUIREMENT",
    };
  }
  return {
    answer: "NO",
    reason: `${requirement.humanId} is ${requirement.approvalStatus}, not an accepted requirement.`,
    kind: "PROPOSED_REQUIREMENT",
  };
}

export function isFeatureApproved(feature: Pick<ProductFeature, "status" | "humanId">): ProductTruthAnswer {
  if (isAuthoritativeFeature(feature.status)) {
    return {
      answer: "YES",
      reason: `${feature.humanId} status is ${feature.status}.`,
      kind: "APPROVED_FEATURE",
    };
  }
  return {
    answer: "NO",
    reason: `${feature.humanId} is ${feature.status}. Proposed features are not approved.`,
    kind: "PROPOSED_FEATURE",
  };
}

export function isProductBuildReady(buildReady: boolean, reasons: string[]): ProductTruthAnswer {
  if (buildReady) {
    return {
      answer: "YES",
      reason: "Deterministic readiness rules all pass.",
      kind: "RECORDED_FACT",
    };
  }
  return {
    answer: "NO",
    reason: reasons[0] ?? "Product architecture is not build-ready.",
    kind: "RECORDED_FACT",
  };
}

export function answerProductTruthQuestion(
  question: string,
  input: {
    architecture: ProductArchitecture | null;
    requirements: ProductRequirement[];
    features: ProductFeature[];
    buildReady: boolean;
    readinessReasons: string[];
  },
): ProductTruthAnswer | null {
  const q = question.toLowerCase();
  if (/ready for architecture|build ready|is this ready/.test(q)) {
    return isProductBuildReady(input.buildReady, input.readinessReasons);
  }
  if (/what are we building|what is this product/.test(q)) {
    if (!input.architecture?.what.trim()) {
      return { answer: "UNKNOWN", reason: "No product definition (what) is recorded.", kind: "UNKNOWN" };
    }
    return {
      answer: "YES",
      reason: input.architecture.what,
      kind: "RECORDED_FACT",
    };
  }
  if (/features? (are )?approved|approved features/.test(q)) {
    const approved = input.features.filter((feature) => isAuthoritativeFeature(feature.status));
    if (approved.length === 0) {
      return { answer: "NO", reason: "No approved features are recorded.", kind: "RECORDED_FACT" };
    }
    return {
      answer: "YES",
      reason: approved.map((feature) => `${feature.humanId}: ${feature.name}`).join("; "),
      kind: "APPROVED_FEATURE",
    };
  }
  if (/requirements? (still )?unresolved|proposed requirements/.test(q)) {
    const proposed = input.requirements.filter((requirement) => requirement.approvalStatus === "PROPOSED");
    if (proposed.length === 0) {
      return { answer: "NO", reason: "No proposed requirements are waiting.", kind: "RECORDED_FACT" };
    }
    return {
      answer: "YES",
      reason: proposed.map((requirement) => requirement.humanId).join(", "),
      kind: "PROPOSED_REQUIREMENT",
    };
  }
  if (/past (answer|response)|previous ghost|ghost said/.test(q)) {
    return {
      answer: "NO",
      reason: "A past Ghost answer is not authoritative evidence. Use Product Architect records.",
      kind: "MODEL_SUGGESTION",
    };
  }
  return null;
}
