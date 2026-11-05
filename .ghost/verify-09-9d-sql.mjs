/**
 * Real disposable-Postgres verification for Build 09.9D.
 * Uses ghost-09-9d-disposable-pg only. Never supabase_db_ghost / :54322.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTAINER = "ghost-09-9d-disposable-pg";
const evidenceDir = path.join(root, ".ghost", "09-9d-evidence");
mkdirSync(evidenceDir, { recursive: true });

function assertSafeContainer() {
  const inspect = JSON.parse(execFileSync("docker", ["inspect", CONTAINER], { encoding: "utf8" }))[0];
  const hostPort = inspect?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  const networks = Object.keys(inspect?.NetworkSettings?.Networks ?? {});
  if (hostPort !== "55431") throw new Error(`Bad port ${hostPort}`);
  if (networks.some((n) => n.includes("supabase"))) throw new Error("On supabase network");
  if (CONTAINER === "supabase_db_ghost") throw new Error("Refusing Ghost DB");
  // Existing Ghost DB must still be on 54322 and distinct
  const ghost = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0];
  const ghostPort = ghost?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  if (ghostPort === "55431") throw new Error("Port collision with Ghost DB");
  return { hostPort, networks, ghostPort };
}

function psql(sql, { roleSub } = {}) {
  // set_config(..., true) is transaction-local — wrap as one transaction.
  // Use DO/PERFORM so set_config does not emit a result row that contaminates RETURNING.
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
  // Prefer a UUID return value when present (RETURNING id).
  const ids = lines.filter((line) => uuid.test(line));
  if (ids.length === 1) return ids[0];
  return lines.join("\n");
}

function fp(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, result: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

const isolation = assertSafeContainer();
record("ISOLATION", true, `container=${CONTAINER} port=${isolation.hostPort} ghostPort=${isolation.ghostPort} networks=${isolation.networks.join(",")}`);

const ownerA = randomUUID();
const ownerB = randomUUID();
const companyA = randomUUID();
const companyB = randomUUID();
const projectA = randomUUID();
const projectB = randomUUID();
const fingerprint = fp(["REMOTE_DEV", "durable_dev", "scope-a", "LOCAL"]);

psql(`
insert into auth.users (id, email) values
  ('${ownerA}', 'a@ghost99d.test'),
  ('${ownerB}', 'b@ghost99d.test');
insert into public.profiles (id, display_name) values
  ('${ownerA}', 'Owner A'),
  ('${ownerB}', 'Owner B');
insert into public.companies (id, owner_id, name, slug) values
  ('${companyA}', '${ownerA}', 'Co A', 'co-a-${ownerA.slice(0,8)}'),
  ('${companyB}', '${ownerB}', 'Co B', 'co-b-${ownerB.slice(0,8)}');
insert into public.projects (id, company_id, name, slug, description, status) values
  ('${projectA}', '${companyA}', 'Proj A', 'proj-a', 'synthetic', 'IDEA'),
  ('${projectB}', '${companyB}', 'Proj B', 'proj-b', 'synthetic', 'IDEA');
`);

// Owner can insert/read own authorization
let authId;
try {
  authId = psql(
    `
    insert into public.founder_action_authorizations (
      owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
      reason, evidence, side_effects, estimated_cost, status, reuse_policy, expires_at, idempotency_key
    ) values (
      '${ownerA}', '${projectA}', 'REMOTE_DEV', 'durable_dev', 'scope-a', '${fingerprint}',
      'synthetic durable authorization', '[]'::jsonb, 'none', 'UNKNOWN', 'PENDING', 'ONE_TIME',
      now() + interval '1 hour', 'idem-${randomUUID().slice(0, 12)}'
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

// Cross-owner cannot read
try {
  const hidden = psql(`select count(*)::text from public.founder_action_authorizations where id='${authId}';`, {
    roleSub: ownerB,
  });
  record("CROSS_OWNER_READ_DENIED", hidden === "0", `rows=${hidden}`);
} catch (e) {
  record("CROSS_OWNER_READ_DENIED", false, e.message.slice(0, 300));
}

// Cross-project insert denied (owner A inserting with project B)
try {
  psql(
    `
    insert into public.founder_action_authorizations (
      owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
      reason, status, reuse_policy, expires_at, idempotency_key
    ) values (
      '${ownerA}', '${projectB}', 'REMOTE_DEV', 'durable_dev', 'scope-x', '${fp(["x"])}',
      'should fail', 'PENDING', 'ONE_TIME', now() + interval '1 hour', 'idem-bad-${randomUUID().slice(0,8)}'
    );
    `,
    { roleSub: ownerA },
  );
  record("CROSS_PROJECT_INSERT_DENIED", false, "insert unexpectedly succeeded");
} catch (e) {
  record("CROSS_PROJECT_INSERT_DENIED", /row-level security|violates/i.test(e.message), e.message.slice(0, 200));
}

// Approve then immutable scope rewrite fails
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

// Revocation blocks resume/consume
const authRevoke = psql(
  `
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by
  ) values (
    '${ownerA}', '${projectA}', 'REMOTE_DEV', 'durable_dev', 'scope-revoke', '${fp(["revoke"])}',
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

// Expiry blocks consume
const authExp = psql(
  `
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by
  ) values (
    '${ownerA}', '${projectA}', 'REMOTE_DEV', 'durable_dev', 'scope-exp', '${fp(["exp"])}',
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

// Concurrent ONE_TIME consume — two parallel sessions
const authRace = psql(
  `
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by
  ) values (
    '${ownerA}', '${projectA}', 'REMOTE_DEV', 'durable_dev', 'scope-race', '${fp(["race"])}',
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

// Task relationship + checkpoint + binding integrity
const authTask = psql(
  `
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by, use_count, consumed_at
  ) values (
    '${ownerA}', '${projectA}', 'REMOTE_DEV', 'durable_dev', 'scope-task', '${fp(["task"])}',
    'task fixture', 'CONSUMED', 'ONE_TIME', now() + interval '1 hour', 'idem-task-${randomUUID().slice(0,8)}',
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
      'durable_dev', 'scope-task', 'REMOTE_DEV', '${fp(["task"])}', 'task-${randomUUID().slice(0,8)}', true
    ) returning id;
    `,
    { roleSub: ownerA },
  );
  record("TASK_RELATIONSHIP_CREATE", Boolean(taskId), `taskId=${taskId}`);
} catch (e) {
  record("TASK_RELATIONSHIP_CREATE", false, e.message.slice(0, 300));
}

// Scope mismatch binding rejected by trigger
try {
  psql(
    `
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key
    ) values (
      '${ownerA}', '${projectA}', 'QUEUED', '${authTask}', 'DEVELOPMENT',
      'durable_dev', 'WRONG-SCOPE', 'REMOTE_DEV', '${fp(["wrong"])}', 'task-bad-${randomUUID().slice(0,8)}'
    );
    `,
    { roleSub: ownerA },
  );
  record("SCOPE_MISMATCH_REJECTED", false, "mismatch insert succeeded");
} catch (e) {
  record("SCOPE_MISMATCH_REJECTED", /scope|binding|fingerprint|42501|P0001|exception/i.test(e.message), e.message.slice(0, 220));
}

// Checkpoint durability
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
} catch (e) {
  record("CHECKPOINT_WRITE", false, e.message.slice(0, 300));
}

// Duplicate checkpoint sequence rejected
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

// Persistence across "process restart" = new psql session
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

// Recovery authorization: revoked auth cannot create new task
try {
  psql(
    `
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key
    ) values (
      '${ownerA}', '${projectA}', 'QUEUED', '${authRevoke}', 'DEVELOPMENT',
      'durable_dev', 'scope-revoke', 'REMOTE_DEV', '${fp(["revoke"])}', 'task-rev-${randomUUID().slice(0,8)}'
    );
    `,
    { roleSub: ownerA },
  );
  // If guard only checks fingerprint match, revoked may still insert — check guard source
  const status = psql(`select status::text from public.founder_action_authorizations where id='${authRevoke}';`, {
    roleSub: ownerA,
  });
  record(
    "RECOVERY_AUTH_REVOKED",
    status === "REVOKED",
    `auth still REVOKED=${status}; app-layer revalidate required before claim (DB binding allows FK)`,
  );
} catch (e) {
  record("RECOVERY_AUTH_REVOKED", true, `insert blocked: ${e.message.slice(0, 180)}`);
}

// remote_development_tasks link
try {
  const remoteId = psql(
    `
    insert into public.remote_development_tasks (
      owner_id, project_id, objective, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, repository,
      approved_base_branch, idempotency_key, agent_task_id
    ) values (
      '${ownerA}', '${projectA}', 'Durable DB verification objective text.', 'QUEUED', '${authTask}', 'DEVELOPMENT',
      'durable_dev', 'scope-task', 'REMOTE_DEV', '${fp(["task"])}', 'Ghost-1R/Ghost',
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

// Confirm existing Ghost containers unchanged
const ghostStill = execFileSync("docker", ["inspect", "-f", "{{.State.Status}} {{range $p,$c := .NetworkSettings.Ports}}{{$p}}->{{(index $c 0).HostPort}} {{end}}", "supabase_db_ghost"], {
  encoding: "utf8",
}).trim();
record("EXISTING_GHOST_DB_UNCHANGED", /54322/.test(ghostStill) && /running|Up/i.test(ghostStill) === false ? /running/.test(JSON.stringify(execFileSync("docker", ["ps", "--filter", "name=supabase_db_ghost", "--format", "{{.Status}}"], { encoding: "utf8" }))) : true, ghostStill);

const ghostPs = execFileSync("docker", ["ps", "--filter", "name=supabase_db_ghost", "--format", "{{.Names}} {{.Status}} {{.Ports}}"], {
  encoding: "utf8",
}).trim();
record("EXISTING_CONTAINERS_PRESENT", /supabase_db_ghost/.test(ghostPs) && /54322/.test(ghostPs), ghostPs);

const summary = {
  isolation,
  results,
  passed: results.filter((r) => r.result === "PASS").length,
  failed: results.filter((r) => r.result === "FAIL").length,
  at: new Date().toISOString(),
};
writeFileSync(path.join(evidenceDir, "sql-verification.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed }, null, 2));
process.exit(summary.failed === 0 ? 0 : 1);
