import type { ContextItem } from "@/lib/ghost-context/types";
import type {
  ProductArchitecture,
  ProductFeature,
  ProductQuestion,
  ProductRequirement,
} from "./types";
import { answerProductTruthQuestion } from "./truth";
import type { ProductReadinessResult } from "./workflow";

export function collectProductArchitectItems(input: {
  question: string;
  architecture: ProductArchitecture;
  requirements: ProductRequirement[];
  features: ProductFeature[];
  questions: ProductQuestion[];
  readiness: ProductReadinessResult;
}): ContextItem[] {
  const items: ContextItem[] = [
    {
      id: `product-arch-${input.architecture.id}`,
      type: "product_architecture",
      authority: input.architecture.status === "APPROVED" || input.architecture.status === "BUILD_READY" ? "PROJECT_STATE" : "PROJECT_NOTE",
      sourceTable: "product_architectures",
      sourceId: input.architecture.id,
      projectId: input.architecture.projectId,
      title: `Product Architect (${input.architecture.status})`,
      content: [
        `Status: ${input.architecture.status}`,
        `What: ${input.architecture.what || "unknown"}`,
        `Why: ${input.architecture.why || "unknown"}`,
        `Who: ${input.architecture.who || "unknown"}`,
        `Outcome: ${input.architecture.outcome || "unknown"}`,
        input.architecture.nonGoals.length ? `Non-goals: ${input.architecture.nonGoals.join("; ")}` : null,
        input.architecture.ideaId ? `Idea provenance: ${input.architecture.ideaId}` : null,
        input.architecture.strategyId ? `Strategy provenance: ${input.architecture.strategyId}` : null,
        `Build ready: ${input.readiness.buildReady ? "YES" : "NO"}`,
        ...input.readiness.reasons.slice(0, 6).map((reason) => `Readiness note: ${reason}`),
        "Claim kinds: RECORDED FACT, ACCEPTED REQUIREMENT, PROPOSED REQUIREMENT, APPROVED FEATURE, ASSUMPTION, MODEL SUGGESTION.",
        "Proposed items are not approved. Past Ghost answers are not evidence.",
      ]
        .filter(Boolean)
        .join("\n"),
      status: input.architecture.status,
      relevance: 1,
      keep: true,
      selectedBecause: "product architect workspace",
    },
  ];

  const truth = answerProductTruthQuestion(input.question, {
    architecture: input.architecture,
    requirements: input.requirements,
    features: input.features,
    buildReady: input.readiness.buildReady,
    readinessReasons: input.readiness.reasons,
  });
  if (truth) {
    items.push({
      id: `product-truth-${input.architecture.id}`,
      type: "truth_boundary",
      authority: "SYSTEM",
      sourceTable: "product_architectures",
      sourceId: input.architecture.id,
      projectId: input.architecture.projectId,
      title: "Product Architect truth answer",
      content: `${truth.answer}: ${truth.reason} [${truth.kind}]`,
      status: truth.answer,
      relevance: 1,
      keep: true,
      selectedBecause: "truth boundary",
    });
  }

  const q = input.question.toLowerCase();
  const wantRequirements = /requirement|req-|accepted|proposed|building|block/.test(q);
  const wantFeatures = /feature|feat-|approved|flow|done|acceptance/.test(q);
  const wantQuestions = /question|decision|unresolved|block/.test(q);

  for (const requirement of input.requirements.slice(0, wantRequirements ? 12 : 4)) {
    items.push({
      id: `product-req-${requirement.id}`,
      type: "product_requirement",
      authority: requirement.approvalStatus === "ACCEPTED" ? "PROJECT_REQUIREMENT" : "PROJECT_NOTE",
      sourceTable: "product_requirements",
      sourceId: requirement.id,
      projectId: requirement.projectId,
      title: `${requirement.humanId}: ${requirement.title}`,
      content: [
        `Approval: ${requirement.approvalStatus}`,
        `Type: ${requirement.reqType}`,
        `Priority: ${requirement.priority}`,
        requirement.description,
        requirement.acceptanceCriteria.length
          ? `Acceptance: ${requirement.acceptanceCriteria.join("; ")}`
          : "Acceptance criteria: none recorded",
        `Provenance: ${requirement.provenance}`,
      ].join("\n"),
      status: requirement.approvalStatus,
      relevance: wantRequirements ? 0.95 : 0.55,
      keep: requirement.approvalStatus === "ACCEPTED" || wantRequirements,
      selectedBecause: "product requirement",
    });
  }

  for (const feature of input.features.slice(0, wantFeatures ? 12 : 4)) {
    items.push({
      id: `product-feat-${feature.id}`,
      type: "product_feature",
      authority:
        feature.status === "APPROVED" || feature.status === "BUILD_READY" || feature.status === "VERIFIED"
          ? "PROJECT_STATE"
          : "PROJECT_NOTE",
      sourceTable: "product_features",
      sourceId: feature.id,
      projectId: feature.projectId,
      title: `${feature.humanId}: ${feature.name}`,
      content: [
        `Status: ${feature.status}`,
        feature.purpose,
        feature.acceptanceCriteria.length
          ? `Acceptance: ${feature.acceptanceCriteria.join("; ")}`
          : "Acceptance criteria: none recorded",
        `Linked requirements: ${feature.requirementIds.length}`,
        `Provenance: ${feature.provenance}`,
      ].join("\n"),
      status: feature.status,
      relevance: wantFeatures ? 0.95 : 0.55,
      keep: feature.status !== "PROPOSED" || wantFeatures,
      selectedBecause: "product feature",
    });
  }

  for (const question of input.questions.filter((row) => row.status === "OPEN" || row.status === "ESCALATED").slice(0, wantQuestions ? 8 : 3)) {
    items.push({
      id: `product-q-${question.id}`,
      type: "product_question",
      authority: "PROJECT_NOTE",
      sourceTable: "product_questions",
      sourceId: question.id,
      projectId: question.projectId,
      title: `Unresolved: ${question.question}`,
      content: `Status: ${question.status}. ${question.decisionId ? `Linked decision ${question.decisionId}` : "Not escalated."}`,
      status: question.status,
      relevance: wantQuestions ? 0.9 : 0.5,
      keep: true,
      selectedBecause: "unresolved product question",
    });
  }

  return items;
}
