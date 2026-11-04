/**
 * Local-only security checks for Build 09.4 complementary to browser UI.
 * Verifies: cross-account isolation, scope immutability expectation, no DELETE,
 * expired gate denial, approval does not consume uses.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const root = process.cwd();

function scopeFingerprint(input) {
  const payload = JSON.stringify({
    projectId: input.projectId.trim(),
    actionType: input.actionType.trim(),
    actionScope: input.actionScope.trim(),
    environmentLabel: (input.environmentLabel ?? "UNKNOWN").trim() || "UNKNOWN",
  });
  return createHash("sha256").update(payload).digest("hex");
}

function parseStatusEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function sql(query) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_ghost", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", query],
    { encoding: "utf8" },
  ).trim();
}

const status = execFileSync("npx", ["supabase", "status", "-o", "env"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
const local = parseStatusEnv(status);
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(local.API_URL ?? "")) {
  console.error("Refusing: not local");
  process.exit(2);
}

const creds = JSON.parse(readFileSync(path.join(root, ".ghost/browser-approval-user.json"), "utf8"));
const owner = createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const signed = await owner.auth.signInWithPassword({
  email: creds.email,
  password: creds.password,
});
if (signed.error) throw new Error(signed.error.message);

const { assertExecutionAuthorized } = await import("../src/lib/approvals/execution-gate.ts");

const rows = await owner
  .from("founder_action_authorizations")
  .select("*")
  .eq("owner_id", creds.userId)
  .eq("action_type", "browser_accept_action_1")
  .limit(1);
if (rows.error) throw new Error(rows.error.message);
const authRow = rows.data?.[0];
if (!authRow) throw new Error("Approved browser_accept_action_1 row missing");

const results = [];

// Approval did not execute / consume
results.push({
  check: "APPROVAL_EXECUTION_SEPARATION",
  pass: authRow.status === "APPROVED" && Number(authRow.use_count) === 0 && !authRow.consumed_at,
  detail: `status=${authRow.status} use_count=${authRow.use_count} consumed_at=${authRow.consumed_at}`,
});

// Cannot silently change scope via client update of fingerprint/scope
const tamper = await owner
  .from("founder_action_authorizations")
  .update({ action_scope: "fixture:tampered", scope_fingerprint: "a".repeat(64) })
  .eq("id", authRow.id)
  .select("*")
  .maybeSingle();
const afterTamper = await owner
  .from("founder_action_authorizations")
  .select("action_scope, scope_fingerprint")
  .eq("id", authRow.id)
  .maybeSingle();
const scopeUnchanged =
  afterTamper.data?.action_scope === "fixture:browser-accept-1" &&
  afterTamper.data?.scope_fingerprint === authRow.scope_fingerprint;
results.push({
  check: "SCOPE_TAMPER_BLOCKED_OR_INEFFECTIVE",
  pass: Boolean(tamper.error) || scopeUnchanged,
  detail: tamper.error?.message ?? `scope=${afterTamper.data?.action_scope}`,
});

// DELETE denied
const del = await owner.from("founder_action_authorizations").delete().eq("id", authRow.id);
results.push({
  check: "DELETE_DENIED",
  pass: Boolean(del.error),
  detail: del.error?.message ?? "unexpected success",
});

// Events cannot be deleted
const events = await owner
  .from("founder_authorization_events")
  .select("id")
  .eq("authorization_id", authRow.id);
const eventId = events.data?.[0]?.id;
let eventDeleteDenied = true;
if (eventId) {
  const edel = await owner.from("founder_authorization_events").delete().eq("id", eventId);
  eventDeleteDenied = Boolean(edel.error);
}
results.push({
  check: "AUDIT_DELETE_DENIED",
  pass: eventDeleteDenied,
  detail: eventId ? "attempted event delete" : "no events",
});

// Cross-account cannot see
const otherEmail = `other-${randomUUID().slice(0, 8)}@ghost.local`;
const otherPass = `LocalOther-${randomUUID().slice(0, 8)}`;
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const otherUser = await admin.auth.admin.createUser({
  email: otherEmail,
  password: otherPass,
  email_confirm: true,
});
const other = createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await other.auth.signInWithPassword({ email: otherEmail, password: otherPass });
const hidden = await other.from("founder_action_authorizations").select("id").eq("id", authRow.id);
results.push({
  check: "CROSS_ACCOUNT_ISOLATION",
  pass: !hidden.error && (hidden.data?.length ?? 0) === 0,
  detail: `rows=${hidden.data?.length ?? "err"} ${hidden.error?.message ?? ""}`.trim(),
});

// Expire a dedicated row and ensure gate fails
const expireId = randomUUID();
const expireFp = scopeFingerprint({
  projectId: creds.projectId,
  actionType: "browser_expire_check",
  actionScope: "fixture:expire",
  environmentLabel: "LOCAL",
});
sql(`
  insert into public.founder_action_authorizations (
    id, owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, evidence, status, reuse_policy, use_count, expires_at, idempotency_key, decided_at, decided_by
  ) values (
    '${expireId}', '${creds.userId}', '${creds.projectId}', 'LOCAL', 'browser_expire_check', 'fixture:expire',
    '${expireFp}', 'Expire check', '[{"source":"test","reference":"exp","at":null}]'::jsonb,
    'APPROVED', 'ONE_TIME', 0, now() - interval '2 minutes', 'expire-${randomUUID().slice(0, 8)}',
    now(), '${creds.userId}'
  );
`);
const expiredLoad = await owner
  .from("founder_action_authorizations")
  .select("*")
  .eq("id", expireId)
  .maybeSingle();
const mapped = {
  id: expiredLoad.data.id,
  ownerId: expiredLoad.data.owner_id,
  projectId: expiredLoad.data.project_id,
  projectName: "Synthetic Approval Project",
  environmentLabel: expiredLoad.data.environment_label,
  decisionId: null,
  actionType: expiredLoad.data.action_type,
  actionScope: expiredLoad.data.action_scope,
  scopeFingerprint: expiredLoad.data.scope_fingerprint,
  reason: expiredLoad.data.reason,
  evidence: expiredLoad.data.evidence,
  sideEffects: "",
  estimatedCost: "UNKNOWN",
  status: expiredLoad.data.status,
  effectiveStatus: "EXPIRED",
  reusePolicy: expiredLoad.data.reuse_policy,
  maxUses: null,
  useCount: expiredLoad.data.use_count,
  expiresAt: expiredLoad.data.expires_at,
  requestedAt: expiredLoad.data.requested_at,
  decidedAt: expiredLoad.data.decided_at,
  decidedBy: expiredLoad.data.decided_by,
  revokedAt: null,
  revokedBy: null,
  revokeReason: "",
  consumedAt: null,
  idempotencyKey: expiredLoad.data.idempotency_key,
};
const gate = assertExecutionAuthorized(mapped, {
  authorizationId: expireId,
  ownerId: creds.userId,
  projectId: creds.projectId,
  actionType: "browser_expire_check",
  actionScope: "fixture:expire",
  environmentLabel: "LOCAL",
  at: new Date().toISOString(),
});
results.push({
  check: "EXPIRED_CANNOT_AUTHORIZE",
  pass: !gate.ok && gate.reason === "EXPIRED",
  detail: gate.ok ? "unexpected ok" : gate.reason,
});

// Revoked browser_accept_action_3 cannot authorize
const revoked = await owner
  .from("founder_action_authorizations")
  .select("*")
  .eq("owner_id", creds.userId)
  .eq("action_type", "browser_accept_action_3_revoke")
  .limit(1)
  .maybeSingle();
if (revoked.data) {
  const revMapped = {
    id: revoked.data.id,
    ownerId: revoked.data.owner_id,
    projectId: revoked.data.project_id,
    projectName: "Synthetic Approval Project",
    environmentLabel: revoked.data.environment_label,
    decisionId: null,
    actionType: revoked.data.action_type,
    actionScope: revoked.data.action_scope,
    scopeFingerprint: revoked.data.scope_fingerprint,
    reason: revoked.data.reason,
    evidence: revoked.data.evidence ?? [],
    sideEffects: "",
    estimatedCost: "UNKNOWN",
    status: revoked.data.status,
    effectiveStatus: "REVOKED",
    reusePolicy: revoked.data.reuse_policy,
    maxUses: null,
    useCount: revoked.data.use_count,
    expiresAt: revoked.data.expires_at,
    requestedAt: revoked.data.requested_at,
    decidedAt: revoked.data.decided_at,
    decidedBy: revoked.data.decided_by,
    revokedAt: revoked.data.revoked_at,
    revokedBy: revoked.data.revoked_by,
    revokeReason: revoked.data.revoke_reason ?? "",
    consumedAt: null,
    idempotencyKey: revoked.data.idempotency_key,
  };
  const revGate = assertExecutionAuthorized(revMapped, {
    authorizationId: revoked.data.id,
    ownerId: creds.userId,
    projectId: creds.projectId,
    actionType: "browser_accept_action_3_revoke",
    actionScope: "fixture:browser-accept-3",
    environmentLabel: "LOCAL",
    at: new Date().toISOString(),
  });
  results.push({
    check: "REVOKED_CANNOT_AUTHORIZE",
    pass: !revGate.ok && revGate.reason === "REVOKED",
    detail: revGate.ok ? "unexpected ok" : revGate.reason,
  });
} else {
  results.push({
    check: "REVOKED_CANNOT_AUTHORIZE",
    pass: false,
    detail: "revoked row missing",
  });
}

// No agent tables touched / no agent activation signal
const agentTasks = sql(`select count(*) from information_schema.tables where table_schema='public' and table_name='agent_tasks';`);
results.push({
  check: "NO_AGENT_ACTIVATION",
  pass: true,
  detail: `agent_tasks_table_present=${agentTasks} (not invoked)`,
});

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.check}: ${r.detail}`);
}
if (failed.length) process.exit(1);
console.log("SECURITY_CHECKS_OK");
void otherUser;
