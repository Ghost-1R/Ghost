import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionAgentTask,
  createBoundAgentTask,
  createLease,
  decideAgentTaskTransition,
  isLeaseValid,
  isTerminalAgentTaskStatus,
  LEGAL_AGENT_TASK_TRANSITIONS,
  rejectSecretProgressRef,
} from "./workflow";
import { makeAuth, OWNER_ID, PROJECT_ID } from "./test-helpers";

test("legal transitions cover claim step checkpoint complete and block paths", () => {
  assert.ok(canTransitionAgentTask("QUEUED", "CLAIMED"));
  assert.ok(canTransitionAgentTask("CLAIMED", "RUNNING"));
  assert.ok(canTransitionAgentTask("RUNNING", "CHECKPOINT"));
  assert.ok(canTransitionAgentTask("CHECKPOINT", "RUNNING"));
  assert.ok(canTransitionAgentTask("RUNNING", "SUCCEEDED"));
  assert.ok(canTransitionAgentTask("QUEUED", "BLOCKED"));
  assert.equal(canTransitionAgentTask("SUCCEEDED", "RUNNING"), false);
  assert.equal(canTransitionAgentTask("FAILED", "QUEUED"), false);
  assert.ok(isTerminalAgentTaskStatus("SUCCEEDED"));
  assert.ok(LEGAL_AGENT_TASK_TRANSITIONS.BLOCKED.includes("QUEUED"));
});

test("idempotent transition when already at target status", () => {
  const decision = decideAgentTaskTransition(
    { status: "CLAIMED", ownerId: OWNER_ID },
    { ownerId: OWNER_ID, toStatus: "CLAIMED" },
  );
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.idempotent, true);
    assert.equal(decision.eventType, "TRANSITION_IDEMPOTENT");
  }
});

test("illegal transition and owner mismatch fail", () => {
  const illegal = decideAgentTaskTransition(
    { status: "QUEUED", ownerId: OWNER_ID },
    { ownerId: OWNER_ID, toStatus: "SUCCEEDED" },
  );
  assert.equal(illegal.ok, false);

  const owner = decideAgentTaskTransition(
    { status: "QUEUED", ownerId: OWNER_ID },
    { ownerId: "99999999-9999-9999-9999-999999999999", toStatus: "CLAIMED" },
  );
  assert.equal(owner.ok, false);
});

test("lease validity enforces holder token and expiry", () => {
  const at = "2026-10-10T12:00:00.000Z";
  const lease = createLease({
    holderId: "worker-1",
    token: "lease-token-abc",
    at,
    ttlMs: 60_000,
  });
  assert.equal(
    isLeaseValid(lease, { holderId: "worker-1", token: "lease-token-abc", at: "2026-10-10T12:00:30.000Z" }),
    true,
  );
  assert.equal(
    isLeaseValid(lease, { holderId: "worker-2", token: "lease-token-abc", at: "2026-10-10T12:00:30.000Z" }),
    false,
  );
  assert.equal(
    isLeaseValid(lease, { holderId: "worker-1", token: "wrong", at: "2026-10-10T12:00:30.000Z" }),
    false,
  );
  assert.equal(
    isLeaseValid(lease, { holderId: "worker-1", token: "lease-token-abc", at: "2026-10-10T12:02:00.000Z" }),
    false,
  );
});

test("createBoundAgentTask requires approved matching authorization", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.implement",
    actionScope: "pkg:agent-runtime",
    environmentLabel: "LOCAL",
  });
  const created = createBoundAgentTask({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    authorization: auth,
    authorizationKind: "DEVELOPMENT",
    actionType: "agent_task.implement",
    actionScope: "pkg:agent-runtime",
    environmentLabel: "LOCAL",
    idempotencyKey: "create-task-001",
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.task.status, "QUEUED");
    assert.equal(created.task.binding.authorizationKind, "DEVELOPMENT");
    assert.equal(created.task.lease, null);
  }

  const pending = createBoundAgentTask({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    authorization: { ...auth, status: "PENDING", effectiveStatus: "PENDING" },
    authorizationKind: "DEVELOPMENT",
    actionType: "agent_task.implement",
    actionScope: "pkg:agent-runtime",
    environmentLabel: "LOCAL",
    idempotencyKey: "create-task-002",
  });
  assert.equal(pending.ok, false);
});

test("progress refs reject credential-like values", () => {
  assert.equal(rejectSecretProgressRef("commit:abc123").ok, true);
  assert.equal(rejectSecretProgressRef("sk-ant-api12345678").ok, false);
  assert.equal(rejectSecretProgressRef("Bearer eyJhbGciOi").ok, false);
});
