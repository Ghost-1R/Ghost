/**
 * Local disposable Supabase integration tests for Founder Approval Center.
 * Skips unless GHOST_LOCAL_APPROVAL_DB_TEST=1 and URL is loopback.
 * Never targets production.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assertExecutionAuthorized,
  authorizeLocalExecution,
} from "./execution-gate";
import {
  createFounderAuthorization,
  loadAuthorizationById,
  loadAuthorizationEvents,
  loadFounderAuthorizations,
  transitionFounderAuthorization,
} from "./queries";
import { decideApprove, decideReject, decideRevoke, scopeFingerprint } from "./workflow";

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url);
}

const enabled =
  process.env.GHOST_LOCAL_APPROVAL_DB_TEST === "1" &&
  isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

function sql(query: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_ghost", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", query],
    { encoding: "utf8" },
  ).trim();
}

async function createSyntheticUser(label: string): Promise<{ id: string; client: SupabaseClient }> {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const email = `approval-${label}-${randomUUID().slice(0, 8)}@ghost.local`;
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
  return { id: created.data.user.id, client: userClient as unknown as SupabaseClient };
}

async function seedOwnedProject(userId: string, slug: string): Promise<string> {
  const companyId = randomUUID();
  const projectId = randomUUID();
  sql(`
    insert into public.profiles (id, display_name)
    values ('${userId}', 'Approval Tester')
    on conflict (id) do nothing;
    insert into public.companies (id, owner_id, name, slug)
    values ('${companyId}', '${userId}', 'Approval Co ${slug}', 'approval-co-${slug}');
    insert into public.projects (id, company_id, name, slug, description, status)
    values ('${projectId}', '${companyId}', 'Approval Project ${slug}', 'approval-proj-${slug}', 'synthetic', 'IDEA');
  `);
  return projectId;
}

test("local approval DB integration", { skip: !enabled }, async (t) => {
  assert.ok(isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!), "must use local Supabase URL");
  assert.ok(!/supabase\.co/i.test(process.env.NEXT_PUBLIC_SUPABASE_URL!));

  const owner = await createSyntheticUser("owner");
  const other = await createSyntheticUser("other");
  const projectId = await seedOwnedProject(owner.id, randomUUID().slice(0, 8));
  const foreignProjectId = await seedOwnedProject(other.id, randomUUID().slice(0, 8));

  const ghostOwner = owner.client as unknown as Parameters<typeof createFounderAuthorization>[0];
  const ghostOther = other.client as unknown as Parameters<typeof createFounderAuthorization>[0];

  const idempotencyKey = `idem-${randomUUID()}`;
  const actionType = "synthetic_local_action";
  const actionScope = `fixture:${randomUUID().slice(0, 8)}`;
  const environmentLabel = "LOCAL";
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await t.test("create request + idempotent replay", async () => {
    const first = await createFounderAuthorization(ghostOwner, owner.id, {
      projectId,
      environmentLabel,
      actionType,
      actionScope,
      reason: "Local durable approval fixture.",
      evidence: [{ source: "test", reference: "db-int-1", at: new Date().toISOString() }],
      sideEffects: "None — synthetic only",
      estimatedCost: "UNKNOWN",
      expiresAt,
      idempotencyKey,
    });
    assert.equal(first.status, "ok");
    if (first.status !== "ok") return;
    assert.equal(first.data.status, "PENDING");

    const replay = await createFounderAuthorization(ghostOwner, owner.id, {
      projectId,
      environmentLabel,
      actionType,
      actionScope,
      reason: "Local durable approval fixture.",
      evidence: [{ source: "test", reference: "db-int-1", at: new Date().toISOString() }],
      expiresAt,
      idempotencyKey,
    });
    assert.equal(replay.status, "ok");
    if (replay.status === "ok") {
      assert.equal(replay.data.id, first.data.id);
    }
  });

  const listed = await loadFounderAuthorizations(ghostOwner, owner.id);
  assert.equal(listed.status, "ok");
  const pending = listed.status === "ok" ? listed.data.find((row) => row.idempotencyKey === idempotencyKey) : null;
  assert.ok(pending);

  await t.test("cross-account cannot read or mutate", async () => {
    const hidden = await loadAuthorizationById(ghostOther, other.id, pending!.id);
    assert.equal(hidden.status, "ok");
    assert.equal(hidden.status === "ok" ? hidden.data : null, null);

    const approveAsOther = decideApprove(pending!, other.id);
    assert.equal(approveAsOther.ok, false);

    const sneaky = await transitionFounderAuthorization(ghostOther, other.id, pending!.id, {
      status: "APPROVED",
      eventType: "APPROVED",
      detail: "should fail",
    });
    assert.equal(sneaky.status, "error");
  });

  await t.test("cannot create authorization for unowned project", async () => {
    const denied = await createFounderAuthorization(ghostOwner, owner.id, {
      projectId: foreignProjectId,
      environmentLabel,
      actionType: "should_fail",
      actionScope: "nope",
      reason: "Cross project should fail closed.",
      expiresAt,
      idempotencyKey: `foreign-${randomUUID()}`,
    });
    assert.equal(denied.status, "error");
  });

  await t.test("approve / reject / revoke / expire / audit", async () => {
    const approve = decideApprove(pending!, owner.id);
    assert.equal(approve.ok, true);
    if (!approve.ok) return;
    const approved = await transitionFounderAuthorization(ghostOwner, owner.id, pending!.id, {
      status: approve.nextStatus,
      eventType: approve.eventType,
      detail: approve.detail,
    });
    assert.equal(approved.status, "ok");
    if (approved.status !== "ok") return;
    assert.equal(approved.data.status, "APPROVED");

    const events = await loadAuthorizationEvents(ghostOwner, owner.id, pending!.id);
    assert.equal(events.status, "ok");
    if (events.status === "ok") {
      assert.ok(events.data.some((event) => event.eventType === "REQUESTED"));
      assert.ok(events.data.some((event) => event.eventType === "APPROVED"));
    }

    // Reject path on a second request
    const rejectKey = `reject-${randomUUID()}`;
    const toReject = await createFounderAuthorization(ghostOwner, owner.id, {
      projectId,
      environmentLabel,
      actionType: "reject_me",
      actionScope: "scope-reject",
      reason: "Will reject",
      evidence: [{ source: "test", reference: "rej", at: null }],
      expiresAt,
      idempotencyKey: rejectKey,
    });
    assert.equal(toReject.status, "ok");
    if (toReject.status !== "ok") return;
    const rejectDecision = decideReject(toReject.data, owner.id);
    assert.equal(rejectDecision.ok, true);
    if (!rejectDecision.ok) return;
    const rejected = await transitionFounderAuthorization(ghostOwner, owner.id, toReject.data.id, {
      status: rejectDecision.nextStatus,
      eventType: rejectDecision.eventType,
      detail: rejectDecision.detail,
    });
    assert.equal(rejected.status, "ok");
    if (rejected.status === "ok") assert.equal(rejected.data.status, "REJECTED");

    // Revoke the approved one
    const revokeDecision = decideRevoke(approved.data, owner.id, "Local revoke fixture");
    assert.equal(revokeDecision.ok, true);
    if (!revokeDecision.ok) return;
    const revoked = await transitionFounderAuthorization(ghostOwner, owner.id, approved.data.id, {
      status: revokeDecision.nextStatus,
      eventType: revokeDecision.eventType,
      detail: revokeDecision.detail,
      revokeReason: "Local revoke fixture",
    });
    assert.equal(revoked.status, "ok");
    if (revoked.status === "ok") assert.equal(revoked.data.status, "REVOKED");

    // Expiry via effective status on a fresh approved row with past expires_at (SQL update as owner)
    const expireKey = `expire-${randomUUID()}`;
    const toExpire = await createFounderAuthorization(ghostOwner, owner.id, {
      projectId,
      environmentLabel,
      actionType: "expire_me",
      actionScope: "scope-expire",
      reason: "Will expire",
      evidence: [{ source: "test", reference: "exp", at: null }],
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      idempotencyKey: expireKey,
    });
    assert.equal(toExpire.status, "ok");
    if (toExpire.status !== "ok") return;
    const approveExpire = decideApprove(toExpire.data, owner.id);
    assert.ok(approveExpire.ok);
    if (!approveExpire.ok) return;
    await transitionFounderAuthorization(ghostOwner, owner.id, toExpire.data.id, {
      status: approveExpire.nextStatus,
      eventType: approveExpire.eventType,
      detail: approveExpire.detail,
    });
    sql(`
      update public.founder_action_authorizations
      set expires_at = now() - interval '1 minute'
      where id = '${toExpire.data.id}';
    `);
    const expiredRow = await loadAuthorizationById(ghostOwner, owner.id, toExpire.data.id);
    assert.equal(expiredRow.status, "ok");
    if (expiredRow.status === "ok" && expiredRow.data) {
      assert.equal(expiredRow.data.effectiveStatus, "EXPIRED");
      const gate = assertExecutionAuthorized(expiredRow.data, {
        authorizationId: expiredRow.data.id,
        ownerId: owner.id,
        projectId,
        actionType: "expire_me",
        actionScope: "scope-expire",
        environmentLabel,
      });
      assert.equal(gate.ok, false);
      if (!gate.ok) assert.equal(gate.reason, "EXPIRED");
    }
  });

  await t.test("execution gate + concurrent consumption", async () => {
    const key = `exec-${randomUUID()}`;
    const created = await createFounderAuthorization(ghostOwner, owner.id, {
      projectId,
      environmentLabel,
      actionType,
      actionScope: `exec-${key}`,
      reason: "Executor revalidation fixture",
      evidence: [{ source: "test", reference: "exec", at: null }],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      idempotencyKey: key,
    });
    assert.equal(created.status, "ok");
    if (created.status !== "ok") return;
    const approvedDecision = decideApprove(created.data, owner.id);
    assert.ok(approvedDecision.ok);
    if (!approvedDecision.ok) return;
    const approved = await transitionFounderAuthorization(ghostOwner, owner.id, created.data.id, {
      status: approvedDecision.nextStatus,
      eventType: approvedDecision.eventType,
      detail: approvedDecision.detail,
    });
    assert.equal(approved.status, "ok");
    if (approved.status !== "ok") return;

    const execRequest = {
      authorizationId: approved.data.id,
      ownerId: owner.id,
      projectId,
      actionType,
      actionScope: `exec-${key}`,
      environmentLabel,
    };

    // Approving never auto-executes — gate must be called explicitly.
    assert.equal(approved.data.useCount, 0);
    assert.equal(approved.data.status, "APPROVED");

    const [first, second] = await Promise.all([
      authorizeLocalExecution(ghostOwner, { ...execRequest, recordConsumption: true }),
      authorizeLocalExecution(ghostOwner, { ...execRequest, recordConsumption: true }),
    ]);
    const outcomes = [first, second];
    const wins = outcomes.filter((row) => row.ok);
    const losses = outcomes.filter((row) => !row.ok);
    assert.equal(wins.length, 1);
    assert.equal(losses.length, 1);
    if (!losses[0]!.ok) {
      assert.ok(
        losses[0].reason === "USES_EXHAUSTED" ||
          losses[0].reason === "CONSUMED" ||
          losses[0].reason === "LOAD_FAILED",
      );
    }

    const after = await loadAuthorizationById(ghostOwner, owner.id, approved.data.id);
    assert.equal(after.status, "ok");
    if (after.status === "ok" && after.data) {
      assert.equal(after.data.status, "CONSUMED");
      assert.equal(after.data.useCount, 1);
      const replay = assertExecutionAuthorized(after.data, execRequest);
      assert.equal(replay.ok, false);
    }
  });

  await t.test("DELETE privilege denied for authenticated", async () => {
    const { data, error } = await owner.client
      .from("founder_action_authorizations")
      .delete()
      .eq("id", pending!.id);
    void data;
    assert.ok(error, "authenticated DELETE must fail closed");
  });

  await t.test("UI durability — rows remain after reload queries", async () => {
    const again = await loadFounderAuthorizations(ghostOwner, owner.id);
    assert.equal(again.status, "ok");
    if (again.status === "ok") {
      assert.ok(again.data.length >= 1);
      assert.ok(again.data.every((row) => row.ownerId === owner.id));
      assert.ok(
        again.data.every(
          (row) =>
            row.scopeFingerprint ===
            scopeFingerprint({
              projectId: row.projectId,
              actionType: row.actionType,
              actionScope: row.actionScope,
              environmentLabel: row.environmentLabel,
            }),
        ),
      );
    }
  });
});
