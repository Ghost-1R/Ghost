import { isEvidenceIndependentlyVerified } from "./github-evidence";
import { transitionRemoteDevTask } from "./contract";
import type { RemoteDevTask } from "./types";

export type ReviewAction = "SUBMIT_FOR_REVIEW" | "MARK_VERIFIED" | "REJECT" | "CANCEL";

/**
 * Founder review transitions — no automatic deployment permission.
 */
export function applyFounderReviewAction(
  task: RemoteDevTask,
  action: ReviewAction,
  options: { ownerId: string; at?: string },
): { ok: true; task: RemoteDevTask } | { ok: false; reason: string; message: string } {
  if (task.ownerId !== options.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: "Only the owning founder can review this task." };
  }
  if (task.deploymentAuthorized !== false) {
    return {
      ok: false,
      reason: "DEPLOYMENT_FLAG_CORRUPT",
      message: "Deployment authorization must remain false on development tasks.",
    };
  }

  if (action === "CANCEL") {
    const next = transitionRemoteDevTask(task, "CANCELLED", options);
    return next.ok
      ? { ok: true, task: next.task }
      : { ok: false, reason: "ILLEGAL_TRANSITION", message: next.reason };
  }

  if (action === "SUBMIT_FOR_REVIEW") {
    if (task.status !== "RUNNING" && task.status !== "AWAITING_FOUNDER_REVIEW") {
      return {
        ok: false,
        reason: "INVALID_STATUS",
        message: "Only running work can be submitted for founder review.",
      };
    }
    const next = transitionRemoteDevTask(task, "AWAITING_FOUNDER_REVIEW", options);
    return next.ok
      ? { ok: true, task: next.task }
      : { ok: false, reason: "ILLEGAL_TRANSITION", message: next.reason };
  }

  if (action === "REJECT") {
    if (task.status !== "AWAITING_FOUNDER_REVIEW") {
      return {
        ok: false,
        reason: "INVALID_STATUS",
        message: "Reject requires AWAITING_FOUNDER_REVIEW.",
      };
    }
    const rejected = transitionRemoteDevTask(task, "FAILED", options);
    return rejected.ok
      ? { ok: true, task: rejected.task }
      : { ok: false, reason: "ILLEGAL_TRANSITION", message: rejected.reason };
  }

  if (action === "MARK_VERIFIED") {
    if (task.status !== "AWAITING_FOUNDER_REVIEW") {
      return {
        ok: false,
        reason: "INVALID_STATUS",
        message: "Verification requires AWAITING_FOUNDER_REVIEW.",
      };
    }
    if (task.requiresIndependentReview && !isEvidenceIndependentlyVerified(task.evidence)) {
      return {
        ok: false,
        reason: "EVIDENCE_UNVERIFIED",
        message: "Independent evidence verification is required before marking VERIFIED.",
      };
    }
    const next = transitionRemoteDevTask(task, "VERIFIED", options);
    return next.ok
      ? { ok: true, task: next.task }
      : { ok: false, reason: "ILLEGAL_TRANSITION", message: next.reason };
  }

  return { ok: false, reason: "UNKNOWN_ACTION", message: "Unknown review action." };
}

export type FounderReviewCard = {
  taskId: string;
  projectId: string;
  projectName: string;
  objective: string;
  status: RemoteDevTask["status"];
  authorizationId: string;
  repository: string;
  baseBranch: string;
  evidenceState: string;
  commitSha: string | null;
  pullRequestRef: string | null;
  destinationHref: string;
  deploymentAuthorized: false;
};

/** Present only real persisted task fields — never invent metrics. */
export function toFounderReviewCard(task: RemoteDevTask): FounderReviewCard {
  return {
    taskId: task.id,
    projectId: task.projectId,
    projectName: task.projectName,
    objective: task.objective,
    status: task.status,
    authorizationId: task.binding.authorizationId,
    repository: task.git.repository,
    baseBranch: task.git.approvedBaseBranch,
    evidenceState: task.evidence?.verificationState ?? "NONE",
    commitSha: task.evidence?.commitSha ?? null,
    pullRequestRef: task.evidence?.pullRequestRef ?? null,
    destinationHref: `/projects/${task.projectId}`,
    deploymentAuthorized: false,
  };
}
