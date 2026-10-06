import type { BuildExecutionStatus, WorkPackageExecution } from "@/lib/build-execution/types";
import type { VerificationKind } from "@/lib/build-plan/types";
import type { ProductFeature, ProductRequirement } from "@/lib/product-architect/types";
import { looksLikeSecretValue } from "@/lib/system-architecture/workflow";
import type {
  VerificationBundle,
  VerificationCase,
  VerificationCaseKind,
  VerificationCaseStatus,
  VerificationDefect,
  VerificationDefectSeverity,
  VerificationEvidence,
  VerificationProgramStatus,
} from "./types";

export { looksLikeSecretValue };

export const LEGAL_VERIFICATION_PROGRAM_TRANSITIONS: Record<
  VerificationProgramStatus,
  readonly VerificationProgramStatus[]
> = {
  NOT_STARTED: ["TESTING"],
  TESTING: ["VERIFICATION_REVIEW", "NOT_STARTED"],
  VERIFICATION_REVIEW: ["TESTING", "VERIFIED"],
  VERIFIED: ["VERIFICATION_REVIEW", "TESTING"],
};

export function canTransitionVerificationProgram(
  from: VerificationProgramStatus,
  to: VerificationProgramStatus,
): boolean {
  return LEGAL_VERIFICATION_PROGRAM_TRANSITIONS[from].includes(to);
}

export const LEGAL_CASE_TRANSITIONS: Record<
  VerificationCaseStatus,
  readonly VerificationCaseStatus[]
> = {
  PLANNED: ["READY", "NOT_APPLICABLE"],
  READY: ["RUNNING", "BLOCKED", "NOT_APPLICABLE", "PLANNED"],
  RUNNING: ["PASSED", "FAILED", "BLOCKED", "READY"],
  PASSED: ["READY", "RUNNING"],
  FAILED: ["READY", "RUNNING", "BLOCKED"],
  BLOCKED: ["READY", "RUNNING", "NOT_APPLICABLE"],
  NOT_APPLICABLE: ["READY", "PLANNED"],
};

export function canTransitionCase(from: VerificationCaseStatus, to: VerificationCaseStatus): boolean {
  return LEGAL_CASE_TRANSITIONS[from].includes(to);
}

export type VerificationHumanIdPrefix = "TC" | "DEF";

export function nextHumanId(prefix: VerificationHumanIdPrefix, existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export function rejectSecretEvidenceReference(reference: string): { ok: boolean; reason: string | null } {
  const value = reference.trim();
  if (!value) return { ok: false, reason: "Evidence reference is required." };
  if (looksLikeSecretValue(value)) {
    return {
      ok: false,
      reason:
        "That looks like a secret value. Store a reference (command name, inspector run id, path), never secret values.",
    };
  }
  return { ok: true, reason: null };
}

export function mapPlanVerificationKind(kind: VerificationKind): VerificationCaseKind {
  switch (kind) {
    case "UNIT":
    case "BUILD":
      return "AUTOMATED";
    case "INTEGRATION":
    case "PROVIDER":
      return "INTEGRATION";
    case "SECURITY":
      return "SECURITY";
    case "RLS":
      return "DATABASE_RLS";
    case "RESPONSIVE":
      return "RESPONSIVE";
    case "E2E":
    case "PRODUCTION":
      return "ACCEPTANCE";
    case "MANUAL":
      return "MANUAL_FUNCTIONAL";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function isBlockingDefect(
  severity: VerificationDefectSeverity,
  blocking: boolean,
): boolean {
  if (severity === "CRITICAL" || severity === "HIGH") return true;
  return blocking;
}

export type VerificationCoverageRow = {
  id: string;
  humanId: string;
  title: string;
  caseStatuses: VerificationCaseStatus[];
  verified: boolean;
};

export function computeVerificationCoverage(input: {
  cases: Array<
    Pick<VerificationCase, "status" | "isRequired" | "requirementId" | "featureId" | "workPackageId">
  >;
  requirements: Array<Pick<ProductRequirement, "id" | "humanId" | "title" | "priority" | "approvalStatus">>;
  features: Array<Pick<ProductFeature, "id" | "humanId" | "name" | "status">>;
  packageExecutions?: Array<Pick<WorkPackageExecution, "workPackageId" | "status">>;
}): {
  requirements: VerificationCoverageRow[];
  features: VerificationCoverageRow[];
  requiredRequirementGaps: string[];
  requiredFeatureGaps: string[];
} {
  const requirements: VerificationCoverageRow[] = input.requirements.map((req) => {
    const linked = input.cases
      .filter((row) => row.requirementId === req.id)
      .map((row) => row.status);
    return {
      id: req.id,
      humanId: req.humanId,
      title: req.title,
      caseStatuses: linked,
      verified: linked.length > 0 && linked.every((status) => status === "PASSED" || status === "NOT_APPLICABLE"),
    };
  });

  const features: VerificationCoverageRow[] = input.features.map((feat) => {
    const linked = input.cases
      .filter((row) => row.featureId === feat.id)
      .map((row) => row.status);
    return {
      id: feat.id,
      humanId: feat.humanId,
      title: feat.name,
      caseStatuses: linked,
      verified: linked.length > 0 && linked.every((status) => status === "PASSED" || status === "NOT_APPLICABLE"),
    };
  });

  const requiredRequirementGaps: string[] = [];
  for (const req of input.requirements) {
    if (req.approvalStatus !== "ACCEPTED") continue;
    if (req.priority !== "HIGH" && req.priority !== "CRITICAL") continue;
    const requiredCases = input.cases.filter((row) => row.requirementId === req.id && row.isRequired);
    if (requiredCases.length === 0) {
      requiredRequirementGaps.push(`${req.humanId} has no required verification case.`);
      continue;
    }
    if (!requiredCases.every((row) => row.status === "PASSED")) {
      requiredRequirementGaps.push(`${req.humanId} required cases are not all PASSED.`);
    }
  }

  const requiredFeatureGaps: string[] = [];
  for (const feat of input.features) {
    if (feat.status !== "APPROVED" && feat.status !== "BUILD_READY" && feat.status !== "IN_PROGRESS" && feat.status !== "VERIFIED") {
      continue;
    }
    const requiredCases = input.cases.filter((row) => row.featureId === feat.id && row.isRequired);
    if (requiredCases.length === 0) {
      requiredFeatureGaps.push(`${feat.humanId} has no required verification case.`);
      continue;
    }
    if (!requiredCases.every((row) => row.status === "PASSED")) {
      requiredFeatureGaps.push(`${feat.humanId} required cases are not all PASSED.`);
    }
  }

  return { requirements, features, requiredRequirementGaps, requiredFeatureGaps };
}

export type RegressionCoverageResult = {
  requiredRegressionCases: Array<Pick<VerificationCase, "id" | "humanId" | "status" | "isRegression" | "workPackageId">>;
  gaps: string[];
  covered: boolean;
};

/**
 * Required regression cases: flagged is_regression, or linked to a package execution that was IMPLEMENTED.
 */
export function computeRegressionCoverage(input: {
  cases: Array<
    Pick<VerificationCase, "id" | "humanId" | "status" | "isRequired" | "isRegression" | "workPackageId">
  >;
  packageExecutions?: Array<Pick<WorkPackageExecution, "workPackageId" | "status">>;
}): RegressionCoverageResult {
  const implementedPackages = new Set(
    (input.packageExecutions ?? [])
      .filter((row) => row.status === "IMPLEMENTED")
      .map((row) => row.workPackageId),
  );
  const requiredRegressionCases = input.cases.filter(
    (row) =>
      row.isRequired &&
      (row.isRegression || (row.workPackageId != null && implementedPackages.has(row.workPackageId))),
  );
  const gaps: string[] = [];
  for (const row of requiredRegressionCases) {
    if (row.status !== "PASSED" && row.status !== "NOT_APPLICABLE") {
      gaps.push(`${row.humanId} regression case is ${row.status}.`);
    }
  }
  return {
    requiredRegressionCases,
    gaps,
    covered: gaps.length === 0,
  };
}

export type VerificationCompletionGap = {
  code: string;
  message: string;
};

export type VerificationCompletionResult = {
  verificationComplete: boolean;
  gaps: VerificationCompletionGap[];
  reasons: string[];
};

export type VerificationCompletionInput = {
  executionStatus: BuildExecutionStatus | null;
  programStatus: VerificationProgramStatus;
  cases: Array<Pick<VerificationCase, "id" | "humanId" | "status" | "isRequired" | "requirementId" | "featureId">>;
  evidence: Array<Pick<VerificationEvidence, "caseId">>;
  defects: Array<Pick<VerificationDefect, "severity" | "blocking" | "status" | "humanId">>;
  requirements: Array<Pick<ProductRequirement, "id" | "humanId" | "title" | "priority" | "approvalStatus">>;
  features: Array<Pick<ProductFeature, "id" | "humanId" | "name" | "status">>;
  openDecisions: number;
};

/** Gaps for the VERIFIED program gate. VERIFIED ≠ DEPLOYED. IMPLEMENTED ≠ VERIFIED. */
export function computeVerificationCompletion(input: VerificationCompletionInput): VerificationCompletionResult {
  const gaps: VerificationCompletionGap[] = [];

  if (input.executionStatus !== "IMPLEMENTED") {
    gaps.push({
      code: "EXECUTION_NOT_IMPLEMENTED",
      message: `Build Execution is ${input.executionStatus ?? "missing"}; it must be IMPLEMENTED before VERIFIED.`,
    });
  }

  const required = input.cases.filter((row) => row.isRequired);
  if (required.length === 0) {
    gaps.push({ code: "NO_REQUIRED_CASES", message: "No required verification cases are recorded." });
  }

  for (const row of required) {
    if (
      row.status === "PLANNED" ||
      row.status === "READY" ||
      row.status === "RUNNING" ||
      row.status === "FAILED" ||
      row.status === "BLOCKED"
    ) {
      gaps.push({
        code: `CASE_${row.humanId}`,
        message: `Required case ${row.humanId} is ${row.status}; must be PASSED or NOT_APPLICABLE.`,
      });
    }
  }

  const evidenceByCase = new Set(input.evidence.map((row) => row.caseId));
  for (const row of required) {
    if (row.status === "PASSED" && !evidenceByCase.has(row.id)) {
      gaps.push({
        code: `EVIDENCE_${row.humanId}`,
        message: `Passed required case ${row.humanId} has no verification evidence.`,
      });
    }
  }

  const openBlocking = input.defects.filter(
    (row) =>
      (row.status === "OPEN" || row.status === "IN_PROGRESS" || row.status === "RETEST_REQUIRED") &&
      isBlockingDefect(row.severity, row.blocking),
  );
  if (openBlocking.length > 0) {
    gaps.push({
      code: "OPEN_BLOCKING_DEFECTS",
      message: `${openBlocking.length} open blocking defect${openBlocking.length === 1 ? "" : "s"} remain (${openBlocking
        .map((row) => row.humanId)
        .slice(0, 5)
        .join(", ")}).`,
    });
  }

  const coverage = computeVerificationCoverage({
    cases: input.cases.map((row) => ({
      ...row,
      isRegression: false,
      workPackageId: null,
    })),
    requirements: input.requirements,
    features: input.features,
  });
  for (const message of coverage.requiredRequirementGaps) {
    gaps.push({ code: "REQ_COVERAGE", message });
  }
  for (const message of coverage.requiredFeatureGaps) {
    gaps.push({ code: "FEAT_COVERAGE", message });
  }

  if (input.openDecisions > 0) {
    gaps.push({
      code: "OPEN_DECISIONS",
      message: `Resolve ${input.openDecisions} open decision${input.openDecisions === 1 ? "" : "s"}.`,
    });
  }

  if (input.programStatus !== "VERIFICATION_REVIEW" && input.programStatus !== "VERIFIED") {
    gaps.push({
      code: "NOT_IN_REVIEW",
      message: `Program status is ${input.programStatus}; move to VERIFICATION_REVIEW before VERIFIED.`,
    });
  }

  const verificationComplete = gaps.length === 0;
  return {
    verificationComplete,
    gaps,
    reasons: verificationComplete
      ? [
          "Build Execution is IMPLEMENTED",
          "All required cases are PASSED or NOT_APPLICABLE with evidence",
          "No open blocking defects",
          "Required requirement and feature coverage is satisfied",
          "Open decisions resolved",
          "VERIFIED means the verification gate passed — not deployed",
        ]
      : gaps.map((gap) => gap.message),
  };
}

export function evaluateVerificationBundle(bundle: VerificationBundle): {
  completion: VerificationCompletionResult;
  coverage: ReturnType<typeof computeVerificationCoverage>;
  regression: RegressionCoverageResult;
  gaps: VerificationCompletionGap[];
} {
  const coverage = computeVerificationCoverage({
    cases: bundle.cases,
    requirements: bundle.requirements,
    features: bundle.features,
    packageExecutions: bundle.packageExecutions,
  });
  const regression = computeRegressionCoverage({
    cases: bundle.cases,
    packageExecutions: bundle.packageExecutions,
  });
  const completion = computeVerificationCompletion({
    executionStatus: bundle.executionStatus,
    programStatus: bundle.program.status,
    cases: bundle.cases,
    evidence: bundle.evidence,
    defects: bundle.defects,
    requirements: bundle.requirements,
    features: bundle.features,
    openDecisions: bundle.openDecisionCount,
  });
  return { completion, coverage, regression, gaps: completion.gaps };
}

export function suggestVerificationNextAction(input: {
  completion: VerificationCompletionResult;
  programStatus: VerificationProgramStatus;
  cases: Array<Pick<VerificationCase, "status" | "isRequired" | "humanId">>;
  defects: Array<Pick<VerificationDefect, "status" | "severity" | "blocking" | "humanId">>;
}): { title: string; description: string; sourceKind: string } | null {
  const sourceKind = "verification";
  const openBlocking = input.defects.filter(
    (row) =>
      (row.status === "OPEN" || row.status === "IN_PROGRESS" || row.status === "RETEST_REQUIRED") &&
      isBlockingDefect(row.severity, row.blocking),
  );
  if (openBlocking.length > 0) {
    const first = openBlocking[0];
    return {
      title: "Correct blocking verification defect",
      description: `${first.humanId} is ${first.status}. Fix implementation or retest before VERIFIED.`,
      sourceKind,
    };
  }

  const decisionGap = input.completion.gaps.find((gap) => gap.code === "OPEN_DECISIONS");
  if (decisionGap) {
    return { title: "Resolve verification decision", description: decisionGap.message, sourceKind };
  }

  const failed = input.cases.filter((row) => row.status === "FAILED");
  if (failed.length > 0) {
    return {
      title: "Triage failed verification case",
      description: `${failed[0].humanId} FAILED. Record defect and correct before continuing.`,
      sourceKind,
    };
  }

  const running = input.cases.filter((row) => row.status === "RUNNING");
  if (running.length > 0) {
    return {
      title: "Finish running verification case",
      description: `${running[0].humanId} is RUNNING. Record pass/fail with evidence.`,
      sourceKind,
    };
  }

  const nextReady = input.cases.find((row) => row.isRequired && (row.status === "READY" || row.status === "PLANNED"));
  if (nextReady) {
    return {
      title: "Run next required verification case",
      description: `${nextReady.humanId} is ${nextReady.status}.`,
      sourceKind,
    };
  }

  if (
    input.completion.verificationComplete === false &&
    input.cases.filter((row) => row.isRequired).every((row) => row.status === "PASSED" || row.status === "NOT_APPLICABLE") &&
    input.programStatus === "TESTING"
  ) {
    return {
      title: "Move verification to VERIFICATION_REVIEW",
      description: "Required cases are complete. Review before marking VERIFIED.",
      sourceKind,
    };
  }

  if (input.completion.verificationComplete && input.programStatus === "VERIFICATION_REVIEW") {
    return {
      title: "Mark Verification VERIFIED",
      description: "Completion gaps are closed. VERIFIED is not deployed.",
      sourceKind,
    };
  }

  if (input.programStatus === "NOT_STARTED") {
    return {
      title: "Start verification testing",
      description: "Move the program to TESTING and run the next required case.",
      sourceKind,
    };
  }

  return null;
}
