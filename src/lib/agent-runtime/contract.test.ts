import assert from "node:assert/strict";
import test from "node:test";
import {
  claimAgentTaskWithRevalidation,
  completeAgentTaskWithRevalidation,
  executeAgentTaskStepWithRevalidation,
} from "./contract";
import { activateAgentWorker, getAgentExecutionGuard } from "./execution-guard";
import { createBoundAgentTask } from "./workflow";
import { makeAuth, OWNER_ID, PROJECT_ID } from "./test-helpers";

function queuedTask(actionType = "agent_task.develop", scope = "module:contract") {
  const auth = makeAuth({
    status: "APPROVED",
    actionType,
    actionScope: scope,
    environmentLabel: "LOCAL",
  });
  const created = createBoundAgentTask({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    authorization: auth,
    authorizationKind: actionType.startsWith("agent_task.deploy") || actionType === "agent_task.release"
      ? "DEPLOYMENT"
      : "DEVELOPMENT",
    actionType,
    actionScope: scope,
    environmentLabel: "LOCAL",
    idempotencyKey: `contract-${actionType}-${scope}`.slice(0, 80),
  });
  if (!created.ok) {
    assert.fail(`expected bound task, got ${created.reason}`);
  }
  return { task: created.task, auth };
}

test("agent execution remains disabled and workers cannot activate", () => {
  const guard = getAgentExecutionGuard();
  assert.equal(guard.enabled, false);
  assert.equal(guard.status, "DISABLED");
  assert.throws(() => activateAgentWorker("task-1"), /AGENT_EXECUTION_DISABLED|disabled/i);
});

test("claim revalidates approval and acquires lease", () => {
  const { task, auth } = queuedTask();
  const claimed = claimAgentTaskWithRevalidation(task, auth, {
    taskId: task.id,
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-1",
    at: new Date().toISOString(),
  });
  assert.equal(claimed.ok, true);
  if (claimed.ok) {
    assert.equal(claimed.task.status, "CLAIMED");
    assert.ok(claimed.task.lease);
    assert.equal(claimed.shouldConsume, true);
    assert.equal(claimed.audit.eventType, "CLAIMED");
    assert.equal(claimed.audit.authorizationId, auth.id);
    assert.equal(claimed.audit.scopeFingerprint, task.binding.scopeFingerprint);
  }

  // Idempotent reclaim with same lease
  if (claimed.ok) {
    const again = claimAgentTaskWithRevalidation(claimed.task, auth, {
      taskId: task.id,
      ownerId: OWNER_ID,
      claimantId: OWNER_ID,
      leaseToken: "lease-1",
      at: new Date().toISOString(),
    });
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.idempotent, true);
      assert.equal(again.shouldConsume, false);
    }
  }
});

test("expired or revoked approval blocks claim and future execution", () => {
  const { task, auth } = queuedTask("agent_task.implement", "module:expire");
  const expired = claimAgentTaskWithRevalidation(
    task,
    {
      ...auth,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      effectiveStatus: "EXPIRED",
    },
    {
      taskId: task.id,
      ownerId: OWNER_ID,
      claimantId: OWNER_ID,
      leaseToken: "lease-exp",
      at: new Date().toISOString(),
    },
  );
  assert.equal(expired.ok, false);
  if (!expired.ok) {
    assert.equal(expired.reason, "EXPIRED");
    assert.equal(expired.task?.status, "BLOCKED");
  }

  const { task: task2, auth: auth2 } = queuedTask("agent_task.refactor", "module:revoke");
  const revoked = claimAgentTaskWithRevalidation(
    task2,
    { ...auth2, status: "REVOKED", effectiveStatus: "REVOKED" },
    {
      taskId: task2.id,
      ownerId: OWNER_ID,
      claimantId: OWNER_ID,
      leaseToken: "lease-rev",
      at: new Date().toISOString(),
    },
  );
  assert.equal(revoked.ok, false);
  if (!revoked.ok) {
    assert.equal(revoked.reason, "REVOKED");
    assert.equal(revoked.task?.status, "BLOCKED");
  }
});

test("scope mismatch fails closed on claim and step", () => {
  const { task, auth } = queuedTask("agent_task.test", "module:scope");
  const mismatched = {
    ...auth,
    actionScope: "module:tampered",
    scopeFingerprint: "a".repeat(64),
  };
  const claim = claimAgentTaskWithRevalidation(task, mismatched, {
    taskId: task.id,
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-scope",
  });
  assert.equal(claim.ok, false);
  if (!claim.ok) {
    assert.ok(claim.reason === "SCOPE_MISMATCH" || claim.reason === "FINGERPRINT_MISMATCH");
    assert.equal(claim.task?.status, "BLOCKED");
  }
});

test("step revalidation checkpoints progress and supports retry idempotency", () => {
  const { task, auth } = queuedTask("agent_task.develop", "module:steps");
  const claimed = claimAgentTaskWithRevalidation(task, auth, {
    taskId: task.id,
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-step",
  });
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;

  const step = executeAgentTaskStepWithRevalidation(claimed.task, auth, {
    taskId: task.id,
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-step",
    stepIdempotencyKey: "step-001",
    stepLabel: "apply-contract",
    progressRef: "path:src/lib/agent-runtime/contract.ts",
  });
  assert.equal(step.ok, true);
  if (step.ok) {
    assert.equal(step.task.status, "CHECKPOINT");
    assert.equal(step.checkpoint?.sequence, 1);
    assert.equal(step.task.lastStepIdempotencyKey, "step-001");
    assert.equal(step.audit.eventType, "STEP_CHECKPOINT");
  }

  if (step.ok) {
    const retry = executeAgentTaskStepWithRevalidation(step.task, auth, {
      taskId: task.id,
      ownerId: OWNER_ID,
      claimantId: OWNER_ID,
      leaseToken: "lease-step",
      stepIdempotencyKey: "step-001",
      stepLabel: "apply-contract",
      progressRef: "path:src/lib/agent-runtime/contract.ts",
    });
    assert.equal(retry.ok, true);
    if (retry.ok) {
      assert.equal(retry.idempotent, true);
      assert.equal(retry.checkpoint, null);
    }
  }
});

test("revocation mid-flight blocks subsequent steps", () => {
  const { task, auth } = queuedTask("agent_task.develop", "module:midflight");
  const claimed = claimAgentTaskWithRevalidation(task, auth, {
    taskId: task.id,
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-mid",
  });
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;

  const blocked = executeAgentTaskStepWithRevalidation(
    claimed.task,
    { ...auth, status: "REVOKED", effectiveStatus: "REVOKED" },
    {
      taskId: task.id,
      ownerId: OWNER_ID,
      claimantId: OWNER_ID,
      leaseToken: "lease-mid",
      stepIdempotencyKey: "step-mid",
      stepLabel: "should-stop",
    },
  );
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.reason, "REVOKED");
    assert.equal(blocked.task?.status, "BLOCKED");
  }
});

test("one-time approval signals consumption on claim", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "module:once",
    environmentLabel: "LOCAL",
    reusePolicy: "ONE_TIME",
    useCount: 0,
  });
  const created = createBoundAgentTask({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    authorization: auth,
    authorizationKind: "DEVELOPMENT",
    actionType: "agent_task.develop",
    actionScope: "module:once",
    environmentLabel: "LOCAL",
    idempotencyKey: "once-claim-001",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const claimed = claimAgentTaskWithRevalidation(created.task, auth, {
    taskId: created.task.id,
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-once",
  });
  assert.equal(claimed.ok, true);
  if (claimed.ok) assert.equal(claimed.shouldConsume, true);

  // After simulated consumption, further claim fails closed.
  const exhausted = claimAgentTaskWithRevalidation(
    created.task,
    { ...auth, useCount: 1, status: "CONSUMED", effectiveStatus: "CONSUMED" },
    {
      taskId: created.task.id,
      ownerId: OWNER_ID,
      claimantId: OWNER_ID,
      leaseToken: "lease-once-2",
    },
  );
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) {
    assert.ok(exhausted.reason === "CONSUMED" || exhausted.reason === "USES_EXHAUSTED");
  }
});

test("development approval does not authorize deployment task", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "env:prod",
    environmentLabel: "LOCAL",
  });
  const created = createBoundAgentTask({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    authorization: auth,
    authorizationKind: "DEPLOYMENT",
    actionType: "agent_task.deploy",
    actionScope: "env:prod",
    environmentLabel: "LOCAL",
    idempotencyKey: "deploy-from-dev-001",
  });
  assert.equal(created.ok, false);
  if (!created.ok) {
    assert.ok(
      created.reason === "DEPLOYMENT_NOT_AUTHORIZED" ||
        created.reason === "DEVELOPMENT_NOT_AUTHORIZED" ||
        created.reason === "KIND_MISMATCH" ||
        created.reason === "SCOPE_MISMATCH" ||
        created.reason === "UNKNOWN_ACTION_TYPE",
    );
  }
});

test("deployment authorization binds and claims independently of development", () => {
  const { task, auth } = queuedTask("agent_task.deploy", "release:staging");
  assert.equal(task.binding.authorizationKind, "DEPLOYMENT");
  const claimed = claimAgentTaskWithRevalidation(task, auth, {
    taskId: task.id,
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-deploy",
  });
  assert.equal(claimed.ok, true);
});

test("invalid lease blocks steps; recovery completes after revalidation", () => {
  const { task, auth } = queuedTask("agent_task.develop", "module:lease");
  const claimed = claimAgentTaskWithRevalidation(task, auth, {
    taskId: task.id,
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-good",
  });
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;

  const badLease = executeAgentTaskStepWithRevalidation(claimed.task, auth, {
    taskId: task.id,
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-bad",
    stepIdempotencyKey: "s1",
    stepLabel: "noop",
  });
  assert.equal(badLease.ok, false);
  if (!badLease.ok) assert.equal(badLease.reason, "LEASE_INVALID");

  const stepped = executeAgentTaskStepWithRevalidation(claimed.task, auth, {
    taskId: task.id,
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-good",
    stepIdempotencyKey: "s1",
    stepLabel: "noop",
    progressRef: "ok",
  });
  assert.equal(stepped.ok, true);
  if (!stepped.ok) return;

  const done = completeAgentTaskWithRevalidation(stepped.task, auth, {
    ownerId: OWNER_ID,
    claimantId: OWNER_ID,
    leaseToken: "lease-good",
  });
  assert.equal(done.ok, true);
  if (done.ok) {
    assert.equal(done.task.status, "SUCCEEDED");
    assert.equal(done.task.lease, null);
  }

  if (done.ok) {
    const again = completeAgentTaskWithRevalidation(done.task, auth, {
      ownerId: OWNER_ID,
      claimantId: OWNER_ID,
      leaseToken: "lease-good",
    });
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.idempotent, true);
  }
});
