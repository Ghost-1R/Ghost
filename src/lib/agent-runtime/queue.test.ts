import assert from "node:assert/strict";
import test from "node:test";
import { activateQueuedWorker, enqueueAgentTask, leaseQueueItem } from "./queue";
import { applyQueueFailure, clearTaskLeaseForRecovery, planRecoveryFromExpiredLease, recordDurableError } from "./recovery";
import {
  createCheckpointReviewArtifact,
  createPrivatePreview,
  createReviewArtifact,
  publishReviewArtifactPublicly,
} from "./review-artifacts";
import { createBoundAgentTask } from "./workflow";
import { makeAuth, OWNER_ID, PROJECT_ID } from "./test-helpers";

function task() {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "queue",
    environmentLabel: "LOCAL",
  });
  const created = createBoundAgentTask({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    authorization: auth,
    authorizationKind: "DEVELOPMENT",
    actionType: "agent_task.develop",
    actionScope: "queue",
    environmentLabel: "LOCAL",
    idempotencyKey: "queue-task-001",
  });
  if (!created.ok) {
    assert.fail(created.message);
  }
  return created.task;
}

test("enqueue creates PENDING item with execution disabled", () => {
  const enqueued = enqueueAgentTask(task());
  assert.equal(enqueued.ok, true);
  if (!enqueued.ok) return;
  assert.equal(enqueued.executionEnabled, false);
  assert.equal(enqueued.item.status, "PENDING");
  assert.throws(() => activateQueuedWorker(enqueued.item), /WORKER_ACTIVATION_DISABLED/);
});

test("lease, durable error, and recovery from expired lease", () => {
  const t0 = "2026-10-10T12:00:00.000Z";
  const t1 = "2026-10-10T12:00:01.000Z";
  const t2 = "2026-10-10T12:00:02.000Z";
  const t = task();
  const enqueued = enqueueAgentTask(t, { at: t0 });
  assert.equal(enqueued.ok, true);
  if (!enqueued.ok) return;

  const leased = leaseQueueItem(enqueued.item, "worker-1", "tok-1", {
    at: t0,
    ttlMs: 1000,
  });
  assert.equal(leased.ok, true);
  if (!leased.ok) return;
  assert.equal(leased.item.status, "LEASED");
  assert.equal(leased.item.attempts, 1);

  const failed = applyQueueFailure(
    leased.item,
    recordDurableError({
      code: "LEASE_EXPIRED",
      message: "Worker lost lease",
      retryable: true,
      attempt: 1,
      at: t2,
    }),
    { at: t2, backoffMs: 5000 },
  );
  assert.equal(failed.status, "FAILED");
  assert.ok(failed.lastError);

  const claimedTask = {
    ...t,
    status: "RUNNING" as const,
    claimedAt: t0,
    checkpointSequence: 2,
    lastCheckpointId: "cp-1",
  };
  const plan = planRecoveryFromExpiredLease({
    task: claimedTask,
    queueItem: {
      ...leased.item,
      leaseExpiresAt: t1,
    },
    lastCheckpoint: {
      id: "cp-1",
      sequence: 2,
      label: "mid",
      progressRef: "path:a.ts",
      createdAt: "2026-10-10T12:00:00.500Z",
      authorizationId: t.binding.authorizationId,
      scopeFingerprint: t.binding.scopeFingerprint,
    },
    at: t2,
  });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.action, "RESUME_FROM_CHECKPOINT");
    assert.equal(plan.nextQueueStatus, "PENDING");
  }

  const cleared = clearTaskLeaseForRecovery(claimedTask, t2);
  assert.equal(cleared.lease, null);
  assert.equal(cleared.status, "CHECKPOINT");
});

test("dead-letters after max attempts", () => {
  const at = "2026-10-10T12:00:00.000Z";
  const enqueued = enqueueAgentTask(task(), { maxAttempts: 1, at });
  assert.equal(enqueued.ok, true);
  if (!enqueued.ok) return;
  const leased = leaseQueueItem(enqueued.item, "w", "t", { at });
  assert.equal(leased.ok, true);
  if (!leased.ok) return;
  const dead = applyQueueFailure(
    leased.item,
    recordDurableError({
      code: "FATAL",
      message: "boom",
      retryable: true,
      attempt: 1,
    }),
  );
  assert.equal(dead.status, "DEAD_LETTER");
});

test("review artifacts are founder-private; public publish forbidden", () => {
  const t = task();
  const artifact = createReviewArtifact({
    task: t,
    kind: "DIFF_SUMMARY",
    title: "Patch summary",
    contentRef: "diff:src/lib/agent-runtime/queue.ts",
  });
  assert.equal(artifact.ok, true);
  if (!artifact.ok) return;
  assert.equal(artifact.artifact.visibility, "FOUNDER_PRIVATE");
  assert.equal(artifact.artifact.publiclyPublished, false);

  const preview = createPrivatePreview({
    artifact: artifact.artifact,
    ownerId: OWNER_ID,
  });
  assert.equal(preview.ok, true);
  if (preview.ok) {
    assert.equal(preview.preview.publiclyPublished, false);
    assert.ok(preview.preview.accessToken.length === 64);
  }

  const checkpointArt = createCheckpointReviewArtifact(t, {
    id: "cp",
    sequence: 1,
    label: "step",
    progressRef: "path:x.ts",
    createdAt: new Date().toISOString(),
    authorizationId: t.binding.authorizationId,
    scopeFingerprint: t.binding.scopeFingerprint,
  });
  assert.equal(checkpointArt.ok, true);

  assert.throws(() => publishReviewArtifactPublicly(artifact.artifact), /PUBLIC_PREVIEW_FORBIDDEN/);
  assert.equal(
    createReviewArtifact({
      task: t,
      kind: "TEST_LOG",
      title: "log",
      contentRef: "sk-ant-api12345678",
    }).ok,
    false,
  );
});
