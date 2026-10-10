import assert from "node:assert/strict";
import test from "node:test";
import { simulateConcurrentOneTimeConsumption } from "@/lib/agent-runtime/consume";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import { OWNER_ID, PROJECT_ID } from "@/lib/agent-runtime/test-helpers";
import {
  elapsedMsSinceTaskCreated,
  gateRemoteDevQueue,
  gateRemoteDevStep,
} from "./authorization-gate";
import { createRemoteDevTask, transitionRemoteDevTask } from "./contract";
import { FakeRemoteExecutionProvider } from "./fake-provider";
import {
  memoryConsumeAuthorizationCas,
  memoryIsExecutionHalted,
  resetRemoteDevMemoryStore,
} from "./memory-store";
import { reconcileRemoteStatus } from "./reconcile";
import {
  approveDevelopmentRequest,
  createDevelopmentRequest,
  queueDevelopmentTask,
  reviewSimulatedOutcome,
  revokeDevelopmentAuthorization,
  runSimulatedExecution,
  verifySimulatedEvidence,
} from "./workflow";

const OWNER = OWNER_ID;
const PROJECT = PROJECT_ID;

function baseRequest(partial: Partial<Parameters<typeof createDevelopmentRequest>[0]> = {}) {
  return {
    ownerId: OWNER,
    projectId: PROJECT,
    projectName: "Ghost",
    objective: "Security regression coverage for Build 09.12 review fixes.",
    repository: "Ghost-1R/Ghost",
    approvedBaseBranch: "cursor/e2e-development-workflow-09-11-772f",
    environmentLabel: "REMOTE_DEV",
    maxEstimatedCostUsd: 5,
    maxDurationMs: 3_600_000,
    idempotencyKey: `sec-${Math.random().toString(16).slice(2)}`,
    ...partial,
  };
}

function awaitingApprovalTask() {
  const actionType = "agent_task.develop";
  const actionScope = "module:security-regression";
  const environmentLabel = "REMOTE_DEV";
  const created = createRemoteDevTask({
    ownerId: OWNER,
    projectId: PROJECT,
    objective: "Reconcile must not skip authorization.",
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
    approvedBaseBranch: "main",
    idempotencyKey: `sec-task-${Math.random().toString(16).slice(2)}`,
  });
  if (!created.ok) throw new Error(created.reason);
  return {
    ...created.task,
    externalJobId: "job-unapproved",
    providerKind: "FAKE" as const,
  };
}

test("reconcile refuses provider advance while AWAITING_APPROVAL", () => {
  const task = awaitingApprovalTask();
  for (const status of ["QUEUED", "RUNNING", "SUCCEEDED"] as const) {
    const result = reconcileRemoteStatus(task, {
      externalJobId: "job-unapproved",
      providerKind: "FAKE",
      status,
      detail: "forged advance",
      occurredAt: new Date().toISOString(),
      eventId: `evt-${status}`,
      signature: "s",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "AUTHORIZATION_REQUIRED");
  }
});

test("fake provider rejects submit before QUEUED", () => {
  const provider = new FakeRemoteExecutionProvider();
  const denied = provider.submitTask(awaitingApprovalTask());
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "INVALID_STATUS");
});

test("memory CAS consumption admits exactly one ONE_TIME winner", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(baseRequest());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const first = memoryConsumeAuthorizationCas(approved.session.authorization.id);
  const second = memoryConsumeAuthorizationCas(approved.session.authorization.id);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (first.ok) {
    assert.equal(first.authorization.status, "CONSUMED");
    assert.equal(first.consumedFully, true);
  }
  if (!second.ok) {
    assert.ok(second.reason === "ALREADY_CONSUMED" || second.reason === "NOT_APPROVED");
  }

  const race = simulateConcurrentOneTimeConsumption(8, 0);
  assert.equal(race.winners, 1);
  assert.equal(race.losers, 7);
  assert.equal(race.finalStatus, "CONSUMED");
});

test("queue path enforces duration budget; over-budget estimate fails closed", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(
    baseRequest({
      maxDurationMs: 60_000,
      maxEstimatedCostUsd: 2,
      at: new Date(Date.now() - 120_000).toISOString(),
    }),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const overTime = queueDevelopmentTask(approved.session);
  assert.equal(overTime.ok, false);
  if (!overTime.ok) assert.equal(overTime.reason, "DURATION_EXCEEDED");

  const fresh = createDevelopmentRequest(baseRequest({ maxEstimatedCostUsd: 2 }));
  assert.equal(fresh.ok, true);
  if (!fresh.ok) return;
  const approved2 = approveDevelopmentRequest(fresh.session, OWNER);
  assert.equal(approved2.ok, true);
  if (!approved2.ok) return;
  const overBudget = queueDevelopmentTask(approved2.session, { estimatedCostUsd: 9 });
  assert.equal(overBudget.ok, false);
  if (!overBudget.ok) assert.equal(overBudget.reason, "BUDGET_EXCEEDED");
});

test("Accept does not auto-verify evidence; independent check is required", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(baseRequest());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const queued = queueDevelopmentTask(approved.session);
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  const simulated = runSimulatedExecution(queued.session);
  assert.equal(simulated.ok, true);
  if (!simulated.ok) return;
  assert.equal(simulated.session.task.evidence?.verificationState, "UNVERIFIED");

  const premature = reviewSimulatedOutcome(simulated.session, "ACCEPT", OWNER);
  assert.equal(premature.ok, false);
  if (!premature.ok) assert.equal(premature.reason, "EVIDENCE_UNVERIFIED");

  const verified = verifySimulatedEvidence(simulated.session, OWNER);
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.session.task.evidence?.verificationState, "VERIFIED");

  const accepted = reviewSimulatedOutcome(verified.session, "ACCEPT", OWNER);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.session.task.status, "VERIFIED");
});

test("post-consume revoke halts in-flight execution and blocks further steps", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(baseRequest());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const queued = queueDevelopmentTask(approved.session);
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  assert.equal(queued.session.authorization.status, "CONSUMED");

  const halted = revokeDevelopmentAuthorization(queued.session, OWNER, "stop mid-flight");
  assert.equal(halted.ok, true);
  if (!halted.ok) return;
  assert.equal(halted.session.task.status, "CANCELLED");
  assert.equal(memoryIsExecutionHalted(queued.session.authorization.id), true);
  // Auth remains CONSUMED (identity-terminal); kill switch is task halt.
  assert.equal(halted.session.authorization.status, "CONSUMED");

  const step = gateRemoteDevStep(halted.session.authorization, {
    ...halted.session.task,
    status: "QUEUED",
  }, { authorizationConsumed: true });
  assert.equal(step.ok, false);
  if (!step.ok) assert.equal(step.reason, "EXECUTION_HALTED");
});

test("step gate rechecks duration after recovery-style elapsed growth", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(
    baseRequest({
      maxDurationMs: 60_000,
      at: new Date(Date.now() - 5_000).toISOString(),
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

  const elapsed = elapsedMsSinceTaskCreated(queued.session.task, new Date().toISOString());
  assert.ok(elapsed < queued.session.task.duration.maxDurationMs);

  const denied = gateRemoteDevStep(queued.session.authorization, queued.session.task, {
    authorizationConsumed: true,
    elapsedMs: queued.session.task.duration.maxDurationMs + 1,
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "DURATION_EXCEEDED");
});

test("pre-queue revoke still fails closed at authorization gate", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(baseRequest());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const revoked = revokeDevelopmentAuthorization(approved.session, OWNER, "withdraw before queue");
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;
  assert.equal(revoked.session.authorization.status, "REVOKED");
  assert.equal(gateRemoteDevQueue(revoked.session.authorization, revoked.session.task).ok, false);
});

test("reconcile still advances authorized QUEUED tasks", () => {
  const awaiting = awaitingApprovalTask();
  const queued = transitionRemoteDevTask(awaiting, "QUEUED", { ownerId: OWNER });
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  const running = reconcileRemoteStatus(queued.task, {
    externalJobId: "job-unapproved",
    providerKind: "FAKE",
    status: "RUNNING",
    detail: "ok",
    occurredAt: new Date().toISOString(),
    eventId: "evt-ok",
    signature: "s",
  });
  assert.equal(running.ok, true);
  if (running.ok) assert.equal(running.task.status, "RUNNING");
});
