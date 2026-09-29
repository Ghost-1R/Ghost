import { randomUUID } from "node:crypto";
import { derivePresentation, traceRequirement } from "./gate";
import type { EvidenceRecord, PresentationReview, ReviewFinding, TraceRow } from "./types";

export function regressionFindings(bugs: Array<{ title: string }>, evidence: EvidenceRecord[]): ReviewFinding[] {
  return bugs.flatMap((bug) => {
    const tested = evidence.some(
      (row) =>
        row.checkType === "regression" &&
        row.status === "passed" &&
        row.logExcerpt.toLocaleLowerCase().includes(bug.title.toLocaleLowerCase()),
    );
    if (tested) {
      return [];
    }
    return [
      {
        severity: "HIGH" as const,
        category: "regression",
        description: `${bug.title} was fixed before and has no regression evidence.`,
        evidence: "No passed regression evidence names this bug.",
        recommendedFix: `Re-test ${bug.title} and record the result as regression evidence.`,
        verificationNeeded: "A fresh passed regression evidence row that names the bug.",
      },
    ];
  });
}

export function buildPresentationReview(input: {
  ownerId: string;
  projectId: string;
  commitSha: string;
  treeHash: string;
  environment: "local" | "production";
  presentingProduction: boolean;
  evidence: EvidenceRecord[];
  requirements: Array<{
    title: string;
    implementationEvidence?: string | null;
    verificationEvidence?: string | null;
    failed?: boolean;
    applicable?: boolean;
    scope?: "current" | "future";
    requiredNow?: boolean;
    observed?: boolean;
    blocked?: boolean;
  }>;
  findings?: ReviewFinding[];
  resolvedBugs?: Array<{ title: string }>;
  overrides?: PresentationReview["overrides"];
  createdAt?: string;
}): PresentationReview {
  const traceability: TraceRow[] = input.requirements.map((requirement) => traceRequirement(requirement));
  const findings = [...(input.findings ?? []), ...regressionFindings(input.resolvedBugs ?? [], input.evidence)];
  const gate = derivePresentation({
    evidence: input.evidence,
    current: { commitSha: input.commitSha, treeHash: input.treeHash },
    environment: input.environment,
    presentingProduction: input.presentingProduction,
    findings,
    traceability,
  });
  return {
    id: randomUUID(),
    ownerId: input.ownerId,
    projectId: input.projectId,
    commitSha: input.commitSha,
    treeHash: input.treeHash,
    environment: input.environment,
    createdAt: input.createdAt ?? new Date().toISOString(),
    evidenceIds: input.evidence.map((row) => row.id),
    findings,
    traceability,
    result: gate.result,
    gaps: gate.gaps,
    fixQueue: gate.fixQueue,
    overrides: input.overrides ?? [],
  };
}
