import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261009010000_founder_preferences.sql"),
  "utf8",
);

test("founder_preferences migration is idempotent and force-RLS owned", () => {
  assert.match(migration, /create type public\.response_style[\s\S]*duplicate_object/i);
  assert.match(migration, /create table if not exists public\.founder_preferences/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /drop policy if exists founder_preferences_select/i);
  assert.match(migration, /grant select, insert, update on public\.founder_preferences to authenticated/i);
  assert.ok(!/grant\s+delete/i.test(migration), "preferences must not grant delete");
  assert.ok(!/to\s+anon/i.test(migration), "anon must not receive preference grants");
  assert.match(migration, /sound_volume_range check \(sound_volume >= 0 and sound_volume <= 1\)/i);
  assert.match(migration, /no backfill required/i);
});
