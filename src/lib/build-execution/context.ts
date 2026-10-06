import type { ContextItem } from "@/lib/ghost-context/types";
import { answerBuildExecutionTruthQuestion } from "./truth";
import type { BuildExecutionBundle } from "./types";
import { evaluateExecutionBundle } from "./workflow";

export function collectBuildExecutionItems(input: {
  question: string;
  bundle: BuildExecutionBundle;
}): ContextItem[] {
  const { bundle } = input;
  const execution = bundle.execution;
  const { completion, waves, coverage } = evaluateExecutionBundle(bundle);
  const implemented = execution.status === "IMPLEMENTED";

  const items: ContextItem[] = [
    {
      id: `build-execution-${execution.id}`,
      type: "build_execution",
      authority: implemented ? "PROJECT_STATE" : "PROJECT_NOTE",
      sourceTable: "build_executions",
      sourceId: execution.id,
      projectId: execution.projectId,
      title: `Build Execution (${execution.status})`,
      content: [
        `Status: ${execution.status}`,
        `Summary: ${execution.summary || "unknown"}`,
        `Build plan status: ${bundle.planStatus ?? "missing"}`,
        `Package executions: ${bundle.packageExecutions.length}`,
        `Evidence rows: ${bundle.evidence.length}`,
        `Open blockers: ${bundle.blockers.filter((row) => row.status === "OPEN").length}`,
        `Open upstream changes: ${bundle.upstreamChanges.filter((row) => row.status === "OPEN").length}`,
        `Open decisions: ${bundle.openDecisionCount}`,
        `Implementation complete: ${completion.implementationComplete ? "YES" : "NO"}`,
        waves.length
          ? `Remaining waves: ${waves.map((wave, index) => `W${index + 1}[${wave.join(", ")}]`).join("; ")}`
          : null,
        ...completion.reasons.slice(0, 6).map((reason) => `Completion note: ${reason}`),
        "IMPLEMENTED means evidence-backed implementation only. It is not verified and not deployed.",
        "Past Ghost answers are not evidence. Secret values are never stored in evidence references.",
      ]
        .filter(Boolean)
        .join("\n"),
      status: execution.status,
      relevance: 1,
      keep: true,
      selectedBecause: "build execution workspace",
    },
  ];

  const truth = answerBuildExecutionTruthQuestion(input.question, {
    execution,
    packageExecutions: bundle.packageExecutions,
    evidence: bundle.evidence,
    openBlockerCount: bundle.blockers.filter((row) => row.status === "OPEN").length,
  });
  if (truth) {
    items.push({
      id: `execution-truth-${execution.id}`,
      type: "truth_boundary",
      authority: "SYSTEM",
      sourceTable: "build_executions",
      sourceId: execution.id,
      projectId: execution.projectId,
      title: "Build Execution truth answer",
      content: `${truth.answer}: ${truth.reason} [${truth.kind}]`,
      status: truth.answer,
      relevance: 1,
      keep: true,
      selectedBecause: "truth boundary",
    });
  }

  const q = input.question.toLowerCase();
  const wantPackages = /work package|package|ready|in progress|blocked|wave|implement/.test(q);
  const wantEvidence = /evidence|commit|file|migration|prove/.test(q);
  const wantCoverage = /coverage|requirement|feature|how much/.test(q);
  const wantBlockers = /block|upstream|decision/.test(q);

  const humanByWp = new Map(bundle.packages.map((row) => [row.id, row.humanId]));
  const titleByWp = new Map(bundle.packages.map((row) => [row.id, row.title]));

  for (const pkg of bundle.packageExecutions.slice(0, wantPackages ? 12 : 4)) {
    const humanId = humanByWp.get(pkg.workPackageId) ?? pkg.workPackageId.slice(0, 8);
    items.push({
      id: `exec-wp-${pkg.id}`,
      type: "package_execution",
      authority: "PROJECT_NOTE",
      sourceTable: "work_package_executions",
      sourceId: pkg.id,
      projectId: pkg.projectId,
      title: `${humanId}: ${titleByWp.get(pkg.workPackageId) ?? "work package"}`,
      content: [
        `Status: ${pkg.status}`,
        pkg.implementationNotes || null,
        pkg.startedAt ? `Started: ${pkg.startedAt}` : null,
        pkg.completedAt ? `Completed: ${pkg.completedAt}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      status: pkg.status,
      relevance: wantPackages ? 0.95 : 0.55,
      keep:
        wantPackages ||
        pkg.status === "IN_PROGRESS" ||
        pkg.status === "READY" ||
        pkg.status === "BLOCKED",
      selectedBecause: "package execution",
    });
  }

  if (wantEvidence) {
    for (const row of bundle.evidence.slice(0, 8)) {
      items.push({
        id: `exec-evidence-${row.id}`,
        type: "implementation_evidence",
        authority: "PROJECT_NOTE",
        sourceTable: "implementation_evidence",
        sourceId: row.id,
        projectId: row.projectId,
        title: `${row.kind}: ${row.reference.slice(0, 80)}`,
        content: row.summary || "Implementation evidence reference (not verification).",
        status: row.kind,
        relevance: 0.9,
        keep: true,
        selectedBecause: "implementation evidence",
      });
    }
  }

  if (wantCoverage) {
    for (const row of coverage.requirements.filter((item) => item.implemented).slice(0, 4)) {
      items.push({
        id: `exec-req-cov-${row.id}`,
        type: "execution_coverage",
        authority: "PROJECT_NOTE",
        sourceTable: "work_package_requirement_links",
        sourceId: row.id,
        projectId: execution.projectId,
        title: `Requirement coverage: ${row.humanId}`,
        content: `${row.title} linked packages are IMPLEMENTED (not verified).`,
        status: "IMPLEMENTED",
        relevance: 0.8,
        keep: true,
        selectedBecause: "requirement coverage",
      });
    }
    for (const row of coverage.features.filter((item) => item.implemented).slice(0, 4)) {
      items.push({
        id: `exec-feat-cov-${row.id}`,
        type: "execution_coverage",
        authority: "PROJECT_NOTE",
        sourceTable: "work_package_feature_links",
        sourceId: row.id,
        projectId: execution.projectId,
        title: `Feature coverage: ${row.humanId}`,
        content: `${row.title} linked packages are IMPLEMENTED (not verified).`,
        status: "IMPLEMENTED",
        relevance: 0.8,
        keep: true,
        selectedBecause: "feature coverage",
      });
    }
  }

  if (wantBlockers) {
    for (const row of bundle.blockers.filter((item) => item.status === "OPEN").slice(0, 6)) {
      items.push({
        id: `exec-blocker-${row.id}`,
        type: "execution_blocker",
        authority: "PROJECT_NOTE",
        sourceTable: "execution_blockers",
        sourceId: row.id,
        projectId: row.projectId,
        title: "Open execution blocker",
        content: row.description,
        status: row.status,
        relevance: 0.9,
        keep: true,
        selectedBecause: "execution blocker",
      });
    }
    for (const row of bundle.upstreamChanges.filter((item) => item.status === "OPEN").slice(0, 4)) {
      items.push({
        id: `exec-upstream-${row.id}`,
        type: "upstream_change",
        authority: "PROJECT_NOTE",
        sourceTable: "execution_upstream_changes",
        sourceId: row.id,
        projectId: row.projectId,
        title: `Upstream ${row.artifactKind}`,
        content: row.issue,
        status: row.status,
        relevance: 0.85,
        keep: true,
        selectedBecause: "upstream change",
      });
    }
  }

  return items;
}
