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
  assert.match(migration, /agent_tasks_owner_idempotency/);
});
