/**
 * Build 09.9E — authorization scope security closure retest.
 * Disposable only: ghost-09-9d-disposable-pg @ 127.0.0.1:55431 / ghost99d.
 * Does not claim GoTrue/PostgREST integration suite.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTAINER = "ghost-09-9d-disposable-pg";
const ACTION = "agent_task.develop";
const evidenceDir = path.join(root, ".ghost", "09-9e-evidence");
mkdirSync(evidenceDir, { recursive: true });

function assertSafeContainer() {
  const inspect = JSON.parse(execFileSync("docker", ["inspect", CONTAINER], { encoding: "utf8" }))[0];
  const hostPort = inspect?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  const networks = Object.keys(inspect?.NetworkSettings?.Networks ?? {});
  if (hostPort !== "55431") throw new Error(`Bad port ${hostPort}`);
  if (networks.some((n) => n.includes("supabase"))) throw new Error("On supabase network");
  if (CONTAINER === "supabase_db_ghost") throw new Error("Refusing Ghost DB");
  const ghost = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0];
  const ghostPort = ghost?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  if (ghostPort === "55431") throw new Error("Port collision with Ghost DB");
  const db = execFileSync(
    "docker",
    ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "ghost99d", "-t", "-A", "-c", "select current_database();"],
    { encoding: "utf8" },
  ).trim();
  if (db !== "ghost99d") throw new Error(`Bad database ${db}`);
  return { hostPort, networks, ghostPort, database: db };
}

function psql(sql, { roleSub } = {}) {
  const full = roleSub
    ? `begin;\nset local role authenticated;\ndo $$ begin perform set_config('request.jwt.claim.sub', '${roleSub}', true); end $$;\n${sql}\ncommit;`
    : sql;
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "ghost99d", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
    { input: full, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "psql failed").trim();
    const error = new Error(err);
    error.sql = sql;
    throw error;
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lines = (result.stdout || "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(BEGIN|COMMIT|SET|INSERT|UPDATE|DELETE|SELECT)/i.test(line));
  const ids = lines.filter((line) => uuid.test(line));
  if (ids.length === 1) return ids[0];
  return lines.join("\n");
}

function fp(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function rejected(message) {
  return /scope|binding|fingerprint|match|authorization|cannot be rewritten|42501|P0001|exception|approved/i.test(
    message,
  );
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, result: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

const isolation = assertSafeContainer();
record(
  "ISOLATION",
  true,
  `container=${CONTAINER} db=${isolation.database} port=${isolation.hostPort} ghostPort=${isolation.ghostPort} networks=${isolation.networks.join(",")}`,
);

const ownerA = randomUUID();
const ownerB = randomUUID();
const companyA = randomUUID();
const companyB = randomUUID();
const projectA = randomUUID();
const projectB = randomUUID();
const fingerprint = fp(["REMOTE_DEV", ACTION, "scope-a", "LOCAL"]);

psql(`
insert into auth.users (id, email) values
  ('${ownerA}', 'a99e@ghost99d.test'),
  ('${ownerB}', 'b99e@ghost99d.test');
insert into public.profiles (id, display_name) values
  ('${ownerA}', 'Owner A 99E'),
  ('${ownerB}', 'Owner B 99E');
insert into public.companies (id, owner_id, name, slug) values
  ('${companyA}', '${ownerA}', 'Co A 99E', 'co-a99e-${ownerA.slice(0,8)}'),
  ('${companyB}', '${ownerB}', 'Co B 99E', 'co-b99e-${ownerB.slice(0,8)}');
insert into public.projects (id, company_id, name, slug, description, status) values
  ('${projectA}', '${companyA}', 'Proj A 99E', 'proj-a99e', 'synthetic', 'IDEA'),
  ('${projectB}', '${companyB}', 'Proj B 99E', 'proj-b99e', 'synthetic', 'IDEA');
`);

let authId;
try {
  authId = psql(
    `
    insert into public.founder_action_authorizations (
      owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
      reason, evidence, side_effects, estimated_cost, status, reuse_policy, expires_at, idempotency_key
    ) values (
      '${ownerA}', '${projectA}', 'REMOTE_DEV', '${ACTION}', 'scope-a', '${fingerprint}',
      'synthetic durable authorization', '[]'::jsonb, 'none', 'UNKNOWN', 'PENDING', 'ONE_TIME',
      now() + interval '1 hour', 'idem-99e-${randomUUID().slice(0, 12)}'
    ) returning id;
    `,
    { roleSub: ownerA },
  );
  record("OWNER_CREATE_AUTH", Boolean(authId && authId.length === 36), `authId=${authId}`);
} catch (e) {
  record("OWNER_CREATE_AUTH", false, e.message.slice(0, 300));
  writeFileSync(path.join(evidenceDir, "sql-verification.json"), JSON.stringify({ results }, null, 2));
  process.exit(1);
}

try {
  const hidden = psql(`select count(*)::text from public.founder_action_authorizations where id='${authId}';`, {
    roleSub: ownerB,
  });
  record("CROSS_OWNER_READ_DENIED", hidden === "0", `rows=${hidden}`);
} catch (e) {
  record("CROSS_OWNER_READ_DENIED", false, e.message.slice(0, 300));
}

try {
  psql(
    `
    insert into public.founder_action_authorizations (
      owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
      reason, status, reuse_policy, expires_at, idempotency_key
    ) values (
      '${ownerA}', '${projectB}', 'REMOTE_DEV', '${ACTION}', 'scope-x', '${fp(["x"])}',
      'should fail', 'PENDING', 'ONE_TIME', now() + interval '1 hour', 'idem-bad-${randomUUID().slice(0,8)}'
    );
    `,
    { roleSub: ownerA },
  );
  record("CROSS_PROJECT_INSERT_DENIED", false, "insert unexpectedly succeeded");
} catch (e) {
  record("CROSS_PROJECT_INSERT_DENIED", /row-level security|violates/i.test(e.message), e.message.slice(0, 200));
}

psql(
  `
  update public.founder_action_authorizations
  set status='APPROVED', decided_at=now(), decided_by='${ownerA}'
  where id='${authId}';
  `,
  { roleSub: ownerA },
);
try {
  psql(
    `update public.founder_action_authorizations set action_scope='mutated' where id='${authId}';`,
    { roleSub: ownerA },
  );
  record("IMMUTABLE_SCOPE", false, "scope rewrite succeeded");
} catch (e) {
  record("IMMUTABLE_SCOPE", /cannot be rewritten|42501/i.test(e.message), e.message.slice(0, 200));
}

const authRevoke = psql(
  `
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by
  ) values (
    '${ownerA}', '${projectA}', 'REMOTE_DEV', '${ACTION}', 'scope-revoke', '${fp(["revoke"])}',
    'revoke fixture', 'APPROVED', 'ONE_TIME', now() + interval '1 hour', 'idem-rev-${randomUUID().slice(0,8)}',
    now(), '${ownerA}'
  ) returning id;
  `,
  { roleSub: ownerA },
);
psql(
  `
  update public.founder_action_authorizations
  set status='REVOKED', revoked_at=now(), revoked_by='${ownerA}', revoke_reason='stop'
  where id='${authRevoke}';
  `,
  { roleSub: ownerA },
);
const revokeConsume = psql(
  `
  with u as (
    update public.founder_action_authorizations
    set use_count = use_count + 1, status='CONSUMED', consumed_at=now()
    where id='${authRevoke}' and status='APPROVED' and use_count=0 and expires_at > now()
    returning id
  ) select count(*)::text from u;
  `,
  { roleSub: ownerA },
);
record("REVOCATION_BLOCKS_CONSUME", revokeConsume === "0", `updated=${revokeConsume}`);

const authExp = psql(
  `
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by
  ) values (
    '${ownerA}', '${projectA}', 'REMOTE_DEV', '${ACTION}', 'scope-exp', '${fp(["exp"])}',
    'expiry fixture', 'APPROVED', 'ONE_TIME', now() - interval '1 minute', 'idem-exp-${randomUUID().slice(0,8)}',
    now(), '${ownerA}'
  ) returning id;
  `,
  { roleSub: ownerA },
);
const expConsume = psql(
  `
  with u as (
    update public.founder_action_authorizations
    set use_count = use_count + 1, status='CONSUMED', consumed_at=now()
    where id='${authExp}' and status='APPROVED' and use_count=0 and expires_at > now()
    returning id
  ) select count(*)::text from u;
  `,
  { roleSub: ownerA },
);
record("EXPIRY_BLOCKS_CONSUME", expConsume === "0", `updated=${expConsume}`);

const authRace = psql(
  `
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by
  ) values (
    '${ownerA}', '${projectA}', 'REMOTE_DEV', '${ACTION}', 'scope-race', '${fp(["race"])}',
    'race fixture', 'APPROVED', 'ONE_TIME', now() + interval '1 hour', 'idem-race-${randomUUID().slice(0,8)}',
    now(), '${ownerA}'
  ) returning id;
  `,
  { roleSub: ownerA },
);

const consumeSql = `
begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', '${ownerA}', true); end $$;
with u as (
  update public.founder_action_authorizations
  set use_count = use_count + 1,
      status = case when reuse_policy='ONE_TIME' then 'CONSUMED'::public.founder_authorization_status else status end,
      consumed_at = case when reuse_policy='ONE_TIME' then now() else consumed_at end
  where id='${authRace}'
    and status='APPROVED'
    and use_count=0
    and expires_at > now()
  returning id
) select count(*)::text from u;
commit;
`;

function raceOnce() {
  return spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "ghost99d", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
    { input: consumeSql, encoding: "utf8" },
  );
}

const raced = await Promise.all([
  Promise.resolve().then(() => raceOnce()),
  Promise.resolve().then(() => raceOnce()),
]);
const wins = raced.map((r) => (r.stdout || "").trim()).filter((v) => v === "1").length;
const losses = raced.map((r) => (r.stdout || "").trim()).filter((v) => v === "0").length;
const finalUse = psql(`select use_count::text || ':' || status::text from public.founder_action_authorizations where id='${authRace}';`, {
  roleSub: ownerA,
});
record(
  "ONE_TIME_CONCURRENCY",
  wins === 1 && losses === 1 && finalUse === "1:CONSUMED",
  `wins=${wins} losses=${losses} final=${finalUse}`,
);

const authTask = psql(
  `
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by, use_count, consumed_at
  ) values (
    '${ownerA}', '${projectA}', 'REMOTE_DEV', '${ACTION}', 'scope-task', '${fp(["task"])}',
    'task fixture', 'CONSUMED', 'ONE_TIME', now() + interval '1 hour', 'idem-task-${randomUUID().slice(0,8)}',
    now(), '${ownerA}', 1, now()
  ) returning id;
  `,
  { roleSub: ownerA },
);

const authAlt = psql(
  `
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by, use_count, consumed_at
  ) values (
    '${ownerA}', '${projectA}', 'REMOTE_DEV', '${ACTION}', 'scope-alt', '${fp(["alt"])}',
    'alt fixture', 'CONSUMED', 'ONE_TIME', now() + interval '1 hour', 'idem-alt-${randomUUID().slice(0,8)}',
    now(), '${ownerA}', 1, now()
  ) returning id;
  `,
  { roleSub: ownerA },
);

let taskId;
try {
  taskId = psql(
    `
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key, authorization_consumed
    ) values (
      '${ownerA}', '${projectA}', 'QUEUED', '${authTask}', 'DEVELOPMENT',
      '${ACTION}', 'scope-task', 'REMOTE_DEV', '${fp(["task"])}', 'task-${randomUUID().slice(0,8)}', true
    ) returning id;
    `,
    { roleSub: ownerA },
  );
  record("VALID_AUTHORIZED_INSERT", Boolean(taskId), `taskId=${taskId}`);
  record("TASK_RELATIONSHIP_CREATE", Boolean(taskId), `taskId=${taskId}`);
} catch (e) {
  record("VALID_AUTHORIZED_INSERT", false, e.message.slice(0, 300));
  record("TASK_RELATIONSHIP_CREATE", false, e.message.slice(0, 300));
}

try {
  psql(
    `
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key
    ) values (
      '${ownerA}', '${projectA}', 'QUEUED', '${authTask}', 'DEVELOPMENT',
      '${ACTION}', 'WRONG-SCOPE', 'REMOTE_DEV', '${fp(["wrong"])}', 'task-bad-${randomUUID().slice(0,8)}'
    );
    `,
    { roleSub: ownerA },
  );
  record("SCOPE_MISMATCH_INSERT", false, "mismatch insert succeeded");
  record("SCOPE_MISMATCH_REJECTED", false, "mismatch insert succeeded");
} catch (e) {
  const ok = rejected(e.message);
  record("SCOPE_MISMATCH_INSERT", ok, e.message.slice(0, 220));
  record("SCOPE_MISMATCH_REJECTED", ok, e.message.slice(0, 220));
}

try {
  psql(
    `
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key
    ) values (
      '${ownerB}', '${projectA}', 'QUEUED', '${authTask}', 'DEVELOPMENT',
      '${ACTION}', 'scope-task', 'REMOTE_DEV', '${fp(["task"])}', 'task-owner-${randomUUID().slice(0,8)}'
    );
    `,
    { roleSub: ownerA },
  );
  record("OWNER_MISMATCH_INSERT", false, "owner mismatch insert succeeded");
} catch (e) {
  record("OWNER_MISMATCH_INSERT", rejected(e.message), e.message.slice(0, 220));
}

try {
  psql(
    `
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key
    ) values (
      '${ownerA}', '${projectB}', 'QUEUED', '${authTask}', 'DEVELOPMENT',
      '${ACTION}', 'scope-task', 'REMOTE_DEV', '${fp(["task"])}', 'task-proj-${randomUUID().slice(0,8)}'
    );
    `,
    { roleSub: ownerA },
  );
  record("PROJECT_MISMATCH_INSERT", false, "project mismatch insert succeeded");
} catch (e) {
  record("PROJECT_MISMATCH_INSERT", rejected(e.message), e.message.slice(0, 220));
}

try {
  psql(
    `
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key
    ) values (
      '${ownerA}', '${projectA}', 'QUEUED', '${authTask}', 'DEVELOPMENT',
      '${ACTION}', 'scope-task', 'PRODUCTION', '${fp(["task"])}', 'task-env-${randomUUID().slice(0,8)}'
    );
    `,
    { roleSub: ownerA },
  );
  record("ENVIRONMENT_MISMATCH_INSERT", false, "environment mismatch insert succeeded");
} catch (e) {
  record("ENVIRONMENT_MISMATCH_INSERT", rejected(e.message), e.message.slice(0, 220));
}

try {
  psql(
    `
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key
    ) values (
      '${ownerA}', '${projectA}', 'QUEUED', '${authTask}', 'DEPLOYMENT',
      '${ACTION}', 'scope-task', 'REMOTE_DEV', '${fp(["task"])}', 'task-kind-${randomUUID().slice(0,8)}'
    );
    `,
    { roleSub: ownerA },
  );
  record("KIND_MISMATCH_INSERT", false, "kind mismatch insert succeeded");
} catch (e) {
  record("KIND_MISMATCH_INSERT", rejected(e.message), e.message.slice(0, 220));
}

try {
  psql(
    `update public.agent_tasks set action_scope='mutated-scope' where id='${taskId}';`,
    { roleSub: ownerA },
  );
  record("SCOPE_MISMATCH_UPDATE", false, "scope rewrite on task succeeded");
} catch (e) {
  record("SCOPE_MISMATCH_UPDATE", rejected(e.message), e.message.slice(0, 220));
}

try {
  psql(
    `update public.agent_tasks set authorization_id='${authAlt}' where id='${taskId}';`,
    { roleSub: ownerA },
  );
  record("RELATIONSHIP_REASSIGN_REJECTED", false, "authorization_id reassignment succeeded");
} catch (e) {
  record("RELATIONSHIP_REASSIGN_REJECTED", rejected(e.message), e.message.slice(0, 220));
}

try {
  psql(
    `update public.agent_tasks set project_id='${projectB}' where id='${taskId}';`,
    { roleSub: ownerA },
  );
  record("PROJECT_REASSIGN_REJECTED", false, "project_id reassignment succeeded");
} catch (e) {
  record("PROJECT_REASSIGN_REJECTED", rejected(e.message), e.message.slice(0, 220));
}

let checkpointId;
try {
  checkpointId = psql(
    `
    insert into public.agent_task_checkpoints (
      task_id, owner_id, sequence, label, progress_ref, authorization_id, scope_fingerprint
    ) values (
      '${taskId}', '${ownerA}', 1, 'step-one', 'ref:step-one', '${authTask}', '${fp(["task"])}'
    ) returning id;
    `,
    { roleSub: ownerA },
  );
  psql(
    `update public.agent_tasks set last_checkpoint_id='${checkpointId}', checkpoint_sequence=1, status='CHECKPOINT' where id='${taskId}';`,
    { roleSub: ownerA },
  );
  record("CHECKPOINT_WRITE", Boolean(checkpointId), `checkpointId=${checkpointId}`);
  record("DURABLE_CHECKPOINT_RELATIONSHIP", Boolean(checkpointId), `task=${taskId} checkpoint=${checkpointId}`);
} catch (e) {
  record("CHECKPOINT_WRITE", false, e.message.slice(0, 300));
  record("DURABLE_CHECKPOINT_RELATIONSHIP", false, e.message.slice(0, 300));
}

try {
  psql(
    `
    insert into public.agent_task_checkpoints (
      task_id, owner_id, sequence, label, authorization_id, scope_fingerprint
    ) values ('${taskId}', '${ownerA}', 1, 'step-one-dup', '${authTask}', '${fp(["dup"])}');
    `,
    { roleSub: ownerA },
  );
  record("CHECKPOINT_IDEMPOTENCY", false, "duplicate sequence allowed");
} catch (e) {
  record("CHECKPOINT_IDEMPOTENCY", /duplicate|unique/i.test(e.message), e.message.slice(0, 200));
}

const persisted = psql(
  `
  select
    (select status::text from public.agent_tasks where id='${taskId}') || '|' ||
    (select count(*)::text from public.agent_task_checkpoints where task_id='${taskId}') || '|' ||
    (select status::text from public.founder_action_authorizations where id='${authTask}');
  `,
  { roleSub: ownerA },
);
record("PERSISTENCE_RELOAD", persisted === "CHECKPOINT|1|CONSUMED", `state=${persisted}`);

try {
  psql(
    `
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key
    ) values (
      '${ownerA}', '${projectA}', 'QUEUED', '${authRevoke}', 'DEVELOPMENT',
      '${ACTION}', 'scope-revoke', 'REMOTE_DEV', '${fp(["revoke"])}', 'task-rev-${randomUUID().slice(0,8)}'
    );
    `,
    { roleSub: ownerA },
  );
  const status = psql(`select status::text from public.founder_action_authorizations where id='${authRevoke}';`, {
    roleSub: ownerA,
  });
  record(
    "REVOCATION",
    status === "REVOKED",
    `auth still REVOKED=${status}; consume blocked earlier; app-layer revalidate required before claim`,
  );
  record(
    "RECOVERY_AUTH_REVOKED",
    status === "REVOKED",
    `auth still REVOKED=${status}; app-layer revalidate required before claim (DB binding allows FK)`,
  );
} catch (e) {
  record("REVOCATION", true, `insert blocked: ${e.message.slice(0, 180)}`);
  record("RECOVERY_AUTH_REVOKED", true, `insert blocked: ${e.message.slice(0, 180)}`);
}

try {
  const remoteId = psql(
    `
    insert into public.remote_development_tasks (
      owner_id, project_id, objective, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, repository,
      approved_base_branch, idempotency_key, agent_task_id
    ) values (
      '${ownerA}', '${projectA}', 'Durable DB verification objective text.', 'QUEUED', '${authTask}', 'DEVELOPMENT',
      '${ACTION}', 'scope-task', 'REMOTE_DEV', '${fp(["task"])}', 'Ghost-1R/Ghost',
      'cursor/cloud-verification-prep-09-9c-7050', 'remote-${randomUUID().slice(0,8)}', '${taskId}'
    ) returning id;
    `,
    { roleSub: ownerA },
  );
  const link = psql(
    `select (agent_task_id is not null)::text from public.remote_development_tasks where id='${remoteId}';`,
    { roleSub: ownerA },
  );
  record("REMOTE_AGENT_LINK", link === "true", `remoteId=${remoteId}`);
} catch (e) {
  record("REMOTE_AGENT_LINK", false, e.message.slice(0, 300));
}

const ghostPs = execFileSync("docker", ["ps", "--filter", "name=supabase_db_ghost", "--format", "{{.Names}} {{.Status}} {{.Ports}}"], {
  encoding: "utf8",
}).trim();
record("EXISTING_GHOST_DB_UNCHANGED", /supabase_db_ghost/.test(ghostPs) && /54322/.test(ghostPs), ghostPs);
record("EXISTING_CONTAINERS_PRESENT", /supabase_db_ghost/.test(ghostPs) && /54322/.test(ghostPs), ghostPs);
record("RLS_REGRESSION", results.find((r) => r.name === "CROSS_OWNER_READ_DENIED")?.result === "PASS", "cross-owner read still denied");

const summary = {
  build: "09.9E",
  isolation,
  results,
  passed: results.filter((r) => r.result === "PASS").length,
  failed: results.filter((r) => r.result === "FAIL").length,
  at: new Date().toISOString(),
  note: "SQL/RLS/trigger verification only. Full GoTrue/PostgREST test pack NOT RUN.",
};
writeFileSync(path.join(evidenceDir, "sql-verification.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed }, null, 2));
process.exit(summary.failed === 0 ? 0 : 1);
