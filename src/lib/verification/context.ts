import type { ContextItem } from "@/lib/ghost-context/types";
import { answerVerificationTruthQuestion } from "./truth";
import type { VerificationBundle } from "./types";
import { evaluateVerificationBundle, isBlockingDefect } from "./workflow";

export function collectVerificationItems(input: {
  question: string;
  bundle: VerificationBundle;
}): ContextItem[] {
  const { bundle } = input;
  const program = bundle.program;
  const { completion, coverage, regression } = evaluateVerificationBundle(bundle);
  const verified = program.status === "VERIFIED";

  const items: ContextItem[] = [
    {
      id: `verification-${program.id}`,
      type: "verification_program",
      authority: verified ? "PROJECT_STATE" : "PROJECT_NOTE",
      sourceTable: "verification_programs",
      sourceId: program.id,
      projectId: program.projectId,
      title: `Verification (${program.status})`,
      content: [
        `Status: ${program.status}`,
        `Summary: ${program.summary || "unknown"}`,
        `Build execution status: ${bundle.executionStatus ?? "missing"}`,
        `Cases: ${bundle.cases.length}`,
        `Evidence rows: ${bundle.evidence.length}`,
        `Open blocking defects: ${bundle.defects.filter((row) => (row.status === "OPEN" || row.status === "IN_PROGRESS" || row.status === "RETEST_REQUIRED") && isBlockingDefect(row.severity, row.blocking)).length}`,
        `Open decisions: ${bundle.openDecisionCount}`,
        `Verification complete: ${completion.verificationComplete ? "YES" : "NO"}`,
        `Regression coverage: ${regression.covered ? "YES" : "NO"}`,
        ...completion.reasons.slice(0, 6).map((reason) => `Completion note: ${reason}`),
        "VERIFIED means the verification gate passed. It is not deployed. IMPLEMENTED is not VERIFIED.",
        "Past Ghost answers are not evidence. Secret values are never stored in evidence references.",
      ]
        .filter(Boolean)
        .join("\n"),
      status: program.status,
      relevance: 1,
      keep: true,
      selectedBecause: "verification workspace",
    },
  ];

  const truth = answerVerificationTruthQuestion(input.question, {
    program,
    executionStatus: bundle.executionStatus,
    cases: bundle.cases,
    evidence: bundle.evidence,
    defects: bundle.defects,
    requirements: bundle.requirements,
  });
  if (truth) {
    items.push({
      id: `verification-truth-${program.id}`,
      type: "truth_boundary",
      authority: "SYSTEM",
      sourceTable: "verification_programs",
      sourceId: program.id,
      projectId: program.projectId,
      title: "Verification truth answer",
      content: `${truth.answer}: ${truth.reason} [${truth.kind}]`,
      status: truth.answer,
      relevance: 1,
      keep: true,
      selectedBecause: "truth boundary",
    });
  }

  const q = input.question.toLowerCase();
  const wantCases = /case|test|pass|fail|ready|running|regression/.test(q);
  const wantEvidence = /evidence|prove|screenshot|probe/.test(q);
  const wantDefects = /defect|block|retest|bug/.test(q);
  const wantCoverage = /coverage|requirement|feature|verified/.test(q);

  for (const row of bundle.cases.slice(0, wantCases ? 12 : 4)) {
    items.push({
      id: `ver-case-${row.id}`,
      type: "verification_case",
      authority: "PROJECT_NOTE",
      sourceTable: "verification_cases",
      sourceId: row.id,
      projectId: row.projectId,
      title: `${row.humanId}: ${row.title}`,
      content: [
        `Status: ${row.status}`,
        `Kind: ${row.caseKind}`,
        row.isRequired ? "Required" : "Optional",
        row.isRegression ? "Regression" : null,
        row.expectedResult || null,
        row.actualResult || null,
      ]
        .filter(Boolean)
        .join("\n"),
      status: row.status,
      relevance: wantCases ? 0.95 : 0.55,
      keep:
        wantCases ||
        row.status === "RUNNING" ||
        row.status === "READY" ||
        row.status === "FAILED" ||
        row.status === "BLOCKED",
      selectedBecause: "verification case",
    });
  }

  if (wantEvidence) {
    for (const row of bundle.evidence.slice(0, 8)) {
      items.push({
        id: `ver-evidence-${row.id}`,
        type: "verification_evidence",
        authority: "PROJECT_NOTE",
        sourceTable: "verification_evidence",
        sourceId: row.id,
        projectId: row.projectId,
        title: `${row.kind}: ${row.reference.slice(0, 80)}`,
        content: row.summary || "Verification evidence reference (not deployment).",
        status: row.kind,
        relevance: 0.9,
        keep: true,
        selectedBecause: "verification evidence",
      });
    }
  }

  if (wantDefects) {
    for (const row of bundle.defects
      .filter((item) => item.status !== "CLOSED")
      .slice(0, 8)) {
      items.push({
        id: `ver-defect-${row.id}`,
        type: "verification_defect",
        authority: "PROJECT_NOTE",
        sourceTable: "verification_defects",
        sourceId: row.id,
        projectId: row.projectId,
        title: `${row.humanId}: ${row.title}`,
        content: [
          `Status: ${row.status}`,
          `Severity: ${row.severity}`,
          isBlockingDefect(row.severity, row.blocking) ? "Blocking" : "Non-blocking",
          row.description || null,
          row.resolution || null,
        ]
          .filter(Boolean)
          .join("\n"),
        status: row.status,
        relevance: 0.92,
        keep: true,
        selectedBecause: "verification defect",
      });
    }
  }

  if (wantCoverage) {
    for (const row of coverage.requirements.filter((item) => item.verified).slice(0, 4)) {
      items.push({
        id: `ver-req-cov-${row.id}`,
        type: "verification_coverage",
        authority: "PROJECT_NOTE",
        sourceTable: "verification_cases",
        sourceId: row.id,
        projectId: program.projectId,
        title: `Requirement verified: ${row.humanId}`,
        content: `${row.title} linked required cases PASSED/NOT_APPLICABLE (not deployed).`,
        status: "VERIFIED",
        relevance: 0.8,
        keep: true,
        selectedBecause: "requirement coverage",
      });
    }
    for (const row of coverage.features.filter((item) => item.verified).slice(0, 4)) {
      items.push({
        id: `ver-feat-cov-${row.id}`,
        type: "verification_coverage",
        authority: "PROJECT_NOTE",
        sourceTable: "verification_cases",
        sourceId: row.id,
        projectId: program.projectId,
        title: `Feature verified: ${row.humanId}`,
        content: `${row.title} linked required cases PASSED/NOT_APPLICABLE (not deployed).`,
        status: "VERIFIED",
        relevance: 0.8,
        keep: true,
        selectedBecause: "feature coverage",
      });
    }
  }

  return items;
}
