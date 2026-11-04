import assert from "node:assert/strict";
import test from "node:test";
import {
  revalidateAuthorizationForTaskClaim,
  revalidateAuthorizationForTaskStep,
} from "./revalidate-for-task";
import { createBoundAgentTask } from "./workflow";
import { makeAuth, OWNER_ID, PROJECT_ID } from "./test-helpers";

test("claim requires APPROVED; consumed auth cannot be claimed again", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "m",
    environmentLabel: "LOCAL",
  });
  const created = createBoundAgentTask({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    authorization: auth,
    authorizationKind: "DEVELOPMENT",
    actionType: "agent_task.develop",
    actionScope: "m",
    environmentLabel: "LOCAL",
    idempotencyKey: "reval-claim-001",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  assert.equal(
    revalidateAuthorizationForTaskClaim(auth, created.task.binding).ok,
    true,
  );
  assert.equal(
    revalidateAuthorizationForTaskClaim(
      { ...auth, status: "CONSUMED", effectiveStatus: "CONSUMED", useCount: 1 },
      created.task.binding,
    ).ok,
    false,
  );
});

test("step allows CONSUMED only when task recorded authorizationConsumed", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "m2",
    environmentLabel: "LOCAL",
  });
  const created = createBoundAgentTask({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    authorization: auth,
    authorizationKind: "DEVELOPMENT",
    actionType: "agent_task.develop",
    actionScope: "m2",
    environmentLabel: "LOCAL",
    idempotencyKey: "reval-step-001",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const claimed = {
    ...created.task,
    status: "CLAIMED" as const,
    claimedAt: new Date().toISOString(),
    authorizationConsumed: true,
  };
  const consumed = {
    ...auth,
    status: "CONSUMED" as const,
    effectiveStatus: "CONSUMED" as const,
    useCount: 1,
  };
  const ok = revalidateAuthorizationForTaskStep(consumed, claimed);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.mode, "CONSUMED_FOR_TASK");

  const bypass = revalidateAuthorizationForTaskStep(consumed, {
    ...claimed,
    authorizationConsumed: false,
  });
  assert.equal(bypass.ok, false);
  if (!bypass.ok) assert.equal(bypass.reason, "CONSUMED_WITHOUT_CLAIM");
});

test("revoked or expired stops steps even after claim+consume", () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "m3",
    environmentLabel: "LOCAL",
  });
  const created = createBoundAgentTask({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    authorization: auth,
    authorizationKind: "DEVELOPMENT",
    actionType: "agent_task.develop",
    actionScope: "m3",
    environmentLabel: "LOCAL",
    idempotencyKey: "reval-stop-001",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const claimed = {
    ...created.task,
    status: "RUNNING" as const,
    claimedAt: new Date().toISOString(),
    authorizationConsumed: true,
  };

  const revoked = revalidateAuthorizationForTaskStep(
    { ...auth, status: "REVOKED", effectiveStatus: "REVOKED" },
    claimed,
  );
  assert.equal(revoked.ok, false);
  if (!revoked.ok) assert.equal(revoked.reason, "REVOKED");

  const expired = revalidateAuthorizationForTaskStep(
    {
      ...auth,
      status: "APPROVED",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      effectiveStatus: "EXPIRED",
    },
    claimed,
    new Date().toISOString(),
  );
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, "EXPIRED");
});
