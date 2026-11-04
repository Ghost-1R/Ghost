/**
 * Regression: maxDurationMs is execution runtime, not wall-clock since request creation.
 * Waiting for founder approval must not block queue.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  elapsedMsSinceExecutionStart,
  elapsedMsSinceTaskCreated,
  gateRemoteDevQueue,
  gateRemoteDevStep,
} from "./authorization-gate";
import {
  approveDevelopmentRequest,
  createDevelopmentRequest,
  queueDevelopmentTask,
  revokeDevelopmentAuthorization,
} from "./workflow";
import { resetRemoteDevMemoryStore } from "./memory-store";

const OWNER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

function baseRequest(partial: Record<string, unknown> = {}) {
  return {
    ownerId: OWNER,
    projectId: PROJECT,
    projectName: "Duration gate fixture",
    objective: "Exercise duration gate semantics",
    repository: "Ghost-1R/Ghost",
    approvedBaseBranch: "cursor/pilot-03-real-ai-coding-prep",
    environmentLabel: "LOCAL_PILOT_03",
    maxEstimatedCostUsd: 1,
    maxDurationMs: 3_600_000,
    requirements: "PUBLIC fixture",
    evidenceSource: "duration-gate-test",
    evidenceReference: randomUUID(),
    idempotencyKey: `duration-gate-${randomUUID()}`,
    ...partial,
  };
}

test("delayed founder approval: create age > maxDuration still allows queue", () => {
  resetRemoteDevMemoryStore();
  const createdAt = new Date(Date.now() - 2 * 3_600_000).toISOString(); // 2h ago
  const created = createDevelopmentRequest(
    baseRequest({
      maxDurationMs: 3_600_000, // 1h execution ceiling
      at: createdAt,
    }),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const age = elapsedMsSinceTaskCreated(created.session.task, new Date().toISOString());
  assert.ok(age > created.session.task.duration.maxDurationMs, "fixture must be older than maxDuration");

  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  // Pre-queue: execution runtime has not started.
  assert.equal(elapsedMsSinceExecutionStart(approved.session.task), 0);

  const queued = queueDevelopmentTask(approved.session);
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  assert.equal(queued.session.authorization.status, "CONSUMED");
  assert.equal(queued.session.task.status, "QUEUED");
  assert.ok(queued.session.task.queuedAt);
});

test("expired authorization still fails closed at queue", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(baseRequest());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const expiredAuth = {
    ...approved.session.authorization,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  };
  const denied = gateRemoteDevQueue(expiredAuth, approved.session.task, {
    at: new Date().toISOString(),
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.match(denied.reason, /EXPIRED|NOT_APPROVED|Authorization/i);
  }
});

test("one-hour execution duration enforced after queue/claim", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(baseRequest({ maxDurationMs: 3_600_000 }));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const queued = queueDevelopmentTask(approved.session);
  assert.equal(queued.ok, true);
  if (!queued.ok) return;

  const within = gateRemoteDevStep(queued.session.authorization, queued.session.task, {
    authorizationConsumed: true,
    elapsedMs: 3_599_999,
  });
  assert.equal(within.ok, true);

  const over = gateRemoteDevStep(queued.session.authorization, queued.session.task, {
    authorizationConsumed: true,
    elapsedMs: 3_600_001,
  });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.reason, "DURATION_EXCEEDED");

  // Clock-based: 1h after queuedAt exceeds ceiling.
  const afterHour = new Date(Date.parse(queued.session.task.queuedAt!) + 3_600_001).toISOString();
  const clockOver = elapsedMsSinceExecutionStart(queued.session.task, afterHour);
  assert.ok(clockOver > queued.session.task.duration.maxDurationMs);
  const stepClock = gateRemoteDevStep(queued.session.authorization, queued.session.task, {
    authorizationConsumed: true,
    at: afterHour,
    elapsedMs: clockOver,
  });
  assert.equal(stepClock.ok, false);
  if (!stepClock.ok) assert.equal(stepClock.reason, "DURATION_EXCEEDED");
});

test("restart/recovery uses execution start not creation age", () => {
  resetRemoteDevMemoryStore();
  const createdAt = new Date(Date.now() - 5 * 3_600_000).toISOString();
  const created = createDevelopmentRequest(
    baseRequest({
      maxDurationMs: 3_600_000,
      at: createdAt,
    }),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const queued = queueDevelopmentTask(approved.session);
  assert.equal(queued.ok, true);
  if (!queued.ok) return;

  const createAge = elapsedMsSinceTaskCreated(queued.session.task);
  const execAge = elapsedMsSinceExecutionStart(queued.session.task);
  assert.ok(createAge > 3_600_000);
  assert.ok(execAge < 60_000, "freshly queued task must have tiny execution age");

  const recovery = gateRemoteDevStep(queued.session.authorization, queued.session.task, {
    authorizationConsumed: true,
    elapsedMs: execAge,
  });
  assert.equal(recovery.ok, true);
});

test("duplicate queue attempt fails closed after first consume", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(baseRequest());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const first = queueDevelopmentTask(approved.session);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = queueDevelopmentTask({
    ...approved.session,
    authorization: first.session.authorization,
    task: {
      ...approved.session.task,
      // Force AWAITING_APPROVAL-shaped retry against CONSUMED auth
      status: "AWAITING_APPROVAL",
      queuedAt: null,
    },
  });
  assert.equal(second.ok, false);
});

test("revoked authorization cannot queue even when duration would allow", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(
    baseRequest({
      at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      maxDurationMs: 3_600_000,
    }),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const revoked = revokeDevelopmentAuthorization(approved.session, OWNER, "withdraw");
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;
  const denied = queueDevelopmentTask(revoked.session);
  assert.equal(denied.ok, false);
});
