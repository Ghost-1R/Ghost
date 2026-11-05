import { BUILD_PLAN_REVIEW_STEPS, type ShiftEvidenceLink } from "./types";
import { fingerprintReviewResult } from "./workflow";

export type BuildPlanReviewInput = {
  projectId: string;
  projectName: string;
  idempotencyKey: string;
  buildPlan: {
    id: string;
    status: string;
    summary: string;
    updatedAt: string;
  } | null;
  risks: readonly {
    id: string;
    severity: string;
    description: string;
    mitigation: string | null;
  }[];
  verifications: readonly {
    id: string;
    state: string;
    category: string;
    target: string;
  }[];
};

export type BuildPlanReviewStepResult = {
  step: number;
  label: string;
  done: boolean;
  summary: string;
  evidence: ShiftEvidenceLink[];
  resultFingerprint: string | null;
};

function evidenceFor(projectId: string, buildPlanId: string | null): ShiftEvidenceLink[] {
  const links: ShiftEvidenceLink[] = [
    { label: "Open build plan", href: `/projects/${projectId}/build-plan` },
    { label: "Watch Room", href: `/underworld/watch?project=${projectId}` },
  ];
  if (buildPlanId) {
    links.push({
      label: "Build plan record",
      href: `/projects/${projectId}/build-plan#plan-${buildPlanId}`,
    });
  }
  return links;
}

/**
 * Pure, deterministic, read-only review steps.
 * Never mutates project records. Safe to resume from checkpoint_step.
 */
export function runBuildPlanReviewStep(
  input: BuildPlanReviewInput,
  fromStep: number,
): BuildPlanReviewStepResult {
  const next = Math.max(0, fromStep) + 1;
  const plan = input.buildPlan;
  const evidence = evidenceFor(input.projectId, plan?.id ?? null);

  if (!plan) {
    return {
      step: Math.min(next, BUILD_PLAN_REVIEW_STEPS),
      label: "missing-build-plan",
      done: true,
      summary: `No saved build plan for ${input.projectName}. Review stopped without inventing work.`,
      evidence,
      resultFingerprint: fingerprintReviewResult({
        projectId: input.projectId,
        buildPlanId: "none",
        summary: "missing-build-plan",
        evidenceHrefs: evidence.map((e) => e.href),
        idempotencyKey: input.idempotencyKey,
      }),
    };
  }

  if (next === 1) {
    return {
      step: 1,
      label: "load-build-plan",
      done: false,
      summary: `Loaded build plan ${plan.status} · ${plan.summary || "no summary"}.`,
      evidence,
      resultFingerprint: null,
    };
  }

  if (next === 2) {
    const high = input.risks.filter((r) => /HIGH|CRITICAL/i.test(r.severity));
    return {
      step: 2,
      label: "score-risks",
      done: false,
      summary: `Recorded risks: ${input.risks.length} total · ${high.length} high/critical.`,
      evidence,
      resultFingerprint: null,
    };
  }

  if (next === 3) {
    const gaps = input.verifications.filter((v) => !/VERIFIED|PASSED/i.test(v.state));
    return {
      step: 3,
      label: "check-verification",
      done: false,
      summary: `Verification records: ${input.verifications.length} · open gaps: ${gaps.length}.`,
      evidence,
      resultFingerprint: null,
    };
  }

  const highRisks = input.risks.filter((r) => /HIGH|CRITICAL/i.test(r.severity));
  const gaps = input.verifications.filter((v) => !/VERIFIED|PASSED/i.test(v.state));
  const summary = [
    `Build plan review for ${input.projectName}.`,
    `Plan status ${plan.status}.`,
    `${highRisks.length} high/critical risk(s).`,
    `${gaps.length} verification gap(s).`,
    "Read-only: no project records were changed.",
    "Consequential follow-ups require founder approval.",
  ].join(" ");

  return {
    step: BUILD_PLAN_REVIEW_STEPS,
    label: "compose-review",
    done: true,
    summary,
    evidence,
    resultFingerprint: fingerprintReviewResult({
      projectId: input.projectId,
      buildPlanId: plan.id,
      summary,
      evidenceHrefs: evidence.map((e) => e.href),
      idempotencyKey: input.idempotencyKey,
    }),
  };
}
