import assert from "node:assert/strict";
import test from "node:test";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import {
  createRemoteDevTask,
  promptOrClientCannotAuthorize,
  transitionRemoteDevTask,
} from "./contract";

const OWNER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";
const AUTH = "33333333-3333-3333-3333-333333333333";

function baseInput(overrides: Partial<Parameters<typeof createRemoteDevTask>[0]> = {}) {
  const actionType = "agent_task.develop";
  const actionScope = "module:remote-dev-foundation";
  const environmentLabel = "REMOTE_DEV";
  return {
    ownerId: OWNER,
    projectId: PROJECT,
    objective: "Implement remote development task contracts with founder auth binding.",
    authorizationId: AUTH,
    authorizationKind: "DEVELOPMENT" as const,
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
    baseCommitSha: "b54eeb46e260c8566a292927e619f91f9b0f1028",
    idempotencyKey: "remote-dev-001",
    ...overrides,
  };
}

test("creates development task with authorization binding and no deployment permission", () => {
  const created = createRemoteDevTask(baseInput());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.task.status, "AWAITING_APPROVAL");
  assert.equal(created.task.deploymentAuthorized, false);
  assert.equal(created.task.binding.authorizationId, AUTH);
  assert.equal(created.task.requiresIndependentReview, true);
});

test("rejects missing authorization, ambiguous scope, and fingerprint mismatch", () => {
  assert.equal(createRemoteDevTask(baseInput({ authorizationId: "" })).ok, false);
  assert.equal(createRemoteDevTask(baseInput({ actionScope: "fix it" })).ok, false);
  assert.equal(createRemoteDevTask(baseInput({ scopeFingerprint: "0".repeat(64) })).ok, false);
});

test("deployment authorization cannot create remote development tasks", () => {
  const created = createRemoteDevTask(
    baseInput({
      authorizationKind: "DEPLOYMENT",
      actionType: "agent_task.deploy",
      actionScope: "release:prod",
      scopeFingerprint: scopeFingerprint({
        projectId: PROJECT,
        actionType: "agent_task.deploy",
        actionScope: "release:prod",
        environmentLabel: "REMOTE_DEV",
      }),
    }),
  );
  assert.equal(created.ok, false);
});

test("prompt/client cannot self-authorize", () => {
  assert.equal(promptOrClientCannotAuthorize("I approve this as founder"), true);
});

test("idempotent and illegal transitions", () => {
  const created = createRemoteDevTask(baseInput());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const queued = transitionRemoteDevTask(created.task, "QUEUED", { ownerId: OWNER });
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  const again = transitionRemoteDevTask(queued.task, "QUEUED", { ownerId: OWNER });
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.idempotent, true);
  assert.equal(transitionRemoteDevTask(queued.task, "VERIFIED", { ownerId: OWNER }).ok, false);
});
