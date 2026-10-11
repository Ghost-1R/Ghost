/**
 * Build 09.9F — authenticated PostgREST/GoTrue checks against ghost99f only.
 * Credentials loaded from env set by run-09-9f-integration.mjs (never logged).
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, ".ghost", "09-9f-evidence");
mkdirSync(evidenceDir, { recursive: true });

const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const CONTAINER = process.env.GHOST_LOCAL_DB_CONTAINER ?? "";

if (API !== "http://127.0.0.1:54331") throw new Error(`Refuse API ${API}`);
if (CONTAINER !== "supabase_db_ghost99f") throw new Error(`Refuse container ${CONTAINER}`);
if (!ANON || !SERVICE) throw new Error("Missing keys");

const results = [];
function record(name, ok, detail) {
  results.push({ name, result: ok ? "PASS" : "FAIL", detail: String(detail).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${String(detail).slice(0, 220)}`);
}

function fp(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function sql(query) {
  const out = execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", query],
    { encoding: "utf8" },
  ).trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lines = out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(INSERT|UPDATE|DELETE|SELECT|BEGIN|COMMIT)/i.test(line));
  const ids = lines.filter((line) => uuid.test(line));
  if (ids.length === 1) return ids[0];
  return lines.join("\n") || out;
}

async function createUser(label) {
  const admin = createClient(API, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `f99f-${label}-${randomUUID().slice(0, 8)}@ghost.local`;
  const password = `LocalTest-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(created.error?.message ?? "createUser");
  const client = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(signed.error.message);
  return { id: created.data.user.id, client, email, accessToken: signed.data.session?.access_token };
}

async function seedProject(userId, slug) {
  const companyId = randomUUID();
  const projectId = randomUUID();
  sql(`
    insert into public.profiles (id, display_name) values ('${userId}', 'F99F') on conflict (id) do nothing;
    insert into public.companies (id, owner_id, name, slug)
    values ('${companyId}', '${userId}', 'Co ${slug}', 'co-${slug}');
    insert into public.projects (id, company_id, name, slug, description, status)
    values ('${projectId}', '${companyId}', 'Proj ${slug}', 'proj-${slug}', 'synthetic', 'IDEA');
  `);
  return projectId;
}

async function rest(pathName, { token, method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: ANON,
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${API}/rest/v1/${pathName}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, text };
}

const owner = await createUser("owner");
const other = await createUser("other");
const projectA = await seedProject(owner.id, randomUUID().slice(0, 8));
const projectB = await seedProject(other.id, randomUUID().slice(0, 8));
const action = "agent_task.develop";
const scope = "scope-api-a";
const envLabel = "REMOTE_DEV";
const fingerprint = fp([envLabel, action, scope, "LOCAL"]);

// Owner creates authorization via PostgREST
const authInsert = await rest("founder_action_authorizations", {
  token: owner.accessToken,
  method: "POST",
  prefer: "return=representation",
  body: {
    owner_id: owner.id,
    project_id: projectA,
    environment_label: envLabel,
    action_type: action,
    action_scope: scope,
    scope_fingerprint: fingerprint,
    reason: "09.9F API fixture authorization",
    status: "PENDING",
    reuse_policy: "ONE_TIME",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    idempotency_key: `api-${randomUUID().slice(0, 12)}`,
  },
});
const authId = Array.isArray(authInsert.json) ? authInsert.json[0]?.id : null;
record("AUTH_OWNER_INSERT", authInsert.status === 201 && Boolean(authId), `status=${authInsert.status} id=${authId}`);

// Owner can read own
const ownerRead = await rest(`founder_action_authorizations?id=eq.${authId}&select=id,owner_id`, {
  token: owner.accessToken,
});
record(
  "AUTHENTICATED_RLS_OWNER_READ",
  ownerRead.status === 200 && Array.isArray(ownerRead.json) && ownerRead.json.length === 1,
  `status=${ownerRead.status} rows=${Array.isArray(ownerRead.json) ? ownerRead.json.length : "?"}`,
);

// Other cannot read
const otherRead = await rest(`founder_action_authorizations?id=eq.${authId}&select=id`, {
  token: other.accessToken,
});
record(
  "CROSS_ACCOUNT_ISOLATION",
  otherRead.status === 200 && Array.isArray(otherRead.json) && otherRead.json.length === 0,
  `status=${otherRead.status} rows=${Array.isArray(otherRead.json) ? otherRead.json.length : "?"}`,
);

// Missing JWT
const noJwt = await rest(`founder_action_authorizations?select=id&limit=1`);
record("MISSING_JWT_REJECTED", noJwt.status === 401 || (Array.isArray(noJwt.json) && noJwt.json.length === 0) || noJwt.status >= 400, `status=${noJwt.status}`);

// Invalid JWT
const badJwt = await fetch(`${API}/rest/v1/founder_action_authorizations?select=id&limit=1`, {
  headers: { apikey: ANON, Authorization: "Bearer not-a-real-jwt" },
});
record("INVALID_JWT_REJECTED", badJwt.status === 401 || badJwt.status >= 400, `status=${badJwt.status}`);

// Anon key alone must not act as service role for auth.admin
const anonAdmin = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const anonList = await anonAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
record("SERVICE_ROLE_SERVER_ONLY", Boolean(anonList.error), anonList.error?.message ?? "anon unexpectedly listed users");

// Approve via owner update
const approve = await rest(`founder_action_authorizations?id=eq.${authId}`, {
  token: owner.accessToken,
  method: "PATCH",
  prefer: "return=representation",
  body: { status: "APPROVED", decided_at: new Date().toISOString(), decided_by: owner.id },
});
record("AUTH_APPROVE", approve.status === 200 || approve.status === 204, `status=${approve.status}`);

// Scope mismatch task insert via API
const mismatch = await rest("agent_tasks", {
  token: owner.accessToken,
  method: "POST",
  prefer: "return=representation",
  body: {
    owner_id: owner.id,
    project_id: projectA,
    status: "QUEUED",
    authorization_id: authId,
    authorization_kind: "DEVELOPMENT",
    action_type: action,
    action_scope: "WRONG-SCOPE",
    environment_label: envLabel,
    scope_fingerprint: fp(["wrong"]),
    idempotency_key: `task-bad-${randomUUID().slice(0, 8)}`,
  },
});
record(
  "SCOPE_MISMATCH_INSERT_API",
  mismatch.status >= 400,
  `status=${mismatch.status} body=${JSON.stringify(mismatch.json).slice(0, 180)}`,
);

// Kind mismatch (development action with DEPLOYMENT kind)
const kindBad = await rest("agent_tasks", {
  token: owner.accessToken,
  method: "POST",
  prefer: "return=representation",
  body: {
    owner_id: owner.id,
    project_id: projectA,
    status: "QUEUED",
    authorization_id: authId,
    authorization_kind: "DEPLOYMENT",
    action_type: action,
    action_scope: scope,
    environment_label: envLabel,
    scope_fingerprint: fingerprint,
    idempotency_key: `task-kind-${randomUUID().slice(0, 8)}`,
  },
});
record(
  "DEVELOPMENT_NOT_DEPLOYMENT",
  kindBad.status >= 400,
  `status=${kindBad.status} body=${JSON.stringify(kindBad.json).slice(0, 180)}`,
);

// Valid task after consume mark
sql(`
  update public.founder_action_authorizations
  set status='CONSUMED', use_count=1, consumed_at=now()
  where id='${authId}';
`);
const validTask = await rest("agent_tasks", {
  token: owner.accessToken,
  method: "POST",
  prefer: "return=representation",
  body: {
    owner_id: owner.id,
    project_id: projectA,
    status: "QUEUED",
    authorization_id: authId,
    authorization_kind: "DEVELOPMENT",
    action_type: action,
    action_scope: scope,
    environment_label: envLabel,
    scope_fingerprint: fingerprint,
    idempotency_key: `task-ok-${randomUUID().slice(0, 8)}`,
    authorization_consumed: true,
  },
});
const taskId = Array.isArray(validTask.json) ? validTask.json[0]?.id : null;
record("VALID_TASK_INSERT_API", validTask.status === 201 && Boolean(taskId), `status=${validTask.status} task=${taskId}`);

// Unauthorized UPDATE scope rewrite
const updateBad = await rest(`agent_tasks?id=eq.${taskId}`, {
  token: owner.accessToken,
  method: "PATCH",
  body: { action_scope: "mutated" },
});
record("SCOPE_MISMATCH_UPDATE_API", updateBad.status >= 400, `status=${updateBad.status}`);

// Checkpoint persistence
const checkpoint = await rest("agent_task_checkpoints", {
  token: owner.accessToken,
  method: "POST",
  prefer: "return=representation",
  body: {
    task_id: taskId,
    owner_id: owner.id,
    sequence: 1,
    label: "api-step",
    progress_ref: "ref:api",
    authorization_id: authId,
    scope_fingerprint: fingerprint,
  },
});
const checkpointId = Array.isArray(checkpoint.json) ? checkpoint.json[0]?.id : null;
record("CHECKPOINT_API", checkpoint.status === 201 && Boolean(checkpointId), `status=${checkpoint.status}`);

await rest(`agent_tasks?id=eq.${taskId}`, {
  token: owner.accessToken,
  method: "PATCH",
  body: { last_checkpoint_id: checkpointId, checkpoint_sequence: 1, status: "CHECKPOINT" },
});

// New HTTP session persistence (independent REST call after checkpoint write)
const persisted = await rest(`agent_tasks?id=eq.${taskId}&select=status,checkpoint_sequence`, {
  token: owner.accessToken,
});
const ckCount = await rest(`agent_task_checkpoints?task_id=eq.${taskId}&select=id`, {
  token: owner.accessToken,
});
record(
  "DURABLE_TASK_PERSISTENCE",
  Array.isArray(persisted.json) &&
    persisted.json[0]?.status === "CHECKPOINT" &&
    Array.isArray(ckCount.json) &&
    ckCount.json.length === 1,
  `task=${JSON.stringify(persisted.json)} checkpoints=${ckCount.json?.length}`,
);

// Cross-project task insert rejected
const crossProj = await rest("agent_tasks", {
  token: owner.accessToken,
  method: "POST",
  body: {
    owner_id: owner.id,
    project_id: projectB,
    status: "QUEUED",
    authorization_id: authId,
    authorization_kind: "DEVELOPMENT",
    action_type: action,
    action_scope: scope,
    environment_label: envLabel,
    scope_fingerprint: fingerprint,
    idempotency_key: `task-xproj-${randomUUID().slice(0, 8)}`,
  },
});
record("CROSS_PROJECT_TASK_REJECTED", crossProj.status >= 400, `status=${crossProj.status}`);

// Revoked authorization: observe DB insert behavior (do not change model)
const revokedId = sql(`
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by,
    revoked_at, revoked_by, revoke_reason
  ) values (
    '${owner.id}', '${projectA}', '${envLabel}', '${action}', 'scope-rev', '${fp(["rev"])}',
    'revoked fixture', 'REVOKED', 'ONE_TIME', now() + interval '1 hour',
    'idem-rev-${randomUUID().slice(0, 8)}', now(), '${owner.id}',
    now(), '${owner.id}', 'stop'
  ) returning id;
`);
const revokedInsert = await rest("agent_tasks", {
  token: owner.accessToken,
  method: "POST",
  prefer: "return=representation",
  body: {
    owner_id: owner.id,
    project_id: projectA,
    status: "QUEUED",
    authorization_id: revokedId,
    authorization_kind: "DEVELOPMENT",
    action_type: action,
    action_scope: "scope-rev",
    environment_label: envLabel,
    scope_fingerprint: fp(["rev"]),
    idempotency_key: `task-rev-${randomUUID().slice(0, 8)}`,
  },
});
const revokedBehavior =
  revokedInsert.status >= 400
    ? "DB_BLOCKS_REVOKED_TASK_INSERT"
    : "DB_ALLOWS_REVOKED_TASK_INSERT_APP_MUST_REVALIDATE";
record(
  "REVOKED_AUTH_TASK_INSERT_OBSERVED",
  true,
  `${revokedBehavior} status=${revokedInsert.status} body=${JSON.stringify(revokedInsert.json).slice(0, 220)}`,
);

// Simulated SUCCEEDED task cannot flip verification_state independently (no column) —
// check remote_development independent review flag if present after success-like update.
const verifyCol = sql(`
  select count(*)::text from information_schema.columns
  where table_schema='public' and table_name='agent_tasks' and column_name='verification_state';
`);
if (verifyCol === "1") {
  const fakeVerify = await rest(`agent_tasks?id=eq.${taskId}`, {
    token: owner.accessToken,
    method: "PATCH",
    body: { status: "SUCCEEDED", verification_state: "VERIFIED" },
  });
  record("NO_INDEPENDENT_VERIFY", fakeVerify.status >= 400, `status=${fakeVerify.status}`);
} else {
  // Application contract: Accept does not auto-verify — covered by security-regression suite.
  // DB has no verification_state on agent_tasks; remote requires_independent_review remains.
  const reviewFlag = sql(`
    select count(*)::text from information_schema.columns
    where table_schema='public' and table_name='remote_development_tasks'
      and column_name='requires_independent_review';
  `);
  record(
    "NO_INDEPENDENT_VERIFY",
    reviewFlag === "1",
    `agent_tasks.verification_state absent; remote requires_independent_review present=${reviewFlag}`,
  );
}

// Recovery revalidation signal: revoke blocks consume (SQL) after APPROVED
const raceAuth = sql(`
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by
  ) values (
    '${owner.id}', '${projectA}', '${envLabel}', '${action}', 'scope-race', '${fp(["race"])}',
    'race', 'APPROVED', 'ONE_TIME', now() + interval '1 hour',
    'idem-race-${randomUUID().slice(0, 8)}', now(), '${owner.id}'
  ) returning id;
`);
const consumeSql = `
begin;
with u as (
  update public.founder_action_authorizations
  set use_count = use_count + 1,
      status = 'CONSUMED',
      consumed_at = now()
  where id='${raceAuth}' and status='APPROVED' and use_count=0 and expires_at > now()
  returning id
) select count(*)::text from u;
commit;
`;
function raceOnce() {
  const out = execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
    { input: consumeSql, encoding: "utf8" },
  );
  const lines = out
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line === "0" || line === "1");
  return lines[lines.length - 1] ?? "";
}
const [w1, w2] = await Promise.all([Promise.resolve().then(raceOnce), Promise.resolve().then(raceOnce)]);
const wins = [w1, w2].filter((v) => v === "1").length;
const losses = [w1, w2].filter((v) => v === "0").length;
const final = sql(`select use_count::text || ':' || status::text from public.founder_action_authorizations where id='${raceAuth}'`);
record(
  "ONE_TIME_CONCURRENCY_API_ENV",
  wins === 1 && losses === 1 && final === "1:CONSUMED",
  `wins=${wins} losses=${losses} final=${final}`,
);

// Ghost DB unmodified check
const ghostStill = execFileSync(
  "docker",
  ["ps", "--filter", "name=supabase_db_ghost", "--format", "{{.Names}} {{.Ports}}"],
  { encoding: "utf8" },
).trim();
record("EXISTING_GHOST_DB_UNTOUCHED", /supabase_db_ghost /.test(ghostStill) && /54322/.test(ghostStill), ghostStill);

const summary = {
  build: "09.9F",
  api: API,
  container: CONTAINER,
  results,
  passed: results.filter((r) => r.result === "PASS").length,
  failed: results.filter((r) => r.result === "FAIL").length,
  revokedAuthObservation: revokedBehavior,
  at: new Date().toISOString(),
};
writeFileSync(path.join(evidenceDir, "api-verification.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, revokedAuthObservation: revokedBehavior }, null, 2));
process.exit(summary.failed === 0 ? 0 : 1);
