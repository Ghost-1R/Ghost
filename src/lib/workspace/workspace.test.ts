import assert from "node:assert/strict";
import test from "node:test";
import { makeAuth, OWNER_ID, PROJECT_ID } from "@/lib/agent-runtime/test-helpers";
import { runBoundedMockWorkerTurn } from "@/lib/agent-runtime/mock-worker";
import type { AgentTask } from "@/lib/agent-runtime/types";
import { countTaskStatuses, deriveWorkspacePhase } from "./types";
import { planWorkspaceControl } from "./workflow";

test("workspace phase distinguishes proposal, queued, active, and verified", () => {
  assert.equal(deriveWorkspacePhase({ tasks: [], pendingApprovals: 0, hasPlan: true }).phase, "PROPOSAL");
  assert.equal(
    deriveWorkspacePhase({
      tasks: [{ id: "t1", status: "QUEUED" }],
      pendingApprovals: 0,
      hasPlan: true,
    }).phase,
    "QUEUED",
  );
  assert.equal(
    deriveWorkspacePhase({
      tasks: [{ id: "t1", status: "RUNNING" }],
      pendingApprovals: 0,
      hasPlan: true,
    }).phase,
    "ACTIVE",
  );
  assert.equal(
    deriveWorkspacePhase({
      tasks: [{ id: "t1", status: "SUCCEEDED" }],
      pendingApprovals: 0,
      hasPlan: true,
    }).phase,
    "VERIFIED",
  );
});

test("counts never invent activity", () => {
  const counts = countTaskStatuses([
    { status: "QUEUED" },
    { status: "FAILED" },
    { status: "SUCCEEDED" },
    { status: "BLOCKED" },
  ]);
  assert.deepEqual(counts, { queued: 1, running: 0, blocked: 1, failed: 1, completed: 1 });
});

test("pause/resume/cancel follow legal agent-task transitions", () => {
  const paused = planWorkspaceControl(
    { id: "t", ownerId: OWNER_ID, status: "RUNNING" },
    { ownerId: OWNER_ID, control: "PAUSE" },
  );
  assert.equal(paused.ok, true);
  if (paused.ok) assert.equal(paused.toStatus, "BLOCKED");

  const resumed = planWorkspaceControl(
    { id: "t", ownerId: OWNER_ID, status: "BLOCKED" },
    { ownerId: OWNER_ID, control: "RESUME" },
  );
  assert.equal(resumed.ok, true);
  if (resumed.ok) assert.equal(resumed.toStatus, "QUEUED");

  const cancelled = planWorkspaceControl(
    { id: "t", ownerId: OWNER_ID, status: "QUEUED" },
    { ownerId: OWNER_ID, control: "CANCEL" },
  );
  assert.equal(cancelled.ok, true);
  if (cancelled.ok) assert.equal(cancelled.toStatus, "CANCELLED");

  const foreign = planWorkspaceControl(
    { id: "t", ownerId: OWNER_ID, status: "RUNNING" },
    { ownerId: "other", control: "PAUSE" },
  );
  assert.equal(foreign.ok, false);
});

test("mock worker refuses LIVE dispatch fingerprints", () => {
  const auth = makeAuth({
    status: "CONSUMED",
    actionType: "agent_task.develop",
    actionScope:
      "repo:x@y|obj:z|codegen=pilot03;provider=openai;model=gpt-5-mini;class=PUBLIC;dispatch=LIVE;estCents=1;maxCents=98;deploy=false",
    environmentLabel: "LOCAL_PILOT_05",
  });
  const now = new Date().toISOString();
  const task: AgentTask = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    status: "QUEUED",
    binding: {
      authorizationId: auth.id,
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      actionType: auth.actionType,
      actionScope: auth.actionScope,
      environmentLabel: auth.environmentLabel,
      scopeFingerprint: auth.scopeFingerprint,
      authorizationKind: "DEVELOPMENT",
    },
    lease: null,
    checkpointSequence: 0,
    lastCheckpointId: null,
    lastStepIdempotencyKey: "",
    idempotencyKey: "workspace-mock-live-refuse-01",
    blockReason: "",
    authorizationConsumed: true,
    createdAt: now,
    updatedAt: now,
    claimedAt: null,
    completedAt: null,
  };
  const turn = runBoundedMockWorkerTurn({
    task,
    authorization: auth,
    ownerId: OWNER_ID,
  });
  assert.equal(turn.ok, false);
  if (!turn.ok) assert.equal(turn.reason, "DISPATCH_LIVE");
});
