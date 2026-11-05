import assert from "node:assert/strict";
import test from "node:test";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import { createRemoteDevTask, transitionRemoteDevTask } from "./contract";
import { FakeRemoteExecutionProvider } from "./fake-provider";
import { assertNoRealExternalDispatch } from "./provider";
import { reconcileRemoteStatus } from "./reconcile";
import { signProviderWebhookBody, validateProviderWebhook } from "./webhook";

const OWNER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

function queuedTask() {
  const actionType = "agent_task.implement";
  const actionScope = "pkg:remote-provider";
  const environmentLabel = "REMOTE_DEV";
  const created = createRemoteDevTask({
    ownerId: OWNER,
    projectId: PROJECT,
    objective: "Exercise fake remote provider dispatch boundaries.",
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
    idempotencyKey: "provider-test-001",
  });
  if (!created.ok) throw new Error(created.reason);
  const queued = transitionRemoteDevTask(created.task, "QUEUED", { ownerId: OWNER });
  if (!queued.ok) throw new Error(queued.reason);
  return queued.task;
}

test("fake provider submits without external dispatch", () => {
  const provider = new FakeRemoteExecutionProvider();
  const submitted = provider.submitTask(queuedTask());
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  assert.equal(submitted.dispatched, false);
  assert.ok(submitted.externalJobId.length >= 16);
  const status = provider.readStatus(submitted.externalJobId);
  assert.equal(status.ok, true);
});

test("real provider kinds are forbidden at dispatch boundary", () => {
  const cursor = assertNoRealExternalDispatch("CURSOR_CLOUD");
  assert.equal(cursor.ok, false);
  const actions = assertNoRealExternalDispatch("GITHUB_ACTIONS");
  assert.equal(actions.ok, false);
  assert.equal(assertNoRealExternalDispatch("FAKE").ok, true);
});

test("forged and replayed webhooks fail closed; duplicates are idempotent", () => {
  const secret = "test-webhook-secret-16";
  const event = {
    externalJobId: "job-1",
    providerKind: "FAKE" as const,
    status: "RUNNING" as const,
    detail: "running",
    occurredAt: new Date().toISOString(),
    eventId: "evt-1",
    signature: "",
  };
  const body = JSON.stringify(event);
  const sig = signProviderWebhookBody(body, secret);
  event.signature = sig;

  const ok = validateProviderWebhook({
    rawBody: body,
    signatureHeader: sig,
    sharedSecret: secret,
    event,
    seenEventIds: new Set(),
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.duplicate, false);

  const forged = validateProviderWebhook({
    rawBody: body,
    signatureHeader: "deadbeef",
    sharedSecret: secret,
    event,
    seenEventIds: new Set(),
  });
  assert.equal(forged.ok, false);

  const replay = validateProviderWebhook({
    rawBody: body,
    signatureHeader: sig,
    sharedSecret: secret,
    event: { ...event, occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    seenEventIds: new Set(),
  });
  assert.equal(replay.ok, false);

  const dup = validateProviderWebhook({
    rawBody: body,
    signatureHeader: sig,
    sharedSecret: secret,
    event,
    seenEventIds: new Set(["evt-1"]),
  });
  assert.equal(dup.ok, true);
  if (dup.ok) assert.equal(dup.duplicate, true);
});

test("reconcile requires matching external job identity; cancellation works", () => {
  const provider = new FakeRemoteExecutionProvider();
  let task = queuedTask();
  const submitted = provider.submitTask(task);
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  task = { ...task, externalJobId: submitted.externalJobId, providerKind: "FAKE" };

  const mismatch = reconcileRemoteStatus(task, {
    externalJobId: "other",
    providerKind: "FAKE",
    status: "RUNNING",
    detail: "x",
    occurredAt: new Date().toISOString(),
    eventId: "e",
    signature: "s",
  });
  assert.equal(mismatch.ok, false);

  const running = reconcileRemoteStatus(task, {
    externalJobId: submitted.externalJobId,
    providerKind: "FAKE",
    status: "RUNNING",
    detail: "running",
    occurredAt: new Date().toISOString(),
    eventId: "e2",
    signature: "s",
  });
  assert.equal(running.ok, true);
  if (running.ok) assert.equal(running.task.status, "RUNNING");

  const cancel = provider.requestCancellation(submitted.externalJobId);
  assert.equal(cancel.ok, true);
});
