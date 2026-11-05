import type { ContextItem } from "@/lib/ghost-context/types";
import type { IdeaEvidence, IdeaRecord, IdeaStrategy, IdeaValidation } from "@/lib/ideas/types";
import { answerIdeaTruthQuestion } from "@/lib/ideas/truth";

export function collectIdeaItems(input: {
  question: string;
  idea: IdeaRecord;
  strategy: IdeaStrategy | null;
  validations: IdeaValidation[];
  evidence: IdeaEvidence[];
}): ContextItem[] {
  const items: ContextItem[] = [
    {
      id: `idea-${input.idea.id}`,
      type: "idea",
      authority: "PROJECT_STATE",
      sourceTable: "ideas",
      sourceId: input.idea.id,
      projectId: input.idea.promotedProjectId,
      title: `Idea: ${input.idea.title}`,
      content: [
        `Status: ${input.idea.status}`,
        `Readiness: ${input.idea.readiness}`,
        `Raw: ${input.idea.rawIdea}`,
        input.idea.problem ? `Problem: ${input.idea.problem}` : null,
        input.idea.targetUser ? `Who it is for: ${input.idea.targetUser}` : null,
        input.idea.proposedSolution ? `Proposed solution: ${input.idea.proposedSolution}` : null,
        input.idea.valueProposition ? `Value: ${input.idea.valueProposition}` : null,
        input.idea.assumptions.length ? `Assumptions: ${input.idea.assumptions.join("; ")}` : null,
        input.idea.risks.length ? `Risks: ${input.idea.risks.join("; ")}` : null,
        input.idea.openQuestions.length ? `Open questions: ${input.idea.openQuestions.join("; ")}` : null,
        input.idea.recommendation ? `Ghost recommendation (not a decision): ${input.idea.recommendation}` : null,
        "Claim kinds in this domain: FACT, FOUNDER INPUT, ASSUMPTION, HYPOTHESIS, INFERENCE, UNKNOWN, RECOMMENDATION.",
        "Assumptions are not facts. AI analysis is not validation. Promotion is not implementation or deployment.",
      ]
        .filter(Boolean)
        .join("\n"),
      status: input.idea.status,
      relevance: 1,
      keep: true,
      selectedBecause: "idea workspace",
    },
  ];

  if (input.strategy) {
    items.push({
      id: `strategy-${input.strategy.id}`,
      type: "strategy",
      authority: input.strategy.approvedAt ? "PROJECT_DECISION" : "PROJECT_NOTE",
      sourceTable: "idea_strategies",
      sourceId: input.strategy.id,
      projectId: input.idea.promotedProjectId,
      title: input.strategy.approvedAt ? "Approved strategy" : "Strategy draft",
      content: [
        input.strategy.vision ? `Vision: ${input.strategy.vision}` : "Vision: unknown",
        input.strategy.targetCustomer ? `Target customer: ${input.strategy.targetCustomer}` : "Target customer: unknown",
        input.strategy.differentiation ? `Differentiation: ${input.strategy.differentiation}` : "Differentiation: unknown",
        input.strategy.mvp ? `MVP: ${input.strategy.mvp}` : "MVP: unknown",
        input.strategy.notBuilding ? `Not building: ${input.strategy.notBuilding}` : "Not building: unknown",
        input.strategy.approvedAt
          ? `Founder approved at ${input.strategy.approvedAt}`
          : "Strategy is a draft until founder approval.",
      ].join("\n"),
      status: input.strategy.approvedAt ? "APPROVED" : "DRAFT",
      relevance: 1,
      keep: true,
      selectedBecause: "strategy workspace",
    });
  }

  for (const validation of input.validations.slice(0, 12)) {
    items.push({
      id: `validation-${validation.id}`,
      type: "validation",
      authority: "PROJECT_NOTE",
      sourceTable: "idea_validations",
      sourceId: validation.id,
      projectId: input.idea.promotedProjectId,
      title: `Validation: ${validation.question}`,
      content: `Status: ${validation.status}. Reason: ${validation.reason || "none"}. Result: ${validation.result || "none"}. Source: ${validation.source}.`,
      status: validation.status,
      relevance: 0.9,
      keep: true,
      selectedBecause: "validation",
    });
  }

  for (const evidence of input.evidence.slice(0, 12)) {
    items.push({
      id: `evidence-${evidence.id}`,
      type: "evidence",
      authority: "PROJECT_STATE",
      sourceTable: "idea_evidence",
      sourceId: evidence.id,
      projectId: input.idea.promotedProjectId,
      title: `Evidence: ${evidence.evidenceType}`,
      content: `${evidence.statement}${evidence.source ? `\nSource: ${evidence.source}` : ""}\nProvenance: ${evidence.provenance}`,
      status: evidence.evidenceType,
      relevance: 1,
      keep: true,
      selectedBecause: "evidence",
    });
  }

  const truth = answerIdeaTruthQuestion(input.question, {
    idea: input.idea,
    strategy: input.strategy,
    validations: input.validations,
    evidence: input.evidence,
  });
  if (truth) {
    items.push({
      id: `truth-${input.idea.id}`,
      type: "truth_boundary",
      authority: "SYSTEM",
      sourceTable: "ideas",
      sourceId: input.idea.id,
      projectId: input.idea.promotedProjectId,
      title: "Truth boundary",
      content: `${truth.answer}. ${truth.reason}`,
      status: truth.answer,
      relevance: 1,
      keep: true,
      selectedBecause: "truth boundary",
    });
  }

  return items;
}
