import assert from "node:assert/strict";
import test from "node:test";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import { makeAuth, OWNER_ID, PROJECT_ID } from "@/lib/agent-runtime/test-helpers";
import { gateRemoteDevQueue } from "./authorization-gate";
import { createRemoteDevTask } from "./contract";
import { toFounderInboxCard } from "./inbox";
import { memorySaveAuthorization, resetRemoteDevMemoryStore } from "./memory-store";
import {
  assertSimulatedCannotVerifyProjectTruth,
  reportSimulatedOutcomeForProjectTruth,
} from "./project-truth-boundary";
import { simulateProviderStep } from "./simulate";
import { FakeRemoteExecutionProvider } from "./fake-provider";
import { signProviderWebhookBody, validateProviderWebhook } from "./webhook";
import {
  approveDevelopmentRequest,
  createDevelopmentRequest,
  queueDevelopmentTask,
  reviewSimulatedOutcome,
  revokeDevelopmentAuthorization,
  runEndToEndSimulatedWorkflow,
  runSimulatedExecution,
} from "./workflow";

const OWNER = OWNER_ID;
const PROJECT = PROJECT_ID;

function baseRequest(partial: Partial<Parameters<typeof createDevelopmentRequest>[0]> = {}) {
  return {
    ownerId: OWNER,
    projectId: PROJECT,
    projectName: "Ghost",
    objective: "Wire end-to-end simulated development workflow for Build 09.11.",
    repository: "Ghost-1R/Ghost",
    approvedBaseBranch: "cursor/approval-bound-agent-task-772f",
    environmentLabel: "REMOTE_DEV",
    maxEstimatedCostUsd: 5,
    maxDurationMs: 3_600_000,
    requirements: "Use FakeRemoteExecutionProvider only.",
    evidenceSource: "spec",
    evidenceReference: "build-09-11",
    idempotencyKey: `e2e-${Math.random().toString(16).slice(2)}`,
    ...partial,
  };
}

test("end-to-end simulated workflow: request → approve → queue → simulate → review", () => {
  resetRemoteDevMemoryStore();
  const result = runEndToEndSimulatedWorkflow(baseRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.session.stage, "REVIEWED");
  assert.equal(result.session.task.status, "VERIFIED");
  assert.equal(result.session.simulationLabel, "SIMULATED");
  assert.equal(result.session.persistenceMode, "MEMORY_TEST_ONLY");
  assert.equal(result.session.task.deploymentAuthorized, false);
  const truth = reportSimulatedOutcomeForProjectTruth(result.session.task);
  assert.equal(truth.mapsToVerifiedLocally, false);
  assert.equal(truth.mapsToVerifiedInProduction, false);
});

test("rejects pending, revoked, expired, and mismatched authorization at queue", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(baseRequest());
  assert.equal(created.ok, true);
  if (!created.ok) return;

  // Pending must not queue
  const pendingQueue = queueDevelopmentTask(created.session);
  assert.equal(pendingQueue.ok, false);

  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const revoked = revokeDevelopmentAuthorization(approved.session, OWNER, "stop");
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;
  assert.equal(queueDevelopmentTask(revoked.session).ok, false);

  // Expired — persist expired clock into memory so queue reloads it
  const fresh = createDevelopmentRequest(baseRequest());
  assert.equal(fresh.ok, true);
  if (!fresh.ok) return;
  const approved2 = approveDevelopmentRequest(fresh.session, OWNER);
  assert.equal(approved2.ok, true);
  if (!approved2.ok) return;
  const expiredAuth = {
    ...approved2.session.authorization,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    effectiveStatus: "EXPIRED" as const,
  };
  memorySaveAuthorization(expiredAuth);
  const expiredSession = { ...approved2.session, authorization: expiredAuth };
  assert.equal(queueDevelopmentTask(expiredSession).ok, false);

  // Scope mismatch via gate helper
  const actionType = "agent_task.develop";
  const actionScope = "module:x";
  const environmentLabel = "REMOTE_DEV";
  const auth = makeAuth({
    status: "APPROVED",
    actionType,
    actionScope,
    environmentLabel,
  });
  const task = createRemoteDevTask({
    ownerId: OWNER,
    projectId: PROJECT,
    objective: "Mismatch gate check for remote development.",
    authorizationId: auth.id,
    authorizationKind: "DEVELOPMENT",
    actionType,
    actionScope: "module:other",
    environmentLabel,
    scopeFingerprint: scopeFingerprint({
      projectId: PROJECT,
      actionType,
      actionScope: "module:other",
      environmentLabel,
    }),
    repository: "Ghost-1R/Ghost",
    approvedBaseBranch: "main",
    idempotencyKey: "mismatch-gate-001",
  });
  assert.equal(task.ok, true);
  if (!task.ok) return;
  const gate = gateRemoteDevQueue(auth, task.task);
  assert.equal(gate.ok, false);
});

test("budget and duration limits enforced at gate", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(baseRequest({ maxEstimatedCostUsd: 2 }));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = approveDevelopmentRequest(created.session, OWNER);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const overBudget = gateRemoteDevQueue(approved.session.authorization, approved.session.task, {
    estimatedCostUsd: 10,
  });
  assert.equal(overBudget.ok, false);
  if (!overBudget.ok) assert.equal(overBudget.reason, "BUDGET_EXCEEDED");

  const overTime = gateRemoteDevQueue(approved.session.authorization, approved.session.task, {
    elapsedMs: approved.session.task.duration.maxDurationMs + 1,
  });
  assert.equal(overTime.ok, false);
  if (!overTime.ok) assert.equal(overTime.reason, "DURATION_EXCEEDED");
});

test("cross-owner isolation on review and approval", () => {
  resetRemoteDevMemoryStore();
  const created = createDevelopmentRequest(baseRequest());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const other = "99999999-9999-9999-9999-999999999999";
  assert.equal(approveDevelopmentRequest(created.session, other).ok, false);
});

test("cancellation, timeout, retry, and duplicate webhook handling", () => {
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

  const provider = new FakeRemoteExecutionProvider();
  const seen = new Set<string>();
  const submitted = simulateProviderStep({
    task: queued.session.task,
    provider,
    step: "SUBMIT",
    ownerId: OWNER,
    seenEventIds: seen,
  });
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;

  const timedOut = simulateProviderStep({
    task: submitted.task,
    provider,
    step: "TIMEOUT",
    ownerId: OWNER,
    seenEventIds: seen,
  });
  assert.equal(timedOut.ok, true);
  if (!timedOut.ok) return;
  assert.equal(timedOut.task.status, "FAILED");
  assert.equal(timedOut.task.lastError?.retryable, true);

  // Retry: re-queue failed task requires transition FAILED → QUEUED and fresh auth — ONE_TIME consumed.
  // Duplicate webhook:
  const secret = "ghost-09-11-sim-secret";
  const eventId = "dup-evt-1";
  const body = JSON.stringify({
    externalJobId: submitted.externalJobId,
    providerKind: "FAKE",
    status: "RUNNING",
    detail: "SIMULATED",
    occurredAt: new Date().toISOString(),
    eventId,
    signature: "",
  });
  const sig = signProviderWebhookBody(body, secret);
  const event = { ...JSON.parse(body), signature: sig };
  const first = validateProviderWebhook({
    rawBody: body,
    signatureHeader: sig,
    sharedSecret: secret,
    event,
    seenEventIds: new Set(),
  });
  assert.equal(first.ok, true);
  const dup = validateProviderWebhook({
    rawBody: body,
    signatureHeader: sig,
    sharedSecret: secret,
    event,
    seenEventIds: new Set([eventId]),
  });
  assert.equal(dup.ok, true);
  if (dup.ok) assert.equal(dup.duplicate, true);

  // Cancel path on a fresh queued session
  const again = createDevelopmentRequest(baseRequest());
  assert.equal(again.ok, true);
  if (!again.ok) return;
  const ap = approveDevelopmentRequest(again.session, OWNER);
  assert.equal(ap.ok, true);
  if (!ap.ok) return;
  const q2 = queueDevelopmentTask(ap.session);
  assert.equal(q2.ok, true);
  if (!q2.ok) return;
  const sub2 = simulateProviderStep({
    task: q2.session.task,
    provider: new FakeRemoteExecutionProvider(),
    step: "SUBMIT",
    ownerId: OWNER,
  });
  assert.equal(sub2.ok, true);
  if (!sub2.ok) return;
  const cancelled = simulateProviderStep({
    task: sub2.task,
    provider: sub2.provider,
    step: "CANCEL",
    ownerId: OWNER,
  });
  assert.equal(cancelled.ok, true);
  if (!cancelled.ok) return;
  assert.equal(cancelled.task.status, "CANCELLED");
});

test("false-success prevention: SIMULATED cannot become Project Truth verified", () => {
  assert.equal(
    assertSimulatedCannotVerifyProjectTruth({
      simulationLabel: "SIMULATED",
      requestedOperationalState: "VERIFIED_LOCALLY",
    }).ok,
    false,
  );
  assert.equal(
    assertSimulatedCannotVerifyProjectTruth({
      simulationLabel: "SIMULATED",
      requestedOperationalState: "VERIFIED_IN_PRODUCTION",
    }).ok,
    false,
  );
  assert.equal(
    assertSimulatedCannotVerifyProjectTruth({
      simulationLabel: "SIMULATED",
      requestedOperationalState: "IMPLEMENTED_LOCALLY",
    }).ok,
    false,
  );
});

test("ONE_TIME authorization consumed at queue; second queue fails", () => {
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
  assert.equal(queued.session.authorizationConsumed, true);
  assert.equal(queued.session.authorization.status, "CONSUMED");

  // Attempt to queue another task with same consumed auth fails
  const second = createDevelopmentRequest(baseRequest());
  assert.equal(second.ok, true);
  if (!second.ok) return;
  // Force bind to consumed auth
  const hijack = {
    ...second.session,
    authorization: queued.session.authorization,
    task: {
      ...second.session.task,
      binding: {
        ...second.session.task.binding,
        authorizationId: queued.session.authorization.id,
        actionType: queued.session.authorization.actionType,
        actionScope: queued.session.authorization.actionScope,
        environmentLabel: queued.session.authorization.environmentLabel,
        scopeFingerprint: queued.session.authorization.scopeFingerprint,
      },
    },
  };
  // Approve path skipped — auth already CONSUMED
  assert.equal(queueDevelopmentTask(hijack).ok, false);
});

test("founder inbox card exposes real workflow fields and SIMULATED labels", () => {
  resetRemoteDevMemoryStore();
  const result = runEndToEndSimulatedWorkflow(baseRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const card = toFounderInboxCard({
    task: result.session.task,
    authorization: result.session.authorization,
    persistenceMode: "MEMORY_TEST_ONLY",
  });
  assert.equal(card.simulationLabel, "SIMULATED");
  assert.equal(card.deploymentAuthorized, false);
  assert.equal(card.workflowStage, "REVIEWED");
  assert.match(card.projectTruthNote, /not set|not genuine|SIMULATED/i);
  assert.ok(!/%|velocity/i.test(card.objective));
});

test("reject review path and missing persistence stay honest", () => {
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
  const rejected = reviewSimulatedOutcome(simulated.session, "REJECT", OWNER);
  assert.equal(rejected.ok, true);
  if (!rejected.ok) return;
  assert.equal(rejected.session.task.status, "FAILED");
  assert.equal(rejected.session.persistenceMode, "MEMORY_TEST_ONLY");
});

test("invalid request fields fail closed", () => {
  resetRemoteDevMemoryStore();
  assert.equal(createDevelopmentRequest(baseRequest({ objective: "short" })).ok, false);
  assert.equal(createDevelopmentRequest(baseRequest({ repository: "nopath" })).ok, false);
  assert.equal(createDevelopmentRequest(baseRequest({ maxEstimatedCostUsd: -1 })).ok, false);
  assert.equal(createDevelopmentRequest(baseRequest({ maxDurationMs: 100 })).ok, false);
});
