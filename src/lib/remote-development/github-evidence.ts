import type { EvidenceVerificationState, GitHubEvidence, RemoteDevTask } from "./types";

export type EvidenceDenial =
  | "MISSING_REPOSITORY"
  | "INVALID_SHA"
  | "INVALID_PR_REF"
  | "SECRET_IN_EVIDENCE"
  | "PROVIDER_CLAIM_UNVERIFIED";

const SHA = /^[0-9a-f]{7,40}$/i;
const SECRETISH = /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_)/i;

/**
 * Build a read-only GitHub evidence record.
 * External provider claims start as UNVERIFIED until independently checked.
 */
export function buildGitHubEvidence(input: {
  task: Pick<RemoteDevTask, "git">;
  commitSha?: string | null;
  pullRequestRef?: string | null;
  testResultsRef?: string | null;
  artifactHashes?: string[];
  providerClaimedAt?: string | null;
}): { ok: true; evidence: GitHubEvidence } | { ok: false; reason: EvidenceDenial; message: string } {
  const repository = input.task.git.repository.trim();
  if (!repository || !repository.includes("/")) {
    return { ok: false, reason: "MISSING_REPOSITORY", message: "Repository is required." };
  }

  const commitSha = input.commitSha?.trim() || null;
  if (commitSha && !SHA.test(commitSha)) {
    return { ok: false, reason: "INVALID_SHA", message: "Commit SHA format is invalid." };
  }

  const pullRequestRef = input.pullRequestRef?.trim() || null;
  if (pullRequestRef && !/^#?\d+$/.test(pullRequestRef) && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(pullRequestRef)) {
    return { ok: false, reason: "INVALID_PR_REF", message: "Pull request reference is invalid." };
  }

  const blob = [
    repository,
    commitSha ?? "",
    pullRequestRef ?? "",
    input.testResultsRef ?? "",
    ...(input.artifactHashes ?? []),
  ].join("|");
  if (SECRETISH.test(blob)) {
    return { ok: false, reason: "SECRET_IN_EVIDENCE", message: "Evidence must not contain credentials." };
  }

  const hashes = (input.artifactHashes ?? [])
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[0-9a-f]{64}$/.test(h));

  return {
    ok: true,
    evidence: {
      repository,
      baseCommitSha: input.task.git.baseCommitSha,
      taskBranch: input.task.git.taskBranch,
      commitSha,
      pullRequestRef,
      testResultsRef: input.testResultsRef?.trim() || null,
      artifactHashes: hashes,
      verificationState: "UNVERIFIED",
      providerClaimedAt: input.providerClaimedAt ?? new Date().toISOString(),
      independentlyCheckedAt: null,
    },
  };
}

/**
 * Mark evidence independently verified — never auto-merge or deploy.
 */
export function independentlyVerifyEvidence(
  evidence: GitHubEvidence,
  options?: { at?: string; accept?: boolean },
): GitHubEvidence {
  const accept = options?.accept !== false;
  const state: EvidenceVerificationState = accept ? "VERIFIED" : "REJECTED";
  return {
    ...evidence,
    verificationState: state,
    independentlyCheckedAt: options?.at ?? new Date().toISOString(),
  };
}

/** Provider success claims remain UNVERIFIED until this returns true. */
export function isEvidenceIndependentlyVerified(evidence: GitHubEvidence | null): boolean {
  return evidence?.verificationState === "VERIFIED" && Boolean(evidence.independentlyCheckedAt);
}
