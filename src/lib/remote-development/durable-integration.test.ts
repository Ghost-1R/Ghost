import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { OWNER_ID, PROJECT_ID, makeAuth } from "@/lib/agent-runtime/test-helpers";
import { createBoundAgentTask } from "@/lib/agent-runtime/workflow";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import { projectDevelopmentToTodayActions } from "@/lib/operations/development-surface";
import { createRemoteDevTask } from "./contract";
import { createDurableFakeSupabase } from "./durable-fake-db";
import {
  approveDurableDevelopmentRequest,
  createDurableDevelopmentRequest,
  queueDurableDevelopmentTask,
  revalidateDurableDevelopmentStep,
} from "./durable-workflow";
import { assertSimulatedCannotVerifyProjectTruth } from "./project-truth-boundary";
import {
  assertRemoteDevAgentLinkAllowed,
  STATUS_OWNERSHIP,
  suggestRemoteProgressFromAgent,
} from "./relationship";
import { projectDevelopmentState } from "./state-projection";
import type { GhostClient } from "@/lib/auth/session";

const OWNER = OWNER_ID;
const PROJECT = PROJECT_ID;
const OTHER = "99999999-9999-9999-9999-999999999999";

function seedProject(db: ReturnType<typeof createDurableFakeSupabase>, ownerId = OWNER) {
  db.__seed("projects", [{ id: PROJECT, name: "Ghost", owner_id: ownerId }]);
}

function requestInput(partial: Record<string, unknown> = {}) {
  return {
    ownerId: OWNER,
    projectId: PROJECT,
    projectName: "Ghost",
    objective: "Prepare durable remote development integration for Build 09.13.",
    repository: "Ghost-1R/Ghost",
    approvedBaseBranch: "cursor/durable-integration-09-13-7050",
    environmentLabel: "REMOTE_DEV",
    maxEstimatedCostUsd: 5,
    maxDurationMs: 3_600_000,
    idempotencyKey: `durable-${Math.random().toString(16).slice(2)}`,
    ...partial,
  };
}

test("status ownership documents split responsibilities without a third system", () => {
  assert.equal(STATUS_OWNERSHIP.authorizationLifecycle, "founder_action_authorizations");
  assert.equal(STATUS_OWNERSHIP.orchestrationAndReview, "remote_development_tasks");
  assert.equal(STATUS_OWNERSHIP.executionLeasesCheckpoints, "agent_tasks");
  assert.equal(STATUS_OWNERSHIP.workerQueue, "agent_worker_queue");
});

test("relationship integrity: owner/project/auth mismatch and reassignment fail closed", () => {
  const actionType = "agent_task.develop";
  const actionScope = "module:link";
  const environmentLabel = "REMOTE_DEV";
  const auth = makeAuth({
    status: "APPROVED",
    actionType,
    actionScope,
    environmentLabel,
  });
  const remote = createRemoteDevTask({
    ownerId: OWNER,
    projectId: PROJECT,
    objective: "Link integrity checks for remote development.",
    authorizationId: auth.id,
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
    idempotencyKey: "link-integrity-001",
  });
  assert.equal(remote.ok, true);
  if (!remote.ok) return;

  const agent = createBoundAgentTask({
    ownerId: OWNER,
    projectId: PROJECT,
    authorization: auth,
    authorizationKind: "DEVELOPMENT",
    actionType,
    actionScope,
    environmentLabel,
    idempotencyKey: "agent-link-001",
  });
  assert.equal(agent.ok, true);
  if (!agent.ok) return;

  assert.equal(assertRemoteDevAgentLinkAllowed(remote.task, agent.task).ok, true);
  assert.equal(
    assertRemoteDevAgentLinkAllowed({ ...remote.task, ownerId: OTHER }, agent.task).ok,
    false,
  );
  assert.equal(
    assertRemoteDevAgentLinkAllowed(remote.task, { ...agent.task, projectId: OTHER }).ok,
    false,
  );
  assert.equal(
    assertRemoteDevAgentLinkAllowed(
      { ...remote.task, agentTaskId: "11111111-1111-1111-1111-111111111111" },
      agent.task,
    ).ok,
    false,
  );
});

test("projection distinguishes approval, queue, review, and founder accept", () => {
  const actionType = "agent_task.develop";
  const actionScope = "module:proj";
  const environmentLabel = "REMOTE_DEV";
  const auth = makeAuth({
    status: "APPROVED",
    actionType,
    actionScope,
    environmentLabel,
  });
  const created = createRemoteDevTask({
    ownerId: OWNER,
    projectId: PROJECT,
    objective: "Projection coverage for durable development workflow.",
    authorizationId: auth.id,
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
    idempotencyKey: "projection-001",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const authorized = projectDevelopmentState({
    remote: created.task,
    authorization: auth,
    agent: null,
    persistenceMode: "DATABASE",
  });
  assert.equal(authorized.state, "AUTHORIZED");

  const queued = projectDevelopmentState({
    remote: { ...created.task, status: "QUEUED", agentTaskId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    authorization: { ...auth, status: "CONSUMED", effectiveStatus: "CONSUMED" },
    agent: null,
    persistenceMode: "DATABASE",
  });
  assert.equal(queued.state, "QUEUED");

  const review = projectDevelopmentState({
    remote: {
      ...created.task,
      status: "AWAITING_FOUNDER_REVIEW",
      evidence: {
        repository: "Ghost-1R/Ghost",
        baseCommitSha: null,
        taskBranch: null,
        commitSha: "abc1234",
        pullRequestRef: "#1",
        testResultsRef: null,
        artifactHashes: [],
        verificationState: "UNVERIFIED",
        providerClaimedAt: new Date().toISOString(),
        independentlyCheckedAt: null,
      },
    },
    authorization: auth,
    agent: null,
    persistenceMode: "DATABASE",
  });
  assert.equal(review.state, "AWAITING_REVIEW");

  const accepted = projectDevelopmentState({
    remote: { ...created.task, status: "VERIFIED" },
    authorization: auth,
    agent: null,
    persistenceMode: "DATABASE",
  });
  assert.equal(accepted.state, "FOUNDER_ACCEPTED");
  assert.equal(accepted.deploymentAuthorized, false);

  const today = projectDevelopmentToTodayActions([authorized, queued, review]);
  assert.ok(today.every((a) => a.sourceKind === "development_task"));
  assert.ok(today.every((a) => !/%|velocity/i.test(a.description)));
});

test("agent progress suggestion never auto-marks founder VERIFIED", () => {
  assert.equal(suggestRemoteProgressFromAgent("SUCCEEDED"), "AWAITING_FOUNDER_REVIEW");
  assert.notEqual(suggestRemoteProgressFromAgent("SUCCEEDED"), "VERIFIED");
});

test("durable path fails closed when schema is missing — no memory fallback", async () => {
  const db = createDurableFakeSupabase({
    missingTables: new Set(["founder_action_authorizations", "remote_development_tasks"]),
  });
  seedProject(db);
  const created = await createDurableDevelopmentRequest(
    db as unknown as GhostClient,
    requestInput(),
  );
  assert.equal(created.ok, false);
  if (!created.ok) {
    assert.match(created.message, /not available|does not exist|migration/i);
  }
});

test("durable request → approve → queue binds agent_tasks and consumes ONE_TIME", async () => {
  const db = createDurableFakeSupabase();
  seedProject(db);

  const created = await createDurableDevelopmentRequest(
    db as unknown as GhostClient,
    requestInput({ idempotencyKey: "durable-e2e-001" }),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.data.remote.status, "AWAITING_APPROVAL");
  assert.equal(created.data.remote.agentTaskId, null);
  assert.equal(created.data.authorization.status, "PENDING");
  assert.equal(created.data.projection.persistenceMode, "DATABASE");

  const approved = await approveDurableDevelopmentRequest(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
    actorId: OWNER,
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.data.authorization.status, "APPROVED");
  assert.equal(approved.data.projection.state, "AUTHORIZED");

  const queued = await queueDurableDevelopmentTask(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
  });
  assert.equal(queued.ok, true);
  if (!queued.ok) return;
  assert.equal(queued.data.remote.status, "QUEUED");
  assert.ok(queued.data.remote.agentTaskId);
  assert.ok(queued.data.agent);
  assert.equal(queued.data.agent?.id, queued.data.remote.agentTaskId);
  assert.equal(queued.data.authorization.status, "CONSUMED");
  assert.equal(queued.data.authorizationConsumed, true);
  assert.equal(queued.data.agent?.authorizationConsumed, true);
  assert.equal(queued.data.projection.state, "QUEUED");

  // Second queue fails (consumed / already bound)
  const again = await queueDurableDevelopmentTask(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
  });
  assert.equal(again.ok, false);
});

test("cross-owner durable approve/queue denied", async () => {
  const db = createDurableFakeSupabase();
  seedProject(db);
  const created = await createDurableDevelopmentRequest(
    db as unknown as GhostClient,
    requestInput(),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const denied = await approveDurableDevelopmentRequest(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
    actorId: OTHER,
  });
  assert.equal(denied.ok, false);
});

test("expired/revoked durable authorization cannot queue", async () => {
  const db = createDurableFakeSupabase();
  seedProject(db);
  const created = await createDurableDevelopmentRequest(
    db as unknown as GhostClient,
    requestInput({ expiresInHours: 24 }),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const approved = await approveDurableDevelopmentRequest(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
    actorId: OWNER,
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  // Force expiry on the durable row (mutate live fake table, not a dump clone).
  const expiredAt = new Date(Date.now() - 1000).toISOString();
  const forced = await db
    .from("founder_action_authorizations")
    .update({ expires_at: expiredAt })
    .eq("id", approved.data.authorization.id)
    .eq("owner_id", OWNER)
    .select("*")
    .maybeSingle();
  assert.equal(forced.error, null);
  assert.ok(forced.data);

  const queued = await queueDurableDevelopmentTask(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
  });
  assert.equal(queued.ok, false);
  if (!queued.ok) assert.match(queued.reason, /EXPIRED|NOT_APPROVED|PENDING/i);
});

test("scope mismatch and deployment separation fail closed at bind", async () => {
  const auth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.deploy",
    actionScope: "prod:release",
    environmentLabel: "PROD",
  });
  // createBoundAgentTask with DEPLOYMENT kind
  const agent = createBoundAgentTask({
    ownerId: OWNER,
    projectId: PROJECT,
    authorization: auth,
    authorizationKind: "DEPLOYMENT",
    actionType: "agent_task.deploy",
    actionScope: "prod:release",
    environmentLabel: "PROD",
    idempotencyKey: "deploy-agent-001",
  });
  assert.equal(agent.ok, true);
  if (!agent.ok) return;

  const remoteAuth = makeAuth({
    status: "APPROVED",
    actionType: "agent_task.develop",
    actionScope: "module:x",
    environmentLabel: "REMOTE_DEV",
    id: "55555555-5555-5555-5555-555555555555",
  });
  const remote = createRemoteDevTask({
    ownerId: OWNER,
    projectId: PROJECT,
    objective: "Must not link deployment agent task into remote development.",
    authorizationId: remoteAuth.id,
    authorizationKind: "DEVELOPMENT",
    actionType: "agent_task.develop",
    actionScope: "module:x",
    environmentLabel: "REMOTE_DEV",
    scopeFingerprint: remoteAuth.scopeFingerprint,
    repository: "Ghost-1R/Ghost",
    approvedBaseBranch: "main",
    idempotencyKey: "no-deploy-link-001",
  });
  assert.equal(remote.ok, true);
  if (!remote.ok) return;
  assert.equal(assertRemoteDevAgentLinkAllowed(remote.task, agent.task).ok, false);
});

test("orphan agent_task_id rejected by fake DB link guard", async () => {
  const db = createDurableFakeSupabase();
  seedProject(db);
  const created = await createDurableDevelopmentRequest(
    db as unknown as GhostClient,
    requestInput(),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const update = await db
    .from("remote_development_tasks")
    .update({ agent_task_id: "00000000-0000-0000-0000-000000000099" })
    .eq("id", created.data.remote.id)
    .eq("owner_id", OWNER)
    .select("*")
    .maybeSingle();
  assert.ok(update.error);
});

test("step revalidation after queue succeeds when consumed-for-task", async () => {
  const db = createDurableFakeSupabase();
  seedProject(db);
  const created = await createDurableDevelopmentRequest(
    db as unknown as GhostClient,
    requestInput(),
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = await approveDurableDevelopmentRequest(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
    actorId: OWNER,
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const queued = await queueDurableDevelopmentTask(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
  });
  assert.equal(queued.ok, true);
  if (!queued.ok) return;

  const step = await revalidateDurableDevelopmentStep(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
  });
  assert.equal(step.ok, true);
});

test("simulation still cannot upgrade Project Truth verified facets", () => {
  assert.equal(
    assertSimulatedCannotVerifyProjectTruth({
      simulationLabel: "SIMULATED",
      requestedOperationalState: "VERIFIED_LOCALLY",
    }).ok,
    false,
  );
});

test("09.13 migration freezes link integrity and is local-only", () => {
  const migration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261010091300_remote_dev_agent_task_link.sql"),
    "utf8",
  );
  assert.match(migration, /LOCAL ONLY/i);
  assert.match(migration, /Do not apply to hosted Supabase/i);
  assert.match(migration, /agent_task_id/);
  assert.match(migration, /guard_remote_dev_agent_task_link/);
  assert.match(migration, /remote_development_review_events/);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /authorization_kind/);
  assert.ok(!/grant delete/i.test(migration));
});
