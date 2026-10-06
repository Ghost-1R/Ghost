import type { VerificationProgramStatus } from "@/lib/verification/types";
import { looksLikeSecretValue } from "@/lib/system-architecture/workflow";
import type {
  Deployment,
  DeploymentAttemptStatus,
  DeploymentEnvironment,
  DeploymentHealthCheck,
  DeploymentManualAction,
  ReleaseBundle,
  ReleaseConfigRequirement,
  ReleaseMigration,
  ReleaseStatus,
} from "./types";

export { looksLikeSecretValue };

export const LEGAL_RELEASE_TRANSITIONS: Record<ReleaseStatus, readonly ReleaseStatus[]> = {
  DRAFT: ["DEPLOYMENT_READY"],
  DEPLOYMENT_READY: ["DEPLOYING", "DRAFT"],
  DEPLOYING: ["DEPLOYED", "DEPLOYMENT_READY"],
  DEPLOYED: ["PRODUCTION_VERIFICATION", "DEPLOYING"],
  PRODUCTION_VERIFICATION: ["PRODUCTION_VERIFIED", "DEPLOYED"],
  PRODUCTION_VERIFIED: ["PRODUCTION_VERIFICATION", "DEPLOYED"],
};

export function canTransitionRelease(from: ReleaseStatus, to: ReleaseStatus): boolean {
  return LEGAL_RELEASE_TRANSITIONS[from].includes(to);
}

/** A failed attempt stays FAILED; a retry is a new deployment row. */
export const LEGAL_DEPLOYMENT_ATTEMPT_TRANSITIONS: Record<
  DeploymentAttemptStatus,
  readonly DeploymentAttemptStatus[]
> = {
  QUEUED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: ["ROLLED_BACK"],
  FAILED: [],
  ROLLED_BACK: [],
  CANCELLED: [],
};

export function canTransitionDeployment(from: DeploymentAttemptStatus, to: DeploymentAttemptStatus): boolean {
  return LEGAL_DEPLOYMENT_ATTEMPT_TRANSITIONS[from].includes(to);
}

export type ReleaseHumanIdPrefix = "REL" | "DEP";

export function nextHumanId(prefix: ReleaseHumanIdPrefix, existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

const COMMIT_SHA_PATTERN = /\b(?:[0-9a-f]{40}|[0-9a-f]{64})\b/gi;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** Secret heuristic that tolerates full git commit SHAs, which are legitimate release references. */
export function containsSecretLikeText(text: string): boolean {
  const value = text.replace(COMMIT_SHA_PATTERN, "sha");
  return looksLikeSecretValue(value) || PRIVATE_KEY_PATTERN.test(value);
}

export function rejectSecretEvidenceReference(reference: string): { ok: boolean; reason: string | null } {
  const value = reference.trim();
  if (!value) return { ok: false, reason: "Evidence reference is required." };
  if (containsSecretLikeText(value)) {
    return {
      ok: false,
      reason:
        "That looks like a secret value. Store a reference (command name, provider deployment id, URL, inspector run id), never secret values.",
    };
  }
  return { ok: true, reason: null };
}

/** Config rows record presence only. The variable name must be a NAME, and free text must never carry key material. */
export function rejectSecretConfigValue(input: {
  variableName: string;
  note?: string;
}): { ok: boolean; reason: string | null } {
  const name = input.variableName.trim();
  if (!name) return { ok: false, reason: "Variable name is required." };
  if (name.includes("=")) {
    return { ok: false, reason: "Variable name must not contain '='. Record the NAME only, never a value." };
  }
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    return { ok: false, reason: "Use an environment variable NAME such as GROQ_API_KEY (letters, digits, underscore)." };
  }
  if (/^(sk-|gsk_|eyJ)/.test(name)) {
    return { ok: false, reason: "That looks like a secret value, not a variable name." };
  }
  const note = input.note?.trim() ?? "";
  if (note && containsSecretLikeText(note)) {
    return {
      ok: false,
      reason: "The note looks like it contains a secret value. Record presence only (PRESENT, MISSING, UNKNOWN).",
    };
  }
  return { ok: true, reason: null };
}

export function shasMatch(expected: string | null | undefined, live: string | null | undefined): boolean {
  const left = (expected ?? "").trim().toLowerCase();
  const right = (live ?? "").trim().toLowerCase();
  return left.length > 0 && right.length > 0 && left === right;
}

export type ReleaseGap = {
  code: string;
  message: string;
};

export type DeploymentReadinessInput = {
  verificationStatus: VerificationProgramStatus | null;
  sourceCommitSha: string;
  environment: Pick<DeploymentEnvironment, "name" | "environmentType"> | null;
  configRequirements: Array<Pick<ReleaseConfigRequirement, "variableName" | "isRequired" | "presence">>;
  migrations: Array<Pick<ReleaseMigration, "migrationPath" | "isRequired" | "status">>;
  deploymentSequence: string[];
  rollbackStrategy: string;
  openDecisions: number;
  manualActions: Array<Pick<DeploymentManualAction, "title" | "isRequired" | "status">>;
};

export type DeploymentReadinessResult = {
  ready: boolean;
  gaps: ReleaseGap[];
  reasons: string[];
};

/** Gaps for DEPLOYMENT_READY. DEPLOYMENT_READY is not deployed. VERIFIED ≠ DEPLOYED. */
export function computeDeploymentReadiness(input: DeploymentReadinessInput): DeploymentReadinessResult {
  const gaps: ReleaseGap[] = [];

  if (input.verificationStatus !== "VERIFIED") {
    gaps.push({
      code: "VERIFICATION_NOT_VERIFIED",
      message: `Verification is ${input.verificationStatus ?? "missing"}; it must be VERIFIED before a release is deployment-ready.`,
    });
  }

  if (!input.sourceCommitSha.trim()) {
    gaps.push({ code: "NO_SOURCE_SHA", message: "Source commit SHA is not recorded." });
  }

  if (!input.environment) {
    gaps.push({ code: "NO_ENVIRONMENT", message: "No deployment environment is selected for this release." });
  }

  for (const row of input.configRequirements) {
    if (row.isRequired && row.presence !== "PRESENT") {
      gaps.push({
        code: `CONFIG_${row.variableName}`,
        message: `Required configuration ${row.variableName} is ${row.presence}; it must be PRESENT.`,
      });
    }
  }

  for (const row of input.migrations) {
    if (row.isRequired && row.status !== "APPLIED" && row.status !== "NOT_REQUIRED") {
      gaps.push({
        code: `MIGRATION_${row.migrationPath}`,
        message: `Required migration ${row.migrationPath} is ${row.status}; committed is not applied.`,
      });
    }
  }

  if (input.deploymentSequence.filter((step) => step.trim()).length === 0) {
    gaps.push({ code: "NO_SEQUENCE", message: "Deployment sequence is empty." });
  }

  if (!input.rollbackStrategy.trim()) {
    gaps.push({ code: "NO_ROLLBACK_STRATEGY", message: "Rollback strategy is empty." });
  }

  if (input.openDecisions > 0) {
    gaps.push({
      code: "OPEN_DECISIONS",
      message: `Resolve ${input.openDecisions} open decision${input.openDecisions === 1 ? "" : "s"}.`,
    });
  }

  for (const row of input.manualActions) {
    if (row.isRequired && row.status === "PENDING") {
      gaps.push({
        code: `MANUAL_${row.title}`,
        message: `Required manual action "${row.title}" is still PENDING.`,
      });
    }
  }

  const ready = gaps.length === 0;
  return {
    ready,
    gaps,
    reasons: ready
      ? [
          "Verification is VERIFIED",
          "Source commit SHA and environment are recorded",
          "Required configuration is PRESENT and required migrations are applied",
          "Deployment sequence and rollback strategy are recorded",
          "No open decisions or pending required manual actions",
          "DEPLOYMENT_READY means ready to deploy — not deployed",
        ]
      : gaps.map((gap) => gap.message),
  };
}

export type ProductionVerificationInput = {
  deployments: Array<
    Pick<
      Deployment,
      "id" | "humanId" | "status" | "expectedCommitSha" | "liveCommitSha" | "inspectorResult" | "presentationResult" | "createdAt"
    >
  >;
  healthChecks: Array<Pick<DeploymentHealthCheck, "deploymentId" | "checkName" | "status">>;
  openDecisions: number;
};

export type ProductionVerificationResult = {
  productionVerified: boolean;
  gaps: ReleaseGap[];
  warnings: string[];
  reasons: string[];
};

const INSPECTOR_PASS = /^(pass|passed|ready|ready_with_gaps)$/i;

export function isInspectorPass(result: string): boolean {
  return INSPECTOR_PASS.test(result.trim());
}

export function latestSucceededDeployment<T extends Pick<Deployment, "status" | "createdAt">>(
  deployments: readonly T[],
): T | null {
  return (
    [...deployments]
      .filter((row) => row.status === "SUCCEEDED")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  );
}

/**
 * Gaps for PRODUCTION_VERIFIED. READY_WITH_GAPS presentation is allowed and surfaced as a warning;
 * NOT_READY blocks. PRODUCTION_VERIFIED is never inferred from a deployment alone.
 */
export function computeProductionVerification(input: ProductionVerificationInput): ProductionVerificationResult {
  const gaps: ReleaseGap[] = [];
  const warnings: string[] = [];

  const deployment = latestSucceededDeployment(input.deployments);
  if (!deployment) {
    gaps.push({ code: "NO_SUCCEEDED_DEPLOYMENT", message: "No SUCCEEDED deployment is recorded." });
  } else {
    if (!deployment.expectedCommitSha.trim()) {
      gaps.push({
        code: "NO_EXPECTED_SHA",
        message: `${deployment.humanId} has no expected commit SHA.`,
      });
    }
    if (!deployment.liveCommitSha.trim()) {
      gaps.push({ code: "NO_LIVE_SHA", message: `${deployment.humanId} has no recorded live commit SHA.` });
    }
    if (
      deployment.expectedCommitSha.trim() &&
      deployment.liveCommitSha.trim() &&
      !shasMatch(deployment.expectedCommitSha, deployment.liveCommitSha)
    ) {
      gaps.push({
        code: "SHA_MISMATCH",
        message: `${deployment.humanId} live SHA does not match the expected SHA.`,
      });
    }

    const checks = input.healthChecks.filter((row) => row.deploymentId === deployment.id);
    const required = checks.filter((row) => row.status !== "SKIPPED");
    if (required.length === 0) {
      gaps.push({ code: "NO_HEALTH_CHECKS", message: `${deployment.humanId} has no health check recorded.` });
    }
    for (const row of required) {
      if (row.status !== "PASSED") {
        gaps.push({
          code: `HEALTH_${row.checkName}`,
          message: `Health check "${row.checkName}" is ${row.status}; it must be PASSED.`,
        });
      }
    }

    const inspector = deployment.inspectorResult.trim();
    if (!inspector) {
      gaps.push({ code: "NO_INSPECTOR_RESULT", message: `${deployment.humanId} has no inspector result.` });
    } else if (!isInspectorPass(inspector)) {
      gaps.push({
        code: "INSPECTOR_NOT_PASS",
        message: `Inspector result is ${inspector}; it must be PASS or READY.`,
      });
    }

    const presentation = deployment.presentationResult.trim().toUpperCase();
    if (!presentation) {
      gaps.push({ code: "NO_PRESENTATION_RESULT", message: `${deployment.humanId} has no presentation gate result.` });
    } else if (presentation === "NOT_READY") {
      gaps.push({ code: "PRESENTATION_NOT_READY", message: "Presentation gate is NOT_READY; it blocks production verification." });
    } else if (presentation === "READY_WITH_GAPS") {
      warnings.push("Presentation gate is READY_WITH_GAPS. Gaps are allowed but must stay visible.");
    } else if (presentation !== "READY") {
      gaps.push({ code: "PRESENTATION_UNKNOWN", message: `Presentation result ${presentation} is not recognized.` });
    }
  }

  if (input.openDecisions > 0) {
    gaps.push({
      code: "OPEN_DECISIONS",
      message: `Resolve ${input.openDecisions} open decision${input.openDecisions === 1 ? "" : "s"}.`,
    });
  }

  const productionVerified = gaps.length === 0;
  return {
    productionVerified,
    gaps,
    warnings,
    reasons: productionVerified
      ? [
          "A deployment SUCCEEDED with evidence",
          "Expected SHA matches live SHA",
          "Health checks PASSED",
          "Inspector result is PASS or READY and the presentation gate is not NOT_READY",
          "PRODUCTION_VERIFIED means production evidence passed — not that everything is perfect",
        ]
      : gaps.map((gap) => gap.message),
  };
}

export function evaluateReleaseBundle(bundle: ReleaseBundle): {
  readiness: DeploymentReadinessResult;
  production: ProductionVerificationResult;
  gaps: ReleaseGap[];
  latestDeployment: Deployment | null;
} {
  const environment = bundle.environments.find((row) => row.id === bundle.release.environmentId) ?? null;
  const readiness = computeDeploymentReadiness({
    verificationStatus: bundle.verificationStatus,
    sourceCommitSha: bundle.release.sourceCommitSha,
    environment,
    configRequirements: bundle.configRequirements,
    migrations: bundle.migrations,
    deploymentSequence: bundle.release.deploymentSequence,
    rollbackStrategy: bundle.release.rollbackStrategy,
    openDecisions: bundle.openDecisionCount,
    manualActions: bundle.manualActions,
  });
  const production = computeProductionVerification({
    deployments: bundle.deployments,
    healthChecks: bundle.healthChecks,
    openDecisions: bundle.openDecisionCount,
  });
  const latestDeployment =
    [...bundle.deployments].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  return { readiness, production, gaps: readiness.gaps, latestDeployment };
}

export function suggestReleaseNextAction(input: {
  status: ReleaseStatus;
  readiness: DeploymentReadinessResult;
  production: ProductionVerificationResult;
  latestDeployment: Pick<Deployment, "humanId" | "status" | "failureReason"> | null;
}): { title: string; description: string; sourceKind: string } | null {
  const sourceKind = "deployment";

  if (input.latestDeployment?.status === "FAILED" && input.status !== "PRODUCTION_VERIFIED") {
    return {
      title: "Resolve failed deployment",
      description: `${input.latestDeployment.humanId} FAILED${input.latestDeployment.failureReason ? `: ${input.latestDeployment.failureReason.slice(0, 160)}` : ""}. Fix the cause, then start a new attempt.`,
      sourceKind,
    };
  }

  switch (input.status) {
    case "DRAFT":
      return input.readiness.ready
        ? {
            title: "Mark release DEPLOYMENT_READY",
            description: "Readiness gaps are closed. DEPLOYMENT_READY is not deployed.",
            sourceKind,
          }
        : {
            title: "Complete deployment readiness gaps",
            description: input.readiness.gaps[0]?.message ?? "Close readiness gaps before deploying.",
            sourceKind,
          };
    case "DEPLOYMENT_READY":
      return {
        title: "Start deployment",
        description: "Start a deployment attempt, then record evidence and the live SHA. Deployed is not production verified.",
        sourceKind,
      };
    case "DEPLOYING":
      return {
        title: "Finish deployment attempt",
        description: "Record deployment evidence and the live commit SHA, then complete or fail the attempt.",
        sourceKind,
      };
    case "DEPLOYED":
      return {
        title: "Begin production verification",
        description: "Deployment SUCCEEDED. Move to PRODUCTION_VERIFICATION and record health, inspector, and presentation results.",
        sourceKind,
      };
    case "PRODUCTION_VERIFICATION":
      return input.production.productionVerified
        ? {
            title: "Mark release PRODUCTION_VERIFIED",
            description: "Production gaps are closed with evidence.",
            sourceKind,
          }
        : {
            title: "Close production verification gaps",
            description: input.production.gaps[0]?.message ?? "Record production evidence.",
            sourceKind,
          };
    case "PRODUCTION_VERIFIED":
      return null;
    default: {
      const _exhaustive: never = input.status;
      return _exhaustive;
    }
  }
}