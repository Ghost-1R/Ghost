import type {
  DeploymentAttemptInput,
  FacetTruth,
  OperationalState,
  TruthEvidenceRef,
} from "./types";
import { deploymentLineageMatches } from "./types";

function parseTime(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function sortNewestFirst<T extends { createdAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt));
}

/**
 * A FAILED deployment is current only when no later SUCCEEDED attempt exists
 * for the same project. Historical failures remain visible as SUPERSEDED.
 */
export function classifyDeploymentAttemptStatuses(
  attempts: readonly DeploymentAttemptInput[],
): Array<DeploymentAttemptInput & { operationalState: OperationalState; supersededById: string | null }> {
  const byProject = new Map<string, DeploymentAttemptInput[]>();
  for (const attempt of attempts) {
    const list = byProject.get(attempt.projectId) ?? [];
    list.push(attempt);
    byProject.set(attempt.projectId, list);
  }

  const out: Array<
    DeploymentAttemptInput & { operationalState: OperationalState; supersededById: string | null }
  > = [];

  for (const [, projectAttempts] of byProject) {
    const ordered = sortNewestFirst(projectAttempts);

    for (const attempt of ordered) {
      if (attempt.status === "SUCCEEDED") {
        out.push({ ...attempt, operationalState: "DEPLOYED", supersededById: null });
        continue;
      }
      if (attempt.status === "FAILED") {
        const newerSuccess =
          ordered.find(
            (row) =>
              row.status === "SUCCEEDED" &&
              parseTime(row.createdAt) > parseTime(attempt.createdAt) &&
              deploymentLineageMatches(attempt, row),
          ) ?? null;
        out.push({
          ...attempt,
          operationalState: newerSuccess ? "SUPERSEDED" : "FAILED",
          supersededById: newerSuccess?.id ?? null,
        });
        continue;
      }
      if (attempt.status === "IN_PROGRESS" || attempt.status === "QUEUED") {
        out.push({ ...attempt, operationalState: "UNKNOWN", supersededById: null });
        continue;
      }
      out.push({ ...attempt, operationalState: "UNKNOWN", supersededById: null });
    }
  }

  return out;
}

/** True when a FAILED row should still raise a current operational alert. */
export function isCurrentFailedDeployment(
  attempt: DeploymentAttemptInput,
  allAttempts: readonly DeploymentAttemptInput[],
): boolean {
  if (attempt.status !== "FAILED") return false;
  const classified = classifyDeploymentAttemptStatuses(allAttempts).find((row) => row.id === attempt.id);
  return classified?.operationalState === "FAILED";
}

export function reconcileDeploymentFacet(input: {
  projectId: string;
  attempts: readonly DeploymentAttemptInput[];
  releaseStatus?: string | null;
  productionVerified?: boolean | null;
}): FacetTruth {
  const classified = classifyDeploymentAttemptStatuses(
    input.attempts.filter((row) => row.projectId === input.projectId),
  );
  const evidence: TruthEvidenceRef[] = classified.slice(0, 8).map((row) => ({
    source: "deployments",
    at: row.createdAt,
    projectId: row.projectId,
    environment: "PRODUCTION",
    reference: row.humanId?.trim() || row.id,
  }));

  if (input.productionVerified === true || input.releaseStatus === "PRODUCTION_VERIFIED") {
    return {
      facet: "deployment",
      state: "VERIFIED_IN_PRODUCTION",
      summary: "Release is PRODUCTION_VERIFIED with supporting deployment evidence.",
      evidence,
      nextAction: null,
    };
  }

  const latest = sortNewestFirst(classified)[0] ?? null;
  if (!latest) {
    return {
      facet: "deployment",
      state: "UNKNOWN",
      summary: "No deployment attempts are recorded for this project.",
      evidence: [],
      nextAction: "Record a deployment attempt before claiming production status.",
    };
  }

  if (latest.operationalState === "DEPLOYED" || latest.status === "SUCCEEDED") {
    return {
      facet: "deployment",
      state: input.releaseStatus === "DEPLOYED" ? "DEPLOYED" : "DEPLOYED",
      summary: `Latest deployment ${latest.humanId ?? latest.id} succeeded. Production verification is not complete.`,
      evidence,
      nextAction: "Run production verification against the deployed commit.",
    };
  }

  if (latest.operationalState === "FAILED") {
    return {
      facet: "deployment",
      state: "FAILED",
      summary: `Latest deployment ${latest.humanId ?? latest.id} failed${
        latest.failureReason ? `: ${latest.failureReason}` : "."
      }`,
      evidence,
      nextAction: "Inspect the failed attempt, then create a new deployment retry.",
    };
  }

  const currentFailure = classified.find((row) => row.operationalState === "FAILED");
  if (currentFailure) {
    return {
      facet: "deployment",
      state: "FAILED",
      summary: `Deployment ${currentFailure.humanId ?? currentFailure.id} failed and has not been superseded.`,
      evidence,
      nextAction: "Retry deployment after addressing the failure evidence.",
    };
  }

  return {
    facet: "deployment",
    state: "UNKNOWN",
    summary: "Deployment attempts exist, but current status cannot be determined from evidence.",
    evidence,
    nextAction: "Inspect recent deployment rows and release status.",
  };
}

/**
 * Local verification is tree-bound when an inspector result is fresh;
 * otherwise VERIFIED claims without timestamps stay UNKNOWN.
 */
export function reconcileLocalVerificationFacet(input: {
  projectId: string;
  hasFreshInspectorPass: boolean | null;
  legacyVerifiedRecord: boolean | null;
  openBlockingDefects: number;
}): FacetTruth {
  const evidence: TruthEvidenceRef[] = [];
  if (input.hasFreshInspectorPass === true) {
    evidence.push({
      source: "inspector",
      at: null,
      projectId: input.projectId,
      environment: "LOCAL",
      reference: "fresh-inspector-pass",
    });
  }
  if (input.legacyVerifiedRecord === true) {
    evidence.push({
      source: "verification_records",
      at: null,
      projectId: input.projectId,
      environment: "UNKNOWN",
      reference: "legacy-verified",
    });
  }

  if (input.openBlockingDefects > 0) {
    return {
      facet: "verification",
      state: "BLOCKED",
      summary: `${input.openBlockingDefects} open blocking verification defect(s).`,
      evidence,
      nextAction: "Resolve or retest blocking verification defects.",
    };
  }

  if (input.hasFreshInspectorPass === true) {
    return {
      facet: "verification",
      state: "VERIFIED_LOCALLY",
      summary: "Inspector pass is current for the local tree.",
      evidence,
      nextAction: null,
    };
  }

  if (input.hasFreshInspectorPass === false) {
    return {
      facet: "verification",
      state: "UNKNOWN",
      summary: "Inspector evidence is missing or stale for the current tree.",
      evidence,
      nextAction: "Re-run Inspector against the current repository tree.",
    };
  }

  if (input.legacyVerifiedRecord === true) {
    return {
      facet: "verification",
      state: "UNKNOWN",
      summary:
        "A legacy verification record exists, but it is not bound to the current local tree. Treat as unverified locally.",
      evidence,
      nextAction: "Confirm with a fresh Inspector run before claiming local verification.",
    };
  }

  return {
    facet: "verification",
    state: "UNKNOWN",
    summary: "No verified local evidence is available.",
    evidence: [],
    nextAction: "Run verification or Inspector before claiming progress.",
  };
}
