import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = readFileSync(
  path.join(root, "supabase/migrations/20261010090600_agent_tasks_approval_bound.sql"),
  "utf8",
);

test("agent task migration is local-only and forbids hosted apply without founder gate", () => {
  assert.match(migration, /LOCAL ONLY/i);
  assert.match(migration, /Do not apply to hosted Supabase/i);
  assert.match(migration, /Never stores secrets/i);
});

test("agent task migration binds to founder authorization with immutable identity guard", () => {
  assert.match(migration, /founder_action_authorizations/);
  assert.match(migration, /authorization_id/);
  assert.match(migration, /scope_fingerprint/);
  assert.match(migration, /authorization_kind/);
  assert.match(migration, /DEVELOPMENT/);
  assert.match(migration, /DEPLOYMENT/);
  assert.match(migration, /guard_agent_task_authorization_binding/);
  assert.match(migration, /authorization binding fields cannot be rewritten/i);
  assert.match(migration, /terminal agent task status cannot change/i);
});

test("agent task migration enforces owner + project isolation with FORCE RLS and no DELETE", () => {
  assert.match(migration, /force row level security/i);
  assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /private\.owns_project\(project_id\)/i);
  assert.match(migration, /agent_task_events/);
  assert.match(migration, /agent_task_checkpoints/);
  assert.ok(!/for delete/i.test(migration));
  assert.ok(!/security definer/i.test(migration));
  assert.ok(!/grant delete/i.test(migration));
});

test("privilege hardening revokes anon and DELETE while granting select/insert/update", () => {
  assert.match(migration, /revoke all on table public\.agent_tasks from anon/i);
  assert.match(migration, /revoke all on table public\.agent_tasks from authenticated/i);
  assert.match(migration, /grant select, insert, update on public\.agent_tasks to authenticated/i);
  assert.match(migration, /grant select, insert on public\.agent_task_events to authenticated/i);
  assert.match(migration, /grant select, insert on public\.agent_task_checkpoints to authenticated/i);
});

test("lease and checkpoint columns support claim and step recovery", () => {
  assert.match(migration, /lease_holder_id/);
  assert.match(migration, /lease_token/);
  assert.match(migration, /lease_expires_at/);
  assert.match(migration, /checkpoint_sequence/);
  assert.match(migration, /last_step_idempotency_key/);
  assert.match(migration, /authorization_consumed/);
  assert.match(migration, /agent_tasks_owner_idempotency/);
});

const matchMigration = readFileSync(
  path.join(root, "supabase/migrations/20261011092000_agent_tasks_authorization_match.sql"),
  "utf8",
);

test("09.9E match migration enforces insert/update authorization binding equality", () => {
  assert.match(matchMigration, /LOCAL ONLY/i);
  assert.match(matchMigration, /Do not apply to hosted Supabase/i);
  assert.match(matchMigration, /assert_agent_task_matches_authorization/);
  assert.match(matchMigration, /before insert or update/i);
  assert.match(matchMigration, /does not match authorization identity/i);
  assert.match(matchMigration, /authorization_kind does not match action_type class/i);
  assert.match(matchMigration, /agent_task\.develop/);
  assert.match(matchMigration, /agent_task\.deploy/);
});

const revokedExpiredMigration = readFileSync(
  path.join(root, "supabase/migrations/20261011100000_agent_tasks_reject_revoked_expired_auth.sql"),
  "utf8",
);

test("Pilot 01 migration rejects revoked/expired NEW agent_task binds only on INSERT", () => {
  assert.match(revokedExpiredMigration, /LOCAL ONLY/i);
  assert.match(revokedExpiredMigration, /Do not apply to hosted Supabase/i);
  assert.match(revokedExpiredMigration, /tg_op = 'INSERT'/);
  assert.match(revokedExpiredMigration, /cannot bind to revoked, rejected, or expired authorization/);
  assert.match(revokedExpiredMigration, /cannot bind to time-expired authorization/);
  assert.match(revokedExpiredMigration, /APPROVED or CONSUMED/);
  assert.ok(!/drop table/i.test(revokedExpiredMigration));
});
