import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { OWNER_ID, PROJECT_ID } from "@/lib/agent-runtime/test-helpers";
import type { GhostClient } from "@/lib/auth/session";
import { createDurableFakeSupabase } from "./durable-fake-db";
import { reviewDurableDevelopmentDeliverable } from "./durable-review";
import {
  approveDurableDevelopmentRequest,
  createDurableDevelopmentRequest,
  loadDurableDevelopmentBundle,
  queueDurableDevelopmentTask,
} from "./durable-workflow";
import { loadFounderDeliverableReviewsForTask } from "./queries";

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
    objective: "Durable founder deliverable review for Pilot 02 closure.",
    repository: "Ghost-1R/Ghost",
    approvedBaseBranch: "cursor/pilot-02-durable-supervised-execution",
    environmentLabel: "REMOTE_DEV",
    maxEstimatedCostUsd: 5,
    maxDurationMs: 3_600_000,
    idempotencyKey: `durable-review-${Math.random().toString(16).slice(2)}`,
    ...partial,
  };
}

async function seedAwaitingFounderReview(
  db: ReturnType<typeof createDurableFakeSupabase>,
  key: string,
) {
  seedProject(db);
  const created = await createDurableDevelopmentRequest(
    db as unknown as GhostClient,
    requestInput({ idempotencyKey: key }),
  );
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("create failed");

  const approved = await approveDurableDevelopmentRequest(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
    actorId: OWNER,
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) throw new Error("approve failed");

  const queued = await queueDurableDevelopmentTask(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: created.data.remote.id,
  });
  assert.equal(queued.ok, true);
  if (!queued.ok) throw new Error("queue failed");
  assert.ok(queued.data.remote.agentTaskId);

  const agentId = queued.data.remote.agentTaskId!;
  const checkpointId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const completedAt = new Date().toISOString();

  await db
    .from("agent_tasks")
    .update({
      status: "SUCCEEDED",
      completed_at: completedAt,
      last_checkpoint_id: checkpointId,
      checkpoint_sequence: 1,
    })
    .eq("id", agentId)
    .eq("owner_id", OWNER)
    .select("*")
    .maybeSingle();

  await db
    .from("remote_development_tasks")
    .update({
      status: "AWAITING_FOUNDER_REVIEW",
      completed_at: completedAt,
      evidence: {
        repository: "Ghost-1R/Ghost",
        baseCommitSha: null,
        taskBranch: null,
        commitSha: null,
        pullRequestRef: null,
        testResultsRef: "pilot-02/docker-validate",
        artifactHashes: ["ed2ab9d34f493c9d192008e3322dbe012b1a614008ff75decfe1f955c814ed32"],
        verificationState: "VERIFIED",
        providerClaimedAt: completedAt,
        independentlyCheckedAt: completedAt,
      },
    })
    .eq("id", created.data.remote.id)
    .eq("owner_id", OWNER)
    .select("*")
    .maybeSingle();

  return {
    remoteTaskId: created.data.remote.id,
    agentTaskId: agentId,
    authorizationId: queued.data.authorization.id,
  };
}

test("durable ACCEPT records immutable review and sets VERIFIED without deployment", async () => {
  const db = createDurableFakeSupabase();
  const seeded = await seedAwaitingFounderReview(db, "durable-review-accept-001");

  const result = await reviewDurableDevelopmentDeliverable(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: seeded.remoteTaskId,
    decision: "ACCEPT",
    note: "Pilot 02 confirm",
    idempotencyKey: "accept-idem-001",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.decision, "ACCEPT");
  assert.equal(result.resultingStatus, "VERIFIED");
  assert.equal(result.idempotent, false);
  assert.equal(result.task.status, "VERIFIED");
  assert.equal(result.task.deploymentAuthorized, false);

  const reviews = await loadFounderDeliverableReviewsForTask(
    db as unknown as GhostClient,
    OWNER,
    seeded.remoteTaskId,
  );
  assert.equal(reviews.status, "ok");
  if (reviews.status !== "ok") return;
  assert.equal(reviews.data.length, 1);
  assert.equal(reviews.data[0]?.decision, "ACCEPT");
  assert.equal(reviews.data[0]?.resultingStatus, "VERIFIED");

  // Auth stays CONSUMED — review does not reopen uses
  const bundle = await loadDurableDevelopmentBundle(
    db as unknown as GhostClient,
    OWNER,
    seeded.remoteTaskId,
  );
  assert.equal(bundle.ok, true);
  if (!bundle.ok) return;
  assert.equal(bundle.data.authorization.status, "CONSUMED");
});

test("durable REJECT and REQUEST_CHANGES set expected statuses", async () => {
  const rejectDb = createDurableFakeSupabase();
  const rejectSeed = await seedAwaitingFounderReview(rejectDb, "durable-review-reject-001");
  const rejected = await reviewDurableDevelopmentDeliverable(rejectDb as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: rejectSeed.remoteTaskId,
    decision: "REJECT",
    idempotencyKey: "reject-idem-001",
  });
  assert.equal(rejected.ok, true);
  if (!rejected.ok) return;
  assert.equal(rejected.resultingStatus, "FAILED");

  const changesDb = createDurableFakeSupabase();
  const changesSeed = await seedAwaitingFounderReview(changesDb, "durable-review-changes-001");
  const changes = await reviewDurableDevelopmentDeliverable(changesDb as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: changesSeed.remoteTaskId,
    decision: "REQUEST_CHANGES",
    note: "Tighten evidence pack",
    idempotencyKey: "changes-idem-001",
  });
  assert.equal(changes.ok, true);
  if (!changes.ok) return;
  assert.equal(changes.resultingStatus, "CHANGES_REQUESTED");
  assert.equal(changes.task.status, "CHANGES_REQUESTED");
});

test("duplicate ACCEPT with same idempotency key is idempotent", async () => {
  const db = createDurableFakeSupabase();
  const seeded = await seedAwaitingFounderReview(db, "durable-review-dup-001");
  const first = await reviewDurableDevelopmentDeliverable(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: seeded.remoteTaskId,
    decision: "ACCEPT",
    idempotencyKey: "dup-accept-key",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await reviewDurableDevelopmentDeliverable(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: seeded.remoteTaskId,
    decision: "ACCEPT",
    idempotencyKey: "dup-accept-key",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.idempotent, true);
  assert.equal(second.resultingStatus, "VERIFIED");

  const reviews = await loadFounderDeliverableReviewsForTask(
    db as unknown as GhostClient,
    OWNER,
    seeded.remoteTaskId,
  );
  assert.equal(reviews.status, "ok");
  if (reviews.status !== "ok") return;
  assert.equal(reviews.data.length, 1);
});

test("cross-owner durable review is denied", async () => {
  const db = createDurableFakeSupabase();
  const seeded = await seedAwaitingFounderReview(db, "durable-review-xowner-001");
  const denied = await reviewDurableDevelopmentDeliverable(db as unknown as GhostClient, {
    ownerId: OTHER,
    remoteTaskId: seeded.remoteTaskId,
    decision: "ACCEPT",
    idempotencyKey: "xowner-accept-001",
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.match(denied.reason, /NOT_FOUND|OWNER_MISMATCH|LOAD_FAILED/i);
  }
});

test("ACCEPT without evidence/checkpoint fails closed", async () => {
  const db = createDurableFakeSupabase();
  const seeded = await seedAwaitingFounderReview(db, "durable-review-noev-001");

  await db
    .from("agent_tasks")
    .update({
      last_checkpoint_id: null,
      completed_at: null,
      status: "SUCCEEDED",
    })
    .eq("id", seeded.agentTaskId)
    .eq("owner_id", OWNER)
    .select("*")
    .maybeSingle();

  await db
    .from("remote_development_tasks")
    .update({ evidence: null })
    .eq("id", seeded.remoteTaskId)
    .eq("owner_id", OWNER)
    .select("*")
    .maybeSingle();

  const result = await reviewDurableDevelopmentDeliverable(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: seeded.remoteTaskId,
    decision: "ACCEPT",
    idempotencyKey: "noev-accept-001",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "MISSING_EVIDENCE");
});

test("review persists across reload (same fake DB session)", async () => {
  const db = createDurableFakeSupabase();
  const seeded = await seedAwaitingFounderReview(db, "durable-review-persist-001");
  const accepted = await reviewDurableDevelopmentDeliverable(db as unknown as GhostClient, {
    ownerId: OWNER,
    remoteTaskId: seeded.remoteTaskId,
    decision: "ACCEPT",
    idempotencyKey: "persist-accept-001",
  });
  assert.equal(accepted.ok, true);

  const reloaded = await loadDurableDevelopmentBundle(
    db as unknown as GhostClient,
    OWNER,
    seeded.remoteTaskId,
  );
  assert.equal(reloaded.ok, true);
  if (!reloaded.ok) return;
  assert.equal(reloaded.data.remote.status, "VERIFIED");

  const reviews = await loadFounderDeliverableReviewsForTask(
    db as unknown as GhostClient,
    OWNER,
    seeded.remoteTaskId,
  );
  assert.equal(reviews.status, "ok");
  if (reviews.status !== "ok") return;
  assert.equal(reviews.data[0]?.idempotencyKey, "persist-accept-001");
});

test("migration declares immutable founder reviews and CHANGES_REQUESTED", () => {
  const sql = readFileSync(
    new URL("../../../supabase/migrations/20261012010000_durable_founder_review.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /remote_development_founder_reviews/);
  assert.match(sql, /CHANGES_REQUESTED/);
  assert.match(sql, /decision in \('ACCEPT', 'REJECT', 'REQUEST_CHANGES'\)/);
  assert.match(sql, /revoke all/i);
  assert.match(sql, /grant select, insert/i);
  assert.doesNotMatch(sql, /for update/i);
  assert.doesNotMatch(sql, /for delete/i);
});
