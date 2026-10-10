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
