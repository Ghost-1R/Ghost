import type { ContextItem } from "@/lib/ghost-context/types";
import { answerBuildPlanTruthQuestion } from "./truth";
import type { BuildPlanBundle } from "./types";
import {
  evaluateBuildPlanBundle,
  uncoveredApprovedFeatures,
  uncoveredCriticalRequirements,
  uncoveredKeyArchitecture,
} from "./workflow";

export function collectBuildPlanItems(input: { question: string; bundle: BuildPlanBundle }): ContextItem[] {
  const { bundle } = input;
  const plan = bundle.plan;
  const { readiness, waves, criticalPath } = evaluateBuildPlanBundle(bundle);
  const approved = plan.status === "APPROVED" || plan.status === "BUILD_PLAN_READY";

  const items: ContextItem[] = [
    {
      id: `build-plan-${plan.id}`,
      type: "build_plan",
      authority: approved ? "PROJECT_STATE" : "PROJECT_NOTE",
      sourceTable: "build_plans",
      sourceId: plan.id,
      projectId: plan.projectId,
      title: `Build Plan (${plan.status})`,
      content: [
        `Status: ${plan.status}`,
        `Summary: ${plan.summary || "unknown"}`,
        `Phases: ${bundle.phases.length}; work packages: ${bundle.packages.length}`,
        `Product architecture status: ${bundle.productStatus ?? "missing"}`,
        `System architecture status: ${bundle.systemStatus ?? "missing"}`,
        `Build plan ready: ${readiness.buildPlanReady ? "YES" : "NO"}`,
        waves.length ? `Execution waves: ${waves.map((wave, index) => `W${index + 1}[${wave.join(", ")}]`).join("; ")}` : null,
        criticalPath.length ? `Critical path: ${criticalPath.join(" → ")}` : null,
        ...readiness.reasons.slice(0, 6).map((reason) => `Readiness note: ${reason}`),
        "Build Plan is planning only. It is not implementation, applied migrations, passing tests, or a deployment.",
        "Work package status PLANNED/READY/BLOCKED is not implemented. Past Ghost answers are not evidence. Secret values are never stored, only names.",
      ]
        .filter(Boolean)
        .join("\n"),
      status: plan.status,
      relevance: 1,
      keep: true,
      selectedBecause: "build plan workspace",
    },
  ];

  const truth = answerBuildPlanTruthQuestion(input.question, {
    plan,
    packageStatuses: bundle.packages.map((row) => row.status),
  });
  if (truth) {
    items.push({
      id: `build-truth-${plan.id}`,
      type: "truth_boundary",
      authority: "SYSTEM",
      sourceTable: "build_plans",
      sourceId: plan.id,
      projectId: plan.projectId,
      title: "Build Plan truth answer",
      content: `${truth.answer}: ${truth.reason} [${truth.kind}]`,
      status: truth.answer,
      relevance: 1,
      keep: true,
      selectedBecause: "truth boundary",
    });
  }

  const q = input.question.toLowerCase();
  const wantPackages = /work package|wp-|phase|package|wave|critical path|depend/.test(q);
  const wantCoverage = /coverage|requirement|feature|architecture link|trace/.test(q);
  const wantRisks = /risk|manual|config|deploy/.test(q);

  for (const pkg of bundle.packages.slice(0, wantPackages ? 12 : 4)) {
    items.push({
      id: `build-wp-${pkg.id}`,
      type: "work_package",
      authority: "PROJECT_NOTE",
      sourceTable: "work_packages",
      sourceId: pkg.id,
      projectId: pkg.projectId,
      title: `${pkg.humanId}: ${pkg.title}`,
      content: [
        `Status: ${pkg.status} (planned work, not implemented)`,
        `Priority: ${pkg.priority}`,
        pkg.objective,
        pkg.pathCertainty !== "UNKNOWN" ? `Path certainty: ${pkg.pathCertainty}` : null,
        pkg.likelyCodeAreas.length ? `Likely code areas: ${pkg.likelyCodeAreas.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      status: pkg.status,
      relevance: wantPackages ? 0.95 : 0.55,
      keep: wantPackages || pkg.priority === "CRITICAL" || pkg.priority === "HIGH",
      selectedBecause: "work package",
    });
  }

  if (wantPackages && waves.length) {
    items.push({
      id: `build-waves-${plan.id}`,
      type: "build_waves",
      authority: "PROJECT_NOTE",
      sourceTable: "work_package_dependencies",
      sourceId: plan.id,
      projectId: plan.projectId,
      title: "Execution waves",
      content: waves.map((wave, index) => `Wave ${index + 1}: ${wave.join(", ") || "none"}`).join("\n"),
      status: "COMPUTED",
      relevance: 0.9,
      keep: true,
      selectedBecause: "execution waves",
    });
  }

  if (wantPackages && criticalPath.length) {
    items.push({
      id: `build-critical-${plan.id}`,
      type: "build_critical_path",
      authority: "PROJECT_NOTE",
      sourceTable: "work_package_dependencies",
      sourceId: plan.id,
      projectId: plan.projectId,
      title: "Critical path",
      content: criticalPath.join(" → "),
      status: "COMPUTED",
      relevance: 0.9,
      keep: true,
      selectedBecause: "critical path",
    });
  }

  if (wantCoverage) {
    for (const row of uncoveredCriticalRequirements(bundle.requirements, bundle.requirementLinks).slice(0, 6)) {
      items.push({
        id: `build-req-gap-${row.id}`,
        type: "build_coverage",
        authority: "PROJECT_NOTE",
        sourceTable: "work_package_requirement_links",
        sourceId: row.id,
        projectId: plan.projectId,
        title: `Unlinked requirement: ${row.humanId}`,
        content: `${row.title} (${row.priority}) has no work package link.`,
        status: "NOT_LINKED",
        relevance: 0.85,
        keep: true,
        selectedBecause: "unlinked requirement",
      });
    }
    for (const row of uncoveredApprovedFeatures(bundle.features, bundle.featureLinks).slice(0, 4)) {
      items.push({
        id: `build-feat-gap-${row.id}`,
        type: "build_coverage",
        authority: "PROJECT_NOTE",
        sourceTable: "work_package_feature_links",
        sourceId: row.id,
        projectId: plan.projectId,
        title: `Unlinked feature: ${row.humanId}`,
        content: `${row.name} has no work package link.`,
        status: "NOT_LINKED",
        relevance: 0.8,
        keep: true,
        selectedBecause: "unlinked feature",
      });
    }
    for (const row of uncoveredKeyArchitecture(bundle.architectureRecords, bundle.architectureLinks).slice(0, 4)) {
      items.push({
        id: `build-arch-gap-${row.humanId}`,
        type: "build_coverage",
        authority: "PROJECT_NOTE",
        sourceTable: "work_package_architecture_links",
        sourceId: row.humanId,
        projectId: plan.projectId,
        title: `Unlinked architecture: ${row.humanId}`,
        content: `Approved ${row.kind.toLowerCase()} ${row.name} has no work package link.`,
        status: "NOT_LINKED",
        relevance: 0.8,
        keep: true,
        selectedBecause: "unlinked architecture",
      });
    }
  }

  if (wantRisks) {
    for (const risk of bundle.risks.slice(0, 6)) {
      items.push({
        id: `build-risk-${risk.id}`,
        type: "build_risk",
        authority: "PROJECT_NOTE",
        sourceTable: "build_plan_risks",
        sourceId: risk.id,
        projectId: risk.projectId,
        title: `${risk.humanId} (${risk.severity})`,
        content: `${risk.description}\nMitigation: ${risk.mitigation || "none recorded"}`,
        status: risk.severity,
        relevance: 0.85,
        keep: true,
        selectedBecause: "build risk",
      });
    }
  }

  return items;
}
