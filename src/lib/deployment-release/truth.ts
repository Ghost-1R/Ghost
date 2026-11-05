import type { VerificationProgramStatus } from "@/lib/verification/types";
import type {
  Deployment,
  DeploymentHealthCheck,
  Release,
  ReleaseMigration,
  ReleaseRollback,
  ReleaseStatus,
} from "./types";
import { latestSucceededDeployment, shasMatch } from "./workflow";

export type DeploymentTruthAnswer = {
  answer: "YES" | "NO" | "UNKNOWN";
  reason: string;
  kind:
    | "RECORDED_FACT"
    | "DEPLOYMENT_EVIDENCE"
    | "NOT_DEPLOYED"
    | "NOT_PRODUCTION_VERIFIED"
    | "ASSUMPTION"
    | "MODEL_SUGGESTION"
    | "UNKNOWN";
};

const BOUNDARY =
  "VERIFIED ≠ DEPLOYED ≠ PRODUCTION_VERIFIED. Only recorded release, deployment, and evidence rows count.";

const DEPLOYED_STATUSES: readonly ReleaseStatus[] = ["DEPLOYED", "PRODUCTION_VERIFICATION", "PRODUCTION_VERIFIED"];

export function isReleaseDeployed(status: ReleaseStatus | null): DeploymentTruthAnswer {
  if (!status) {
    return {
      answer: "NO",
      reason: `No release is recorded, so nothing is recorded as deployed. ${BOUNDARY}`,
      kind: "NOT_DEPLOYED",
    };
  }
  if (DEPLOYED_STATUSES.includes(status)) {
    return {
      answer: "YES",
      reason: `Release status is ${status}, so a deployment is recorded as SUCCEEDED. Deployed is not production verified. ${BOUNDARY}`,
      kind: "DEPLOYMENT_EVIDENCE",
    };
  }
  return {
    answer: "NO",
    reason: `Release status is ${status}, not DEPLOYED. ${BOUNDARY}`,
    kind: "NOT_DEPLOYED",
  };
}

export function isProductionVerified(status: ReleaseStatus | null): DeploymentTruthAnswer {
  if (!status) {
    return {
      answer: "NO",
      reason: `No release is recorded, so nothing is production verified. ${BOUNDARY}`,
      kind: "NOT_PRODUCTION_VERIFIED",
    };
  }
  if (status === "PRODUCTION_VERIFIED") {
    return {
      answer: "YES",
      reason: `Release status is PRODUCTION_VERIFIED: production evidence passed. ${BOUNDARY}`,
      kind: "DEPLOYMENT_EVIDENCE",
    };
  }
  return {
    answer: "NO",
    reason: `Release status is ${status}, not PRODUCTION_VERIFIED.${status === "DEPLOYED" ? " Deployed is not production verified." : ""} ${BOUNDARY}`,
    kind: "NOT_PRODUCTION_VERIFIED",
  };
}

export function isVerifiedButNotDeployed(
  verificationStatus: VerificationProgramStatus | null,
  releaseStatus: ReleaseStatus | null,
): DeploymentTruthAnswer {
  if (verificationStatus !== "VERIFIED") {
    return {
      answer: "NO",
      reason: `Verification is ${verificationStatus ?? "missing"}, not VERIFIED.`,
      kind: "RECORDED_FACT",
    };
  }
  if (releaseStatus && DEPLOYED_STATUSES.includes(releaseStatus)) {
    return {
      answer: "NO",
      reason: `Verification is VERIFIED and the release is ${releaseStatus}. ${BOUNDARY}`,
      kind: "DEPLOYMENT_EVIDENCE",
    };
  }
  return {
    answer: "YES",
    reason: `Verification is VERIFIED but the release is ${releaseStatus ?? "not recorded"}, so it is not deployed. ${BOUNDARY}`,
    kind: "NOT_DEPLOYED",
  };
}

export function doesVerifiedMeanDeployed(): DeploymentTruthAnswer {
  return {
    answer: "NO",
    reason: `VERIFIED never means deployed. ${BOUNDARY}`,
    kind: "NOT_DEPLOYED",
  };
}

export function doesDeployedMeanProductionVerified(): DeploymentTruthAnswer {
  return {
    answer: "NO",
    reason: `DEPLOYED never means production verified. ${BOUNDARY}`,
    kind: "NOT_PRODUCTION_VERIFIED",
  };
}

export type DeploymentTruthInput = {
  release: Pick<Release, "status" | "humanId" | "sourceCommitSha" | "rollbackStrategy"> | null;
  verificationStatus?: VerificationProgramStatus | null;
  deployments?: Array<
    Pick<
      Deployment,
      "id" | "humanId" | "status" | "expectedCommitSha" | "liveCommitSha" | "failureReason" | "createdAt"
    >
  >;
  migrations?: Array<Pick<ReleaseMigration, "migrationPath" | "isRequired" | "status">>;
  healthChecks?: Array<Pick<DeploymentHealthCheck, "deploymentId" | "checkName" | "status">>;
  rollbacks?: Array<Pick<ReleaseRollback, "status" | "targetCommitSha" | "reason">>;
  readinessGaps?: string[];
  productionGaps?: string[];
};

export function answerDeploymentTruthQuestion(
  question: string,
  input: DeploymentTruthInput,
): DeploymentTruthAnswer | null {
  const q = question.toLowerCase();
  const release = input.release;
  const status = release?.status ?? null;
  const deployments = input.deployments ?? [];
  const migrations = input.migrations ?? [];
  const healthChecks = input.healthChecks ?? [];
  const rollbacks = input.rollbacks ?? [];

  if (/past (answer|response)|previous ghost|ghost said/.test(q)) {
    return {
      answer: "NO",
      reason: "A past Ghost answer is not authoritative evidence. Use release and deployment records.",
      kind: "MODEL_SUGGESTION",
    };
  }

  if (/verified.*(mean|imply|equal).*(deploy|live|production)|(mean|imply).*verified.*(deploy|live)/.test(q)) {
    return doesVerifiedMeanDeployed();
  }
  if (/deployed.*(mean|imply|equal).*(production.verified|verified in production)/.test(q)) {
    return doesDeployedMeanProductionVerified();
  }

  if (/(verified but|verified.*not deployed|verified.*yet to deploy)/.test(q)) {
    return isVerifiedButNotDeployed(input.verificationStatus ?? null, status);
  }

  if (/what.*(block|gap|missing|left)|block(ing|ers?)|why (not|isn't|isnt|aren't|arent|hasn't|hasnt).*(deploy|live|ready|released|production|verified)/.test(q)) {
    if (!release) {
      return {
        answer: "UNKNOWN",
        reason: `No release is recorded, so no deployment blockers can be listed. Initialize a release from a VERIFIED program. ${BOUNDARY}`,
        kind: "UNKNOWN",
      };
    }
    if (status === "PRODUCTION_VERIFIED") {
      return {
        answer: "NO",
        reason: "Release is PRODUCTION_VERIFIED. Recorded gaps are closed.",
        kind: "DEPLOYMENT_EVIDENCE",
      };
    }
    const gaps =
      status === "DEPLOYED" || status === "PRODUCTION_VERIFICATION" ? input.productionGaps ?? [] : input.readinessGaps ?? [];
    if (gaps.length === 0) {
      return {
        answer: "NO",
        reason: `No recorded gaps for the current stage (${status}). That is not production verification. ${BOUNDARY}`,
        kind: "RECORDED_FACT",
      };
    }
    return {
      answer: "YES",
      reason: `Release ${release.humanId} is ${status}. Gaps: ${gaps.slice(0, 6).join("; ")}.`,
      kind: "RECORDED_FACT",
    };
  }

  if (/roll ?back/.test(q)) {
    const completed = rollbacks.find((row) => row.status === "COMPLETED");
    if (completed) {
      return {
        answer: "YES",
        reason: `A rollback is recorded as COMPLETED${completed.targetCommitSha ? ` to ${completed.targetCommitSha}` : ""}.`,
        kind: "RECORDED_FACT",
      };
    }
    const active = rollbacks.find((row) => row.status === "REQUESTED" || row.status === "IN_PROGRESS");
    if (active) {
      return {
        answer: "YES",
        reason: `A rollback is ${active.status}${active.reason ? `: ${active.reason.slice(0, 120)}` : ""}.`,
        kind: "RECORDED_FACT",
      };
    }
    const available = rollbacks.find((row) => row.status === "AVAILABLE");
    if (available) {
      return {
        answer: "YES",
        reason: `A rollback target is recorded as AVAILABLE${available.targetCommitSha ? ` (${available.targetCommitSha})` : ""}. Availability is a record, not a performed rollback.`,
        kind: "RECORDED_FACT",
      };
    }
    return {
      answer: "UNKNOWN",
      reason: release?.rollbackStrategy
        ? "A rollback strategy is recorded, but no available rollback target is recorded."
        : "No rollback strategy or available target is recorded.",
      kind: "UNKNOWN",
    };
  }

  if (/(last|latest|previous|recent) deploy(ment)?|deployment history|deployment attempts?/.test(q)) {
    const latest = [...deployments].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!latest) {
      return { answer: "NO", reason: "No deployment attempt is recorded.", kind: "NOT_DEPLOYED" };
    }
    return {
      answer: "YES",
      reason: `${latest.humanId} is ${latest.status}${latest.failureReason ? ` (${latest.failureReason.slice(0, 120)})` : ""}. Recorded attempts: ${deployments.length}.`,
      kind: "RECORDED_FACT",
    };
  }

  if (/(what|which).*(version|commit|sha|build).*(live|running|deployed|production|prod)|(live|production|deployed) (sha|commit|version)|what('s| is) live/.test(q)) {
    if (!release || !DEPLOYED_STATUSES.includes(release.status)) {
      return {
        answer: "NO",
        reason: `Nothing is recorded as live.${release?.sourceCommitSha ? ` The release targets ${release.sourceCommitSha}, which is not a live claim.` : ""} ${BOUNDARY}`,
        kind: "NOT_DEPLOYED",
      };
    }
    const deployment = latestSucceededDeployment(deployments);
    if (!deployment || !deployment.liveCommitSha.trim()) {
      return {
        answer: "UNKNOWN",
        reason: "The release is deployed but no live commit SHA is recorded. Ghost will not guess it.",
        kind: "UNKNOWN",
      };
    }
    const match = shasMatch(deployment.expectedCommitSha, deployment.liveCommitSha);
    return {
      answer: "YES",
      reason: `Recorded live SHA ${deployment.liveCommitSha} (${deployment.humanId}); expected ${deployment.expectedCommitSha || "not recorded"}: ${match ? "match" : "NOT matching or unverified"}.`,
      kind: "DEPLOYMENT_EVIDENCE",
    };
  }

  if (/migration/.test(q)) {
    if (migrations.length === 0) {
      return {
        answer: "UNKNOWN",
        reason: "No release migrations are recorded. Committed migrations are not applied migrations.",
        kind: "UNKNOWN",
      };
    }
    const pending = migrations.filter((row) => row.isRequired && row.status !== "APPLIED" && row.status !== "NOT_REQUIRED");
    if (pending.length === 0) {
      return {
        answer: "YES",
        reason: `All ${migrations.length} recorded required migration${migrations.length === 1 ? " is" : "s are"} APPLIED or NOT_REQUIRED.`,
        kind: "RECORDED_FACT",
      };
    }
    return {
      answer: "NO",
      reason: `Not applied: ${pending.slice(0, 5).map((row) => `${row.migrationPath} (${row.status})`).join("; ")}. Committed is not applied.`,
      kind: "RECORDED_FACT",
    };
  }

  if (/healthy|health( check)?s?\b|is (prod|production) (up|ok|working)/.test(q)) {
    const deployment = latestSucceededDeployment(deployments);
    if (!deployment) {
      return {
        answer: "UNKNOWN",
        reason: "No SUCCEEDED deployment is recorded, so no production health is recorded.",
        kind: "UNKNOWN",
      };
    }
    const checks = healthChecks.filter((row) => row.deploymentId === deployment.id && row.status !== "SKIPPED");
    if (checks.length === 0) {
      return { answer: "UNKNOWN", reason: "No health check is recorded for the latest SUCCEEDED deployment.", kind: "UNKNOWN" };
    }
    const failing = checks.filter((row) => row.status !== "PASSED");
    if (failing.length === 0) {
      return {
        answer: "YES",
        reason: `${checks.length} recorded health check${checks.length === 1 ? "" : "s"} PASSED for ${deployment.humanId}. That is recorded evidence, not a live probe now.`,
        kind: "DEPLOYMENT_EVIDENCE",
      };
    }
    return {
      answer: "NO",
      reason: `Health not confirmed: ${failing.slice(0, 5).map((row) => `${row.checkName} (${row.status})`).join("; ")}.`,
      kind: "RECORDED_FACT",
    };
  }

  if (
    /production.verified|verified in (production|prod)|prod(uction)? verification|has production been verified|is production verified/.test(
      q,
    )
  ) {
    return isProductionVerified(status);
  }

  if (/\b(deployed|live|released|shipped|launched)\b|in production/.test(q)) {
    return isReleaseDeployed(status);
  }

  return null;
}
