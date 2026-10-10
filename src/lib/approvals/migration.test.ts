import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const primary = readFileSync(
  path.join(root, "supabase/migrations/20261010090000_founder_action_authorizations.sql"),
  "utf8",
);
const privileges = readFileSync(
  path.join(root, "supabase/migrations/20261010090100_founder_action_authorizations_privileges.sql"),
  "utf8",
);

test("approval migration enforces owner + project isolation with FORCE RLS", () => {
  assert.match(primary, /force row level security/i);
  assert.match(primary, /owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(primary, /private\.owns_project\(project_id\)/i);
  assert.match(primary, /scope_fingerprint/i);
  assert.match(primary, /expires_at/i);
  assert.match(primary, /revoked_at/i);
  assert.match(primary, /founder_authorization_events/i);
  assert.ok(!/security definer/i.test(primary));
  assert.ok(!/for delete/i.test(primary));
});

test("privilege hardening revokes DELETE and anon access", () => {
  assert.match(privileges, /revoke all on table public\.founder_action_authorizations from anon/i);
  assert.match(privileges, /revoke all on table public\.founder_action_authorizations from authenticated/i);
  assert.match(privileges, /grant select, insert, update on public\.founder_action_authorizations to authenticated/i);
  assert.match(privileges, /grant select, insert on public\.founder_authorization_events to authenticated/i);
  assert.ok(!/grant delete/i.test(privileges));
  assert.ok(!/security definer/i.test(privileges));
});

test("migrations are marked local-only and forbid hosted apply without founder gate", () => {
  assert.match(primary, /LOCAL ONLY/i);
  assert.match(privileges, /LOCAL ONLY/i);
  assert.match(primary, /Do not apply to hosted Supabase/i);
});
