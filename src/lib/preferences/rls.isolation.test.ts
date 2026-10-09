import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * Static ownership contract for founder_preferences.
 * Live SQL isolation is verified against local Supabase in Build 08.1 (policies authenticated-only).
 */
test("preferences policies bind every command to auth.uid owner_id", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261009010000_founder_preferences.sql"),
    "utf8",
  );
  for (const name of ["select", "insert", "update"] as const) {
    assert.match(sql, new RegExp(`founder_preferences_${name}[\\s\\S]*auth\\.uid\\(\\)`, "i"));
  }
  assert.ok(!/for delete/i.test(sql));
  assert.match(sql, /force row level security/i);
});
