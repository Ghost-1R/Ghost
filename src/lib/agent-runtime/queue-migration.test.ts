import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261010090800_agent_worker_queue_and_artifacts.sql"),
  "utf8",
);

test("09.8 queue/artifact migration is local-only with no public publish", () => {
  assert.match(migration, /LOCAL ONLY/i);
  assert.match(migration, /Do not apply to hosted Supabase/i);
  assert.match(migration, /agent_worker_queue/);
  assert.match(migration, /agent_review_artifacts/);
  assert.match(migration, /agent_private_previews/);
  assert.match(migration, /publicly_published = false/);
  assert.match(migration, /FOUNDER_PRIVATE/);
  assert.match(migration, /force row level security/i);
  assert.ok(!/for delete/i.test(migration));
  assert.ok(!/grant delete/i.test(migration));
});
