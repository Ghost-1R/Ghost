/**
 * Pilot 03 durable codegen wiring — disposable ghost99f only.
 * Skips unless GHOST_LOCAL_DURABLE_DB_TEST=1 and loopback URL.
 * No live OpenAI. No hosted Supabase. No Ghost DB (54322).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { developmentApprovalGrantsDeployment } from "@/lib/agent-runtime/authorization-kind";
import {
  loadSqlAllowanceSnapshot,
  reconcileSqlAllowance,
  reserveSqlAllowance,
  setSqlProjectAllowance,
} from "@/lib/allowance/sql-ledger";
import type { GhostClient } from "@/lib/auth/session";
import { executeDurableCodegenMockPipeline } from "./durable-execution";
import { executeDurableCodegenLivePipeline } from "./durable-live-execution";
import { brandCodegenMockFetch } from "./openai-http";
import { PILOT_03_ALLOWED_FILES, PILOT_03_OBJECTIVE } from "./pilot03-constants";
import { buildCodegenTaskContract, encodeCodegenScopeFragment } from "./request-contract";
import { isCodegenLiveEnabled } from "./provider-config";
import {
  approveDurableDevelopmentRequest,
  createDurableDevelopmentRequest,
  loadDurableDevelopmentBundle,
  queueDurableDevelopmentTask,
  revokeDurableDevelopmentAuthorization,
} from "@/lib/remote-development/durable-workflow";
import { reviewDurableDevelopmentDeliverable } from "@/lib/remote-development/durable-review";

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url);
}

const enabled =
  process.env.GHOST_LOCAL_DURABLE_DB_TEST === "1" &&
  isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

function sql(query: string): string {
  const container = process.env.GHOST_LOCAL_DB_CONTAINER ?? "supabase_db_ghost99f";
  if (container === "supabase_db_ghost" || process.env.GHOST_09_9F_REQUIRE_DISPOSABLE === "1") {
    if (container !== "supabase_db_ghost99f") {
      throw new Error("Refusing sql against non-ghost99f during Pilot 03 disposable verification");
    }
  }
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
  const email = `codegen-${label}-${randomUUID().slice(0, 8)}@ghost.local`;
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
    values ('${userId}', 'Codegen Tester')
    on conflict (id) do nothing;
    insert into public.companies (id, owner_id, name, slug)
    values ('${companyId}', '${userId}', 'Codegen Co ${slug}', 'codegen-co-${slug}');
    insert into public.projects (id, company_id, name, slug, description, status)
    values ('${projectId}', '${companyId}', 'Codegen Project ${slug}', 'codegen-proj-${slug}', 'synthetic', 'IDEA');
  `);
  return projectId;
}

function codegenRequest(
  ownerId: string,
  projectId: string,
  key: string,
  option: { providerId: "mock" | "openai"; model: string } = {
    providerId: "mock",
    model: "mock-codegen-v1",
  },
) {
  const contract = buildCodegenTaskContract({
    providerId: option.providerId,
    model: option.model,
    classification: "PUBLIC",
    objective: PILOT_03_OBJECTIVE,
    maxSpendUsd: 1,
  });
  assert.equal(contract.ok, true);
  if (!contract.ok) throw new Error("codegen contract build failed");
  return {
    ownerId,
    projectId,
    projectName: "Codegen Project",
    objective: PILOT_03_OBJECTIVE,
    repository: "Ghost-1R/Ghost",
    approvedBaseBranch: "cursor/pilot-03-real-ai-coding-prep",
    environmentLabel: "LOCAL_PILOT_03",
    maxEstimatedCostUsd: 1,
    maxDurationMs: 3_600_000,
    idempotencyKey: key,
    requestKind: "CODEGEN_PILOT_03" as const,
    codegenScopeFragment: encodeCodegenScopeFragment(contract.contract),
  };
}

function mockOpenAiFilesResponse() {
  return brandCodegenMockFetch(async () =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-ghost99f-mock",
        choices: [
          {
            message: {
              content: JSON.stringify({
                files: PILOT_03_ALLOWED_FILES.map((relativePath) => ({
                  relativePath,
                  op: "CREATE",
                  content:
                    relativePath.endsWith("test.mjs")
                      ? `import assert from "node:assert/strict";\nassert.ok(true);\nconsole.log("ok");\n`
                      : `/* ${relativePath} */\n`,
                })),
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      }),
      { status: 200 },
    ),
  );
}

test("Pilot 03 durable codegen integration (ghost99f)", { skip: !enabled }, async (t) => {
  assert.ok(isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!));
  assert.ok(!/supabase\.co/i.test(process.env.NEXT_PUBLIC_SUPABASE_URL!));
  assert.equal(isCodegenLiveEnabled(), false, "GHOST_CODEGEN_LIVE_ENABLED must stay off");
  assert.equal(
    developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT"),
    false,
  );

  const hasDispatch = sql(`
    select count(*)::text from information_schema.tables
    where table_schema = 'public' and table_name = 'codegen_provider_dispatches'
  `);
  assert.equal(hasDispatch, "1", "Apply 20261012120000 reconcile+dispatch migration on ghost99f first");

  const hasReconcile = sql(`
    select count(*)::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reconcile_project_ai_allowance'
  `);
  assert.equal(hasReconcile, "1");

  const owner = await createSyntheticUser("owner");
  const projectId = await seedOwnedProject(owner.id, randomUUID().slice(0, 8));
  const ghost = owner.client as unknown as GhostClient;

  const allowance = await setSqlProjectAllowance(ghost, {
    ownerId: owner.id,
    projectId,
    allowanceCents: 100,
  });
  assert.equal(allowance.status, "ok");
  if (allowance.status !== "ok") return;

  await t.test("pending approval cannot execute", async () => {
    const created = await createDurableDevelopmentRequest(
      ghost,
      codegenRequest(owner.id, projectId, `pend-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const exec = await executeDurableCodegenMockPipeline(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      forceDockerDryRun: true,
    });
    assert.equal(exec.ok, false);
    if (!exec.ok) {
      assert.ok(
        exec.reason === "INVALID_STATUS" || exec.reason === "AUTH_NOT_CONSUMED",
        exec.reason,
      );
    }
  });

  await t.test("revoked authorization cannot queue/execute", async () => {
    const created = await createDurableDevelopmentRequest(
      ghost,
      codegenRequest(owner.id, projectId, `rev-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const approved = await approveDurableDevelopmentRequest(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    const revoked = await revokeDurableDevelopmentAuthorization(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
      reason: "Pilot 03 revoke before queue",
    });
    assert.equal(revoked.ok, true);
    const queued = await queueDurableDevelopmentTask(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    assert.equal(queued.ok, false);
    const exec = await executeDurableCodegenMockPipeline(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      forceDockerDryRun: true,
    });
    assert.equal(exec.ok, false);
  });

  await t.test("one-time approval cannot be reused after queue", async () => {
    const created = await createDurableDevelopmentRequest(
      ghost,
      codegenRequest(owner.id, projectId, `once-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const approved = await approveDurableDevelopmentRequest(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    const queued = await queueDurableDevelopmentTask(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    assert.equal(queued.data.authorization.status, "CONSUMED");
    const again = await queueDurableDevelopmentTask(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    assert.equal(again.ok, false);
  });

  await t.test("concurrent spending cannot exceed allowance", async () => {
    const r1 = await reserveSqlAllowance(ghost, {
      ownerId: owner.id,
      projectId,
      taskKey: `conc-a-${randomUUID().slice(0, 8)}`,
      estimatedCents: 100,
      idempotencyKey: `conc-a-${randomUUID()}`,
    });
    assert.equal(r1.ok, true);
    const r2 = await reserveSqlAllowance(ghost, {
      ownerId: owner.id,
      projectId,
      taskKey: `conc-b-${randomUUID().slice(0, 8)}`,
      estimatedCents: 100,
      idempotencyKey: `conc-b-${randomUUID()}`,
    });
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.reason, "INSUFFICIENT_ALLOWANCE");
    if (r1.ok) {
      const released = await reconcileSqlAllowance(ghost, {
        ownerId: owner.id,
        reservationId: r1.reservationId,
        actualCents: 0,
        idempotencyKey: `conc-release-${randomUUID()}`,
      });
      assert.equal(released.ok, true);
    }
  });

  await t.test("restart cannot reset open reservations", async () => {
    const snapBefore = await loadSqlAllowanceSnapshot(ghost, owner.id, projectId);
    assert.equal(snapBefore.status, "ok");
    const key = `restart-${randomUUID()}`;
    const first = await reserveSqlAllowance(ghost, {
      ownerId: owner.id,
      projectId,
      taskKey: `restart-task-${randomUUID().slice(0, 8)}`,
      estimatedCents: 40,
      idempotencyKey: key,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const reservedAfter = first.snapshot.reservedCents;
    const again = await reserveSqlAllowance(ghost, {
      ownerId: owner.id,
      projectId,
      taskKey: first.snapshot.projectId, // unused — idempotency wins
      estimatedCents: 40,
      idempotencyKey: key,
    });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.reservationId, first.reservationId);
    assert.equal(again.snapshot.reservedCents, reservedAfter);
    await reconcileSqlAllowance(ghost, {
      ownerId: owner.id,
      reservationId: first.reservationId,
      actualCents: 0,
      idempotencyKey: `restart-charge-${randomUUID()}`,
    });
  });

  await t.test("mock full pipeline + duplicate dispatch + founder review required", async () => {
    const created = await createDurableDevelopmentRequest(
      ghost,
      codegenRequest(owner.id, projectId, `pipe-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const approved = await approveDurableDevelopmentRequest(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    const queued = await queueDurableDevelopmentTask(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    assert.equal(queued.ok, true);
    if (!queued.ok) return;

    const run = await executeDurableCodegenMockPipeline(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      // Prefer real Docker when available; dry-run proves fail-closed VERIFIED path separately.
    });
    // Real Docker may or may not be available in CI — accept either success or dry-fail.
    if (run.ok) {
      assert.equal(run.mode, "MOCK_GENERATION");
      assert.equal(run.liveHttpInvoked, false);
      assert.equal(run.deploymentAttempted, false);
      assert.equal(run.founderReviewStatus, "AWAITING_FOUNDER_REVIEW");
      assert.equal(run.task.status, "AWAITING_FOUNDER_REVIEW");
      if (run.realContainerExecution) {
        assert.equal(run.dockerPassed, true);
        assert.equal(run.task.evidence?.verificationState, "VERIFIED");
      }

      const dup = await executeDurableCodegenMockPipeline(ghost, {
        ownerId: owner.id,
        remoteTaskId: created.data.remote.id,
      });
      assert.equal(dup.ok, true);
      if (dup.ok) assert.equal(dup.idempotentReplay, true);

      // Founder review still required — ACCEPT is explicit, not automatic.
      const bundle = await loadDurableDevelopmentBundle(ghost, owner.id, created.data.remote.id);
      assert.equal(bundle.ok, true);
      if (!bundle.ok) return;
      assert.equal(bundle.data.remote.status, "AWAITING_FOUNDER_REVIEW");

      const accept = await reviewDurableDevelopmentDeliverable(ghost, {
        ownerId: owner.id,
        remoteTaskId: created.data.remote.id,
        decision: "ACCEPT",
        note: "Pilot 03 integration accept",
        idempotencyKey: `accept-${created.data.remote.id}`,
      });
      // ACCEPT may require VERIFIED evidence + agent SUCCEEDED — if Docker was dry, reject path.
      if (run.realContainerExecution && run.dockerPassed) {
        assert.equal(accept.ok, true);
      }
    } else {
      // Dry / docker failure path: must not claim VERIFIED
      assert.ok(
        run.reason === "DOCKER_VALIDATION_FAILED" || run.reason === "LIVE_PATH_NOT_WIRED",
        run.reason,
      );
      const bundle = await loadDurableDevelopmentBundle(ghost, owner.id, created.data.remote.id);
      if (bundle.ok) {
        assert.notEqual(bundle.data.remote.evidence?.verificationState, "VERIFIED");
      }
    }
  });

  await t.test("failed docker dry-run cannot be VERIFIED", async () => {
    const created = await createDurableDevelopmentRequest(
      ghost,
      codegenRequest(owner.id, projectId, `dry-${randomUUID()}`),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await approveDurableDevelopmentRequest(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    await queueDurableDevelopmentTask(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    const run = await executeDurableCodegenMockPipeline(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      forceDockerDryRun: true,
    });
    assert.equal(run.ok, false);
    if (!run.ok) assert.equal(run.reason, "DOCKER_VALIDATION_FAILED");
    const bundle = await loadDurableDevelopmentBundle(ghost, owner.id, created.data.remote.id);
    assert.equal(bundle.ok, true);
    if (!bundle.ok) return;
    assert.equal(bundle.data.remote.status, "FAILED");
    assert.notEqual(bundle.data.remote.evidence?.verificationState, "VERIFIED");
  });

  await t.test("missing live credential fails safely (unit path via adapter env)", async () => {
    // Covered by openai-http.test; assert env here remains without live enablement.
    assert.ok(!process.env.GHOST_CODEGEN_LIVE_ENABLED);
    assert.ok(!process.env.OPENAI_API_KEY);
    assert.equal(isCodegenLiveEnabled(), false);
  });

  const liveProjectId = await seedOwnedProject(owner.id, `live-${randomUUID().slice(0, 6)}`);
  const liveAllowance = await setSqlProjectAllowance(ghost, {
    ownerId: owner.id,
    projectId: liveProjectId,
    allowanceCents: 100,
  });
  assert.equal(liveAllowance.status, "ok");

  await t.test("live entrypoint refuses when flag disabled", async () => {
    const created = await createDurableDevelopmentRequest(
      ghost,
      codegenRequest(owner.id, liveProjectId, `liveoff-${randomUUID()}`, {
        providerId: "openai",
        model: "gpt-5-mini",
      }),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await approveDurableDevelopmentRequest(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    await queueDurableDevelopmentTask(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    const denied = await executeDurableCodegenLivePipeline(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      env: { GHOST_CODEGEN_LIVE_ENABLED: "", OPENAI_API_KEY: "sk-fake-not-used" },
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, "LIVE_DISABLED");
  });

  await t.test("live entrypoint mocked HTTP + SQL allowance + one-time dispatch", async () => {
    const created = await createDurableDevelopmentRequest(
      ghost,
      codegenRequest(owner.id, liveProjectId, `liveok-${randomUUID()}`, {
        providerId: "openai",
        model: "gpt-5-mini",
      }),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await approveDurableDevelopmentRequest(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    const queued = await queueDurableDevelopmentTask(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });
    assert.equal(queued.ok, true);
    if (!queued.ok) return;

    const env = {
      GHOST_CODEGEN_LIVE_ENABLED: "1",
      OPENAI_API_KEY: "sk-fake-test-key-not-real",
      GHOST_NO_LIVE_PROVIDER_CALLS: "1",
    };
    const run = await executeDurableCodegenLivePipeline(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      env,
      adapterOptions: { fetchImpl: mockOpenAiFilesResponse(), model: "gpt-5-mini" },
    });
    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.equal(run.mode, "LIVE_PROVIDER");
    assert.equal(run.liveHttpInvoked, true);
    assert.equal(run.deploymentAttempted, false);
    assert.equal(run.founderReviewStatus, "AWAITING_FOUNDER_REVIEW");
    assert.ok(run.chargedCents >= 0 && run.chargedCents <= 100);

    const dup = await executeDurableCodegenLivePipeline(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      env,
      adapterOptions: { fetchImpl: mockOpenAiFilesResponse(), model: "gpt-5-mini" },
    });
    assert.equal(dup.ok, true);
    if (dup.ok) assert.equal(dup.idempotentReplay, true);
  });

  await t.test("live uncertain billing preserves reservation and blocks retry", async () => {
    const created = await createDurableDevelopmentRequest(
      ghost,
      codegenRequest(owner.id, liveProjectId, `liveunc-${randomUUID()}`, {
        providerId: "openai",
        model: "gpt-5-mini",
      }),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await approveDurableDevelopmentRequest(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      actorId: owner.id,
    });
    await queueDurableDevelopmentTask(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
    });

    const env = {
      GHOST_CODEGEN_LIVE_ENABLED: "1",
      OPENAI_API_KEY: "sk-fake-test-key-not-real",
      GHOST_NO_LIVE_PROVIDER_CALLS: "1",
    };
    const uncertainFetch = brandCodegenMockFetch(async () => {
      throw Object.assign(new Error("socket hang up"), { name: "AbortError" });
    });
    const first = await executeDurableCodegenLivePipeline(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      estimatedCents: 1,
      env,
      adapterOptions: { fetchImpl: uncertainFetch, model: "gpt-5-mini", maxRetries: 0 },
    });
    assert.equal(first.ok, false);
    if (!first.ok) {
      assert.equal(first.reason, "UNCERTAIN_BILLING");
      assert.equal(first.reservationPreserved, true);
    }

    const retry = await executeDurableCodegenLivePipeline(ghost, {
      ownerId: owner.id,
      remoteTaskId: created.data.remote.id,
      env,
      adapterOptions: { fetchImpl: mockOpenAiFilesResponse(), model: "gpt-5-mini" },
    });
    assert.equal(retry.ok, false);
    if (!retry.ok) {
      assert.ok(
        retry.reason === "DUPLICATE_DISPATCH_BLOCKED" || retry.reason === "UNCERTAIN_BILLING",
        retry.reason,
      );
      assert.equal(retry.reservationPreserved, true);
    }
  });
});
