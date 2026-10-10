import assert from "node:assert/strict";
import test from "node:test";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import { createRemoteDevTask, transitionRemoteDevTask } from "./contract";
import {
  buildGitHubEvidence,
  independentlyVerifyEvidence,
} from "./github-evidence";
import { applyFounderReviewAction, toFounderReviewCard } from "./review";

const OWNER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";
const OTHER = "99999999-9999-9999-9999-999999999999";

function reviewReadyTask() {
  const actionType = "agent_task.develop";
  const actionScope = "module:review";
  const environmentLabel = "REMOTE_DEV";
  const created = createRemoteDevTask({
    ownerId: OWNER,
    projectId: PROJECT,
    projectName: "Ghost",
    objective: "Prepare founder review with independently verified evidence.",
    authorizationId: "33333333-3333-3333-3333-333333333333",
    authorizationKind: "DEVELOPMENT",
    actionType,
    actionScope,
    environmentLabel,
    scopeFingerprint: scopeFingerprint({
      projectId: PROJECT,
      actionType,
      actionScope,
      environmentLabel,
    }),
    repository: "Ghost-1R/Ghost",
    approvedBaseBranch: "ghost-operations-09",
    idempotencyKey: "review-test-001",
  });
  if (!created.ok) throw new Error(created.reason);
  let task = created.task;
  for (const status of ["QUEUED", "RUNNING", "AWAITING_FOUNDER_REVIEW"] as const) {
    const next = transitionRemoteDevTask(task, status, { ownerId: OWNER });
    if (!next.ok) throw new Error(next.reason);
    task = next.task;
  }
  return task;
}

test("cross-project/owner isolation on review actions", () => {
  const task = reviewReadyTask();
  const denied = applyFounderReviewAction(task, "MARK_VERIFIED", { ownerId: OTHER });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "OWNER_MISMATCH");
});

test("evidence integrity required before VERIFIED; deployment stays false", () => {
  let task = reviewReadyTask();
  const premature = applyFounderReviewAction(task, "MARK_VERIFIED", { ownerId: OWNER });
  assert.equal(premature.ok, false);

  const built = buildGitHubEvidence({
    task,
    commitSha: "b54eeb46e260c8566a292927e619f91f9b0f1028",
    pullRequestRef: "#1",
    artifactHashes: ["a".repeat(64)],
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.evidence.verificationState, "UNVERIFIED");

  task = {
    ...task,
    evidence: independentlyVerifyEvidence(built.evidence),
  };
  const verified = applyFounderReviewAction(task, "MARK_VERIFIED", { ownerId: OWNER });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.task.status, "VERIFIED");
  assert.equal(verified.task.deploymentAuthorized, false);

  const card = toFounderReviewCard(verified.task);
  assert.equal(card.deploymentAuthorized, false);
  assert.equal(card.evidenceState, "VERIFIED");
  assert.ok(!/%|velocity/i.test(card.objective));
});

test("rejects secret-bearing evidence and invalid SHAs", () => {
  const task = reviewReadyTask();
  assert.equal(
    buildGitHubEvidence({ task, commitSha: "not-a-sha" }).ok,
    false,
  );
  assert.equal(
    buildGitHubEvidence({
      task,
      commitSha: "abc1234",
      testResultsRef: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    }).ok,
    false,
  );
});
