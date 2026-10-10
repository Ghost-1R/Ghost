/**
 * Local disposable Supabase integration tests for durable remote-development (Build 09.9C prep).
 * Skips unless GHOST_LOCAL_DURABLE_DB_TEST=1 and URL is loopback.
 * Never targets production / hosted Supabase.
 *
 * Covers (when a disposable DB is available):
 * - Durable ONE_TIME authorization consumption
 * - Concurrent queue/consume races
 * - Revocation and expiration
 * - Owner/project isolation
 * - remote_development_tasks ↔ agent_tasks relationship
 * - Checkpoint / step revalidation after consume
 * - Persistence after reload queries
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadAgentTaskById } from "@/lib/agent-runtime/queries";
import { loadAuthorizationById } from "@/lib/approvals/queries";
import type { GhostClient } from "@/lib/auth/session";
import {
  approveDurableDevelopmentRequest,
  createDurableDevelopmentRequest,
  loadDurableDevelopmentBundle,
  queueDurableDevelopmentTask,
  revalidateDurableDevelopmentStep,
  revokeDurableDevelopmentAuthorization,
} from "./durable-workflow";

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url);
}

const enabled =
  process.env.GHOST_LOCAL_DURABLE_DB_TEST === "1" &&
  isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

function sql(query: string): string {
  const container = process.env.GHOST_LOCAL_DB_CONTAINER ?? "supabase_db_ghost";
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      query,
    ],
    { encoding: "utf8" },
  ).trim();
}

async function createSyntheticUser(label: string): Promise<{ id: string; client: SupabaseClient }> {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const email = `durable-${label}-${randomUUID().slice(0, 8)}@ghost.local`;
  const password = `LocalTest-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? "Failed to create synthetic user");
  }
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await userClient.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(signedIn.error.message);
  return { id: created.data.user.id, client: userClient };
}

async function seedOwnedProject(userId: string, slug: string): Promise<string> {
  const companyId = randomUUID();
  const projectId = randomUUID();
  sql(`
    insert into public.profiles (id, display_name)
    values ('${userId}', 'Durable Tester')
    on conflict (id) do nothing;
    insert into public.companies (id, owner_id, name, slug)
    values ('${companyId}', '${userId}', 'Durable Co ${slug}', 'durable-co-${slug}');
    insert into public.projects (id, company_id, name, slug, description, status)
    values ('${projectId}', '${companyId}', 'Durable Project ${slug}', 'durable-proj-${slug}', 'synthetic', 'IDEA');
  `);
  return projectId;
}

function requestInput(ownerId: string, projectId: string, key: string) {
  return {
    ownerId,
    projectId,
    projectName: "Durable Project",
    objective: "Durable DB integration coverage for Build 09.9C preparation.",
    repository: "Ghost-1R/Ghost",
    approvedBaseBranch: "cursor/cloud-verification-prep-09-9c-7050",
    environmentLabel: "REMOTE_DEV",
    maxEstimatedCostUsd: 3,
    maxDurationMs: 3_600_000,
    idempotencyKey: key,
  };
}

test("durable remote-development DB integration", { skip: !enabled }, async (t) => {
  assert.ok(isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!), "must use local Supabase URL");
  assert.ok(!/supabase\.co/i.test(process.env.NEXT_PUBLIC_SUPABASE_URL!));

  // Fail closed if 09.13 link migration is absent.
  const hasLink = sql(`
    select count(*)::text from information_schema.columns
    where table_schema = 'public'
      and table_name = 'remote_development_tasks'
      and column_name = 'agent_task_id';
  `);
  assert.equal(hasLink, "1", "Apply 20261010091300_remote_dev_agent_task_link.sql on disposable DB first");

  const owner = await createSyntheticUser("owner");
  const other = await createSyntheticUser("other");
  const projectId = await seedOwnedProject(owner.id, randomUUID().slice(0, 8));
  const foreignProjectId = await seedOwnedProject(other.id, randomUUID().slice(0, 8));
  const ghostOwner = owner.client as unknown as GhostClient;
  const ghostOther = other.client as unknown as GhostClient;

  await t.test("create durable request + owner isolation", async () => {
    const created = await createDurableDevelopmentRequest(
      ghostOwner,
      requestInput(owner.id, projectId, `dur-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.data.remote.status, "AWAITING_APPROVAL");
    assert.equal(created.data.authorization.status, "PENDING");
    assert.equal(created.data.remote.agentTaskId, null);

    const foreign = await loadDurableDevelopmentBundle(
      ghostOther,
      other.id,
      created.data.remote.id,
    );
    assert.equal(foreign.ok, false);

    const wrongProject = await createDurableDevelopmentRequest(
      ghostOwner,
      requestInput(owner.id, foreignProjectId, `dur-foreign-${randomUUID()}`),
    );
    // Owner of ghostOwner cannot see foreignProjectId via RLS → create should fail.
    assert.equal(wrongProject.ok, false);
  });

  await t.test("approve → queue consumes ONE_TIME and binds agent_tasks", async () => {
    const created = await createDurableDevelopmentRequest(
      ghostOwner,
      requestInput(owner.id, projectId, `dur-queue-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const approved = await approveDurableDevelopmentRequest(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(approved.data.authorization.status, "APPROVED");

    const queued = await queueDurableDevelopmentTask(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    assert.equal(queued.data.remote.status, "QUEUED");
    assert.ok(queued.data.remote.agentTaskId);
    assert.equal(queued.data.authorization.status, "CONSUMED");
    assert.equal(queued.data.authorizationConsumed, true);

    const agent = await loadAgentTaskById(ghostOwner, owner.id, queued.data.remote.agentTaskId!);
    assert.equal(agent.status, "ok");
    if (agent.status === "ok" && agent.data) {
      assert.equal(agent.data.binding.authorizationId, queued.data.authorization.id);
      assert.equal(agent.data.projectId, projectId);
      assert.equal(agent.data.ownerId, owner.id);
      assert.equal(agent.data.authorizationConsumed, true);
      assert.equal(agent.data.binding.authorizationKind, "DEVELOPMENT");
    }

    const secondQueue = await queueDurableDevelopmentTask(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    assert.equal(secondQueue.ok, false);
  });

  await t.test("concurrent ONE_TIME queue/consume admits one winner", async () => {
    const created = await createDurableDevelopmentRequest(
      ghostOwner,
      requestInput(owner.id, projectId, `dur-race-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const approved = await approveDurableDevelopmentRequest(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;

    const [a, b] = await Promise.all([
      queueDurableDevelopmentTask(ghostOwner, {
        ownerId: owner.id,
        remoteTaskId: created.data.remote.id,
      }),
      queueDurableDevelopmentTask(ghostOwner, {
        ownerId: owner.id,
        remoteTaskId: created.data.remote.id,
      }),
    ]);
    const wins = [a, b].filter((row) => row.ok);
    const losses = [a, b].filter((row) => !row.ok);
    assert.equal(wins.length, 1);
    assert.equal(losses.length, 1);

    const auth = await loadAuthorizationById(ghostOwner, owner.id, approved.data.authorization.id);
    assert.equal(auth.status, "ok");
    if (auth.status === "ok" && auth.data) {
      assert.equal(auth.data.status, "CONSUMED");
      assert.equal(auth.data.useCount, 1);
    }
  });

  await t.test("revocation before queue and expiry fail closed", async () => {
    const created = await createDurableDevelopmentRequest(
      ghostOwner,
      requestInput(owner.id, projectId, `dur-revoke-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const approved = await approveDurableDevelopmentRequest(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;

    const revoked = await revokeDurableDevelopmentAuthorization(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
      reason: "stop before queue",
    });
    assert.equal(revoked.ok, true);
    if (!revoked.ok) return;
    assert.equal(revoked.data.authorization.status, "REVOKED");
    assert.equal(
      (
        await queueDurableDevelopmentTask(ghostOwner, {
          ownerId: owner.id,
          remoteTaskId: created.data.remote.id,
        })
      ).ok,
      false,
    );

    const exp = await createDurableDevelopmentRequest(
      ghostOwner,
      requestInput(owner.id, projectId, `dur-exp-${randomUUID()}`),
    );
    assert.equal(exp.ok, true);
    if (!exp.ok) return;
    const expApproved = await approveDurableDevelopmentRequest(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: exp.data.remote.id,
      actorId: owner.id,
    });
    assert.equal(expApproved.ok, true);
    if (!expApproved.ok) return;
    sql(`
      update public.founder_action_authorizations
      set expires_at = now() - interval '1 minute'
      where id = '${expApproved.data.authorization.id}';
    `);
    const expiredQueue = await queueDurableDevelopmentTask(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: exp.data.remote.id,
    });
    assert.equal(expiredQueue.ok, false);
  });

  await t.test("step revalidation after consume + persistence after reload", async () => {
    const created = await createDurableDevelopmentRequest(
      ghostOwner,
      requestInput(owner.id, projectId, `dur-step-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const approved = await approveDurableDevelopmentRequest(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    const queued = await queueDurableDevelopmentTask(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    assert.equal(queued.ok, true);
    if (!queued.ok) return;

    const step = await revalidateDurableDevelopmentStep(ghostOwner, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    assert.equal(step.ok, true);

    const reloaded = await loadDurableDevelopmentBundle(
      ghostOwner,
      owner.id,
      created.data.remote.id,
    );
    assert.equal(reloaded.ok, true);
    if (!reloaded.ok) return;
    assert.equal(reloaded.data.remote.agentTaskId, queued.data.remote.agentTaskId);
    assert.equal(reloaded.data.authorization.status, "CONSUMED");
    assert.equal(reloaded.data.projection.persistenceMode, "DATABASE");
  });

  await t.test("orphan / cross-tenant agent_task_id rewrite rejected", async () => {
    const created = await createDurableDevelopmentRequest(
      ghostOwner,
      requestInput(owner.id, projectId, `dur-orphan-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    let rejected = false;
    try {
      sql(`
        update public.remote_development_tasks
        set agent_task_id = '${randomUUID()}'
        where id = '${created.data.remote.id}';
      `);
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true);
  });
});

test("durable DB integration remains skipped without local disposable flag", {
  skip: enabled,
}, () => {
  assert.equal(enabled, false);
  assert.equal(process.env.GHOST_LOCAL_DURABLE_DB_TEST === "1", false);
});
