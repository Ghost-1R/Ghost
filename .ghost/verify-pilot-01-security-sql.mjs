/**
 * Pilot 01 — real SQL regression for revoked/expired bind gate on ghost99f only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTAINER = "supabase_db_ghost99f";
const evidenceDir = path.join(root, ".ghost", "pilot-01", "evidence");
mkdirSync(evidenceDir, { recursive: true });

function assertIsolation() {
  const inspect = JSON.parse(execFileSync("docker", ["inspect", CONTAINER], { encoding: "utf8" }))[0];
  const hostPort = inspect?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  const networks = Object.keys(inspect?.NetworkSettings?.Networks ?? {});
  if (hostPort !== "55432") throw new Error(`Bad port ${hostPort}`);
  if (networks.includes("supabase_network_ghost")) throw new Error("Ghost network");
  const ghost = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0];
  const ghostPort = ghost?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  if (ghostPort !== "54322") throw new Error(`Ghost port unexpected ${ghostPort}`);
  return { hostPort, networks, ghostPort };
}

function psql(sql, { roleSub } = {}) {
  const full = roleSub
    ? `begin;\nset local role authenticated;\ndo $$ begin perform set_config('request.jwt.claim.sub', '${roleSub}', true); end $$;\n${sql}\ncommit;`
    : sql;
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
    { input: full, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const err = new Error((result.stderr || result.stdout || "psql failed").trim());
    err.sql = sql;
    throw err;
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lines = (result.stdout || "")
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(BEGIN|COMMIT|SET|INSERT|UPDATE|DELETE|SELECT)/i.test(l));
  const ids = lines.filter((l) => uuid.test(l));
  if (ids.length === 1) return ids[0];
  return lines.join("\n");
}

function fp(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function rejected(msg) {
  return /cannot bind|does not match|does not reference|42501|23503|exception|approved|expired|revoked/i.test(
    msg,
  );
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, result: ok ? "PASS" : "FAIL", detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${String(detail).slice(0, 220)}`);
}

const isolation = assertIsolation();
record("ISOLATION", true, JSON.stringify(isolation));

const owner = randomUUID();
const other = randomUUID();
const company = randomUUID();
const project = randomUUID();
const foreignCompany = randomUUID();
const foreignProject = randomUUID();
const ACTION = "agent_task.develop";
const ENV = "LOCAL_PILOT";
const slugTag = randomUUID().slice(0, 8);

psql(`
insert into auth.users (id, email) values
  ('${owner}', 'pilot01-owner-${slugTag}@ghost.local'),
  ('${other}', 'pilot01-other-${slugTag}@ghost.local')
on conflict (id) do nothing;
insert into public.profiles (id, display_name) values
  ('${owner}', 'Pilot Owner'),
  ('${other}', 'Pilot Other')
on conflict (id) do nothing;
insert into public.companies (id, owner_id, name, slug) values
  ('${company}', '${owner}', 'Pilot Co', 'pilot-co-${slugTag}'),
  ('${foreignCompany}', '${other}', 'Other Co', 'other-co-${slugTag}')
on conflict (id) do nothing;
insert into public.projects (id, company_id, name, slug, description, status) values
  ('${project}', '${company}', 'Pilot Proj', 'pilot-proj-${slugTag}', 'synthetic', 'IDEA'),
  ('${foreignProject}', '${foreignCompany}', 'Other Proj', 'other-proj-${slugTag}', 'synthetic', 'IDEA')
on conflict (id) do nothing;
`);

function insertAuth({ status, scope, expiresSql, extra = "" }) {
  const fingerprint = fp([ENV, ACTION, scope]);
  return psql(
    `
    insert into public.founder_action_authorizations (
      owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
      reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by
      ${extra.includes("revoked") ? ", revoked_at, revoked_by, revoke_reason" : ""}
      ${extra.includes("consumed") ? ", use_count, consumed_at" : ""}
    ) values (
      '${owner}', '${project}', '${ENV}', '${ACTION}', '${scope}', '${fingerprint}',
      'pilot 01 security fixture', '${status}', 'ONE_TIME', ${expiresSql},
      'p01-${scope}-${randomUUID().slice(0, 8)}', now(), '${owner}'
      ${extra.includes("revoked") ? `, now(), '${owner}', 'stop'` : ""}
      ${extra.includes("consumed") ? ", 1, now()" : ""}
    ) returning id;
    `,
    { roleSub: owner },
  );
}

function tryTask({ authId, scope, kind = "DEVELOPMENT", projectId = project, ownerId = owner, env = ENV, fingerprintOverride }) {
  const fingerprint = fingerprintOverride ?? fp([ENV, ACTION, scope]);
  return psql(
    `
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key, authorization_consumed
    ) values (
      '${ownerId}', '${projectId}', 'QUEUED', '${authId}', '${kind}',
      '${ACTION}', '${scope}', '${env}', '${fingerprint}', 'p01-task-${randomUUID().slice(0, 8)}', true
    ) returning id;
    `,
    { roleSub: owner },
  );
}

// Missing authorization
try {
  tryTask({ authId: randomUUID(), scope: "missing" });
  record("MISSING_AUTH_REJECTED", false, "insert succeeded");
} catch (e) {
  record("MISSING_AUTH_REJECTED", rejected(e.message) || /foreign key|23503/i.test(e.message), e.message);
}

const authRevoked = insertAuth({
  status: "REVOKED",
  scope: "revoked",
  expiresSql: "now() + interval '1 hour'",
  extra: "revoked",
});
try {
  tryTask({ authId: authRevoked, scope: "revoked" });
  record("REVOKED_REJECTED", false, "insert succeeded");
} catch (e) {
  record("REVOKED_REJECTED", /revoked|rejected|expired/i.test(e.message), e.message);
}

const authRejected = insertAuth({
  status: "REJECTED",
  scope: "rejected",
  expiresSql: "now() + interval '1 hour'",
});
try {
  tryTask({ authId: authRejected, scope: "rejected" });
  record("REJECTED_REJECTED", false, "insert succeeded");
} catch (e) {
  record("REJECTED_REJECTED", /revoked|rejected|expired/i.test(e.message), e.message);
}

const authExpiredStatus = insertAuth({
  status: "EXPIRED",
  scope: "expired-status",
  expiresSql: "now() - interval '1 minute'",
});
try {
  tryTask({ authId: authExpiredStatus, scope: "expired-status" });
  record("EXPIRED_STATUS_REJECTED", false, "insert succeeded");
} catch (e) {
  record("EXPIRED_STATUS_REJECTED", /expired|revoked|rejected|time-expired/i.test(e.message), e.message);
}

const authTimeExpired = insertAuth({
  status: "APPROVED",
  scope: "time-expired",
  expiresSql: "now() - interval '1 minute'",
});
try {
  tryTask({ authId: authTimeExpired, scope: "time-expired" });
  record("TIME_EXPIRED_REJECTED", false, "insert succeeded");
} catch (e) {
  record("TIME_EXPIRED_REJECTED", /time-expired|expired/i.test(e.message), e.message);
}

const authPending = insertAuth({
  status: "PENDING",
  scope: "pending",
  expiresSql: "now() + interval '1 hour'",
});
try {
  tryTask({ authId: authPending, scope: "pending" });
  record("PENDING_REJECTED", false, "insert succeeded");
} catch (e) {
  record("PENDING_REJECTED", /APPROVED or CONSUMED|cannot bind/i.test(e.message), e.message);
}

const authApproved = insertAuth({
  status: "APPROVED",
  scope: "approved-ok",
  expiresSql: "now() + interval '1 hour'",
});
let approvedTaskId;
try {
  approvedTaskId = tryTask({ authId: authApproved, scope: "approved-ok" });
  record("APPROVED_ACCEPTED", Boolean(approvedTaskId), `task=${approvedTaskId}`);
} catch (e) {
  record("APPROVED_ACCEPTED", false, e.message);
}

const authConsumed = insertAuth({
  status: "CONSUMED",
  scope: "consumed-ok",
  expiresSql: "now() + interval '1 hour'",
  extra: "consumed",
});
let consumedTaskId;
try {
  consumedTaskId = tryTask({ authId: authConsumed, scope: "consumed-ok" });
  record("CONSUMED_ACCEPTED", Boolean(consumedTaskId), `task=${consumedTaskId}`);
} catch (e) {
  record("CONSUMED_ACCEPTED", false, e.message);
}

// Scope mismatch still rejected
try {
  tryTask({
    authId: authApproved,
    scope: "WRONG",
    fingerprintOverride: fp(["wrong"]),
  });
  record("SCOPE_MISMATCH_REJECTED", false, "succeeded");
} catch (e) {
  record("SCOPE_MISMATCH_REJECTED", /does not match authorization identity/i.test(e.message), e.message);
}

// Kind mismatch
try {
  tryTask({ authId: authApproved, scope: "approved-ok", kind: "DEPLOYMENT" });
  record("DEPLOYMENT_FROM_DEV_REJECTED", false, "succeeded");
} catch (e) {
  record("DEPLOYMENT_FROM_DEV_REJECTED", /authorization_kind|action_type class/i.test(e.message), e.message);
}

// UPDATE cannot rewrite binding
try {
  psql(`update public.agent_tasks set action_scope='mutated' where id='${approvedTaskId}';`, { roleSub: owner });
  record("UPDATE_BINDING_BLOCKED", false, "rewrite succeeded");
} catch (e) {
  record("UPDATE_BINDING_BLOCKED", /cannot be rewritten|does not match/i.test(e.message), e.message);
}

// Checkpoint on consumed task still works (UPDATE non-binding)
try {
  const ck = psql(
    `
    insert into public.agent_task_checkpoints (
      task_id, owner_id, sequence, label, progress_ref, authorization_id, scope_fingerprint
    ) values (
      '${consumedTaskId}', '${owner}', 1, 'pilot-step', 'ref:pilot', '${authConsumed}', '${fp([ENV, ACTION, "consumed-ok"])}'
    ) returning id;
    `,
    { roleSub: owner },
  );
  psql(
    `update public.agent_tasks set last_checkpoint_id='${ck}', checkpoint_sequence=1, status='CHECKPOINT' where id='${consumedTaskId}';`,
    { roleSub: owner },
  );
  record("CHECKPOINT_AFTER_CONSUMED_BIND", Boolean(ck), `checkpoint=${ck}`);
} catch (e) {
  record("CHECKPOINT_AFTER_CONSUMED_BIND", false, e.message);
}

// Cross-account read
const hidden = psql(`select count(*)::text from public.agent_tasks where id='${approvedTaskId}';`, { roleSub: other });
record("CROSS_ACCOUNT_ISOLATION", hidden === "0", `rows=${hidden}`);

const summary = {
  isolation,
  results,
  passed: results.filter((r) => r.result === "PASS").length,
  failed: results.filter((r) => r.result === "FAIL").length,
  at: new Date().toISOString(),
};
writeFileSync(path.join(evidenceDir, "security-sql-verification.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed }, null, 2));
process.exit(summary.failed === 0 ? 0 : 1);
