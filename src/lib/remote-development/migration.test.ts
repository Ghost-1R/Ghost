import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261010091000_remote_development_tasks.sql"),
  "utf8",
);

test("remote development migration is local-only with RLS and no deploy permission", () => {
  assert.match(migration, /LOCAL ONLY/i);
  assert.match(migration, /Do not apply to hosted Supabase/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /deployment_authorized = false/);
  assert.match(migration, /authorization_kind = 'DEVELOPMENT'/);
  assert.match(migration, /founder_action_authorizations/);
  assert.match(migration, /guard_remote_dev_task_binding/);
  assert.match(migration, /remote_provider_webhook_events/);
  assert.ok(!/for delete/i.test(migration));
  assert.ok(!/grant delete/i.test(migration));
});

test("binding guard and update RLS freeze kind, environment, and git target", () => {
  assert.match(migration, /new\.environment_label is distinct from old\.environment_label/);
  assert.match(migration, /new\.authorization_kind is distinct from old\.authorization_kind/);
  assert.match(migration, /new\.repository is distinct from old\.repository/);
  assert.match(migration, /new\.approved_base_branch is distinct from old\.approved_base_branch/);
  assert.match(migration, /new\.authorization_kind is distinct from 'DEVELOPMENT'/);
  // Update policy must keep DEVELOPMENT kind (not only insert).
  const updatePolicy = migration.slice(migration.indexOf("remote_development_tasks_update"));
  assert.match(updatePolicy, /authorization_kind = 'DEVELOPMENT'/);
});

test("09.13 link migration is present and local-only", () => {
  const link = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261010091300_remote_dev_agent_task_link.sql"),
    "utf8",
  );
  assert.match(link, /LOCAL ONLY/i);
  assert.match(link, /agent_task_id/);
  assert.match(link, /references public\.agent_tasks/);
  assert.match(link, /remote_development_review_events/);
  assert.match(link, /guard_remote_dev_agent_task_link/);
});
