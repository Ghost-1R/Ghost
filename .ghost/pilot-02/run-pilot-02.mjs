/**
 * Pilot 02 — durable supervised execution on disposable ghost99f.
 * Creates PENDING founder authorization and STOPS at approval gate.
 * Does not fabricate approval. Docker car-rental validation is a separate capability proof.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const disposableRoot = path.resolve(root, "..", "ghost-09-9f-supabase");
const evidenceDir = path.join(root, ".ghost", "pilot-02", "evidence");
mkdirSync(evidenceDir, { recursive: true });

const REQUIRED_DB = "supabase_db_ghost99f";
const REQUIRED_DB_PORT = "55432";
const REQUIRED_API_PORT = "54331";

function parseStatusEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

function assertIsolation() {
  const db = JSON.parse(execFileSync("docker", ["inspect", REQUIRED_DB], { encoding: "utf8" }))[0];
  const hostPort = db?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  const networks = Object.keys(db?.NetworkSettings?.Networks ?? {});
  if (hostPort !== REQUIRED_DB_PORT) throw new Error(`Bad DB port ${hostPort}`);
  if (networks.includes("supabase_network_ghost")) throw new Error("Shares Ghost network");
  const ghost = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0];
  const ghostPort = ghost?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  if (ghostPort !== "54322") throw new Error(`Ghost DB unexpected ${ghostPort}`);
  const kong = JSON.parse(execFileSync("docker", ["inspect", "supabase_kong_ghost99f"], { encoding: "utf8" }))[0];
  const apiPort = kong?.NetworkSettings?.Ports?.["8000/tcp"]?.[0]?.HostPort;
  if (apiPort !== REQUIRED_API_PORT) throw new Error(`Bad API port ${apiPort}`);
  return { hostPort, networks, ghostPort, apiPort, volume: "supabase_db_ghost99f" };
}

function sql(query) {
  const out = execFileSync(
    "docker",
    ["exec", "-i", REQUIRED_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", query],
    { encoding: "utf8" },
  ).trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(INSERT|UPDATE|DELETE)/i.test(l));
  const ids = lines.filter((l) => uuid.test(l));
  if (ids.length === 1) return ids[0];
  return lines.join("\n") || out;
}

const isolation = assertIsolation();
const statusText = execFileSync("npx", ["supabase", "status", "-o", "env"], {
  cwd: disposableRoot,
  encoding: "utf8",
  shell: true,
});
const local = parseStatusEnv(statusText);
if (local.API_URL !== `http://127.0.0.1:${REQUIRED_API_PORT}`) throw new Error(`API mismatch ${local.API_URL}`);

process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = local.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = local.SERVICE_ROLE_KEY;
process.env.GHOST_LOCAL_DB_CONTAINER = REQUIRED_DB;
process.env.GHOST_09_9F_REQUIRE_DISPOSABLE = "1";

const { createDurableDevelopmentRequest, queueDurableDevelopmentTask, loadDurableDevelopmentBundle } = await import(
  pathToFileURL(path.join(root, "src/lib/remote-development/durable-workflow.ts")).href
);
const { loadAuthorizationById } = await import(
  pathToFileURL(path.join(root, "src/lib/approvals/queries.ts")).href
);
const { developmentApprovalGrantsDeployment } = await import(
  pathToFileURL(path.join(root, "src/lib/agent-runtime/authorization-kind.ts")).href
);

async function createUser(label) {
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `pilot02-${label}-${randomUUID().slice(0, 8)}@ghost.local`;
  const password = `LocalTest-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(created.error?.message ?? "createUser");
  const client = createClient(local.API_URL, local.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(signed.error.message);
  return { id: created.data.user.id, client };
}

function seedProject(userId, slug) {
  const companyId = randomUUID();
  const projectId = randomUUID();
  sql(`
    insert into public.profiles (id, display_name) values ('${userId}', 'Pilot02') on conflict (id) do nothing;
    insert into public.companies (id, owner_id, name, slug)
    values ('${companyId}', '${userId}', 'Pilot02 Co', 'p02-co-${slug}');
    insert into public.projects (id, company_id, name, slug, description, status)
    values ('${projectId}', '${companyId}', 'Pilot02 Proj', 'p02-proj-${slug}', 'synthetic', 'IDEA');
  `);
  return projectId;
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, result: ok ? "PASS" : "FAIL", detail: String(detail).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${String(detail).slice(0, 220)}`);
}

record("ISOLATION", true, JSON.stringify(isolation));

const owner = await createUser("owner");
const other = await createUser("other");
const projectId = seedProject(owner.id, randomUUID().slice(0, 8));
const foreignProjectId = seedProject(other.id, randomUUID().slice(0, 8));

const created = await createDurableDevelopmentRequest(owner.client, {
  ownerId: owner.id,
  projectId,
  projectName: "Pilot02 Proj",
  objective: "Validate the previously prepared car rental sample using a restricted Docker runner and return the actual validation results to the founder.",
  repository: "Ghost-1R/Ghost",
  approvedBaseBranch: "cursor/pilot-02-durable-supervised-execution",
  environmentLabel: "LOCAL_PILOT",
  maxEstimatedCostUsd: 1,
  maxDurationMs: 3_600_000,
  idempotencyKey: `pilot02-${randomUUID()}`,
  requirements: "Pilot 02 durable supervised execution — DEVELOPMENT ONE_TIME LOCAL_PILOT. No deployment.",
  evidenceSource: "pilot_02",
  evidenceReference: "car-rental-validate-fixture",
});

if (!created.ok) {
  record("DURABLE_REQUEST_CREATE", false, `${created.reason}: ${created.message}`);
  writeFileSync(path.join(evidenceDir, "pilot-02-report.json"), JSON.stringify({ results }, null, 2));
  process.exit(1);
}

const authId = created.data.authorization.id;
const remoteId = created.data.remote.id;
record(
  "DURABLE_REQUEST_CREATE",
  created.data.authorization.status === "PENDING" && created.data.remote.status === "AWAITING_APPROVAL",
  `auth=${authId} remote=${remoteId} authStatus=${created.data.authorization.status} remoteStatus=${created.data.remote.status}`,
);

// Persistence across new session
const reloaded = await loadDurableDevelopmentBundle(owner.client, owner.id, remoteId);
record(
  "DURABLE_PERSISTENCE",
  reloaded.ok &&
    reloaded.data.authorization.id === authId &&
    reloaded.data.authorization.status === "PENDING" &&
    reloaded.data.remote.status === "AWAITING_APPROVAL",
  reloaded.ok
    ? `reload auth=${reloaded.data.authorization.status} remote=${reloaded.data.remote.status}`
    : reloaded.message,
);

// Queue without approval must fail
const earlyQueue = await queueDurableDevelopmentTask(owner.client, {
  ownerId: owner.id,
  remoteTaskId: remoteId,
});
record("MISSING_APPROVAL_BLOCKS_QUEUE", !earlyQueue.ok, earlyQueue.ok ? "queue unexpectedly succeeded" : earlyQueue.reason);

// Cross-owner cannot load
const foreignLoad = await loadDurableDevelopmentBundle(other.client, other.id, remoteId);
record("CROSS_OWNER_DENIED", !foreignLoad.ok, foreignLoad.ok ? "leak" : foreignLoad.reason ?? "denied");

// Cross-project create denied
const crossProj = await createDurableDevelopmentRequest(owner.client, {
  ownerId: owner.id,
  projectId: foreignProjectId,
  projectName: "Foreign",
  objective: "Should fail closed for unowned project binding.",
  repository: "Ghost-1R/Ghost",
  approvedBaseBranch: "cursor/pilot-02-durable-supervised-execution",
  environmentLabel: "LOCAL_PILOT",
  maxEstimatedCostUsd: 1,
  maxDurationMs: 3_600_000,
  idempotencyKey: `pilot02-xproj-${randomUUID()}`,
});
record("CROSS_PROJECT_DENIED", !crossProj.ok, crossProj.ok ? "unexpected success" : crossProj.reason);

// Deployment never from development
record(
  "DEV_NOT_DEPLOYMENT",
  !developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT"),
  "development does not grant deployment",
);

// Revoked / expired negatives via SQL bind gate (separate fixtures; do not approve Pilot 02 auth)
const ACTION = "agent_task.develop";
const ENV = "LOCAL_PILOT";
function fp(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
function tryBind(authRowId, scope, expectFail) {
  try {
    sql(`
      insert into public.agent_tasks (
        owner_id, project_id, status, authorization_id, authorization_kind,
        action_type, action_scope, environment_label, scope_fingerprint, idempotency_key, authorization_consumed
      ) values (
        '${owner.id}', '${projectId}', 'QUEUED', '${authRowId}', 'DEVELOPMENT',
        '${ACTION}', '${scope}', '${ENV}', '${fp([ENV, ACTION, scope])}', 'p02-neg-${randomUUID().slice(0, 8)}', true
      );
    `);
    record(expectFail ? `NEG_${scope.toUpperCase()}` : `POS_${scope}`, !expectFail, expectFail ? "insert succeeded" : "ok");
  } catch (e) {
    record(expectFail ? `NEG_${scope.toUpperCase()}` : `POS_${scope}`, expectFail, e.message.slice(0, 200));
  }
}

const revokedAuth = sql(`
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by,
    revoked_at, revoked_by, revoke_reason
  ) values (
    '${owner.id}', '${projectId}', '${ENV}', '${ACTION}', 'revoked', '${fp([ENV, ACTION, "revoked"])}',
    'neg', 'REVOKED', 'ONE_TIME', now() + interval '1 hour', 'p02-rev-${randomUUID().slice(0,8)}',
    now(), '${owner.id}', now(), '${owner.id}', 'stop'
  ) returning id;
`);
tryBind(revokedAuth, "revoked", true);

const expiredAuth = sql(`
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by
  ) values (
    '${owner.id}', '${projectId}', '${ENV}', '${ACTION}', 'expired', '${fp([ENV, ACTION, "expired"])}',
    'neg', 'APPROVED', 'ONE_TIME', now() - interval '1 minute', 'p02-exp-${randomUUID().slice(0,8)}',
    now(), '${owner.id}'
  ) returning id;
`);
tryBind(expiredAuth, "expired", true);

// Approval reuse / duplicate consume race on a SEPARATE approved auth (not Pilot 02 main)
const raceAuth = sql(`
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by
  ) values (
    '${owner.id}', '${projectId}', '${ENV}', '${ACTION}', 'race', '${fp([ENV, ACTION, "race"])}',
    'race', 'APPROVED', 'ONE_TIME', now() + interval '1 hour', 'p02-race-${randomUUID().slice(0,8)}',
    now(), '${owner.id}'
  ) returning id;
`);
const consumeSql = `
begin;
with u as (
  update public.founder_action_authorizations
  set use_count = use_count + 1, status = 'CONSUMED', consumed_at = now()
  where id='${raceAuth}' and status='APPROVED' and use_count=0 and expires_at > now()
  returning id
) select count(*)::text from u;
commit;
`;
function raceOnce() {
  const out = spawnSync(
    "docker",
    ["exec", "-i", REQUIRED_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
    { input: consumeSql, encoding: "utf8" },
  );
  const lines = (out.stdout || "").trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l === "0" || l === "1");
  return lines[lines.length - 1] ?? "";
}
const [w1, w2] = await Promise.all([Promise.resolve().then(raceOnce), Promise.resolve().then(raceOnce)]);
const wins = [w1, w2].filter((v) => v === "1").length;
const finalRace = sql(`select use_count::text || ':' || status::text from public.founder_action_authorizations where id='${raceAuth}'`);
record("APPROVAL_REUSE_ATOMIC", wins === 1 && finalRace === "1:CONSUMED", `wins=${wins} final=${finalRace}`);

// Recovery: checkpoint after consumed bind (separate from Pilot 02 PENDING auth)
const consumedAuth = sql(`
  insert into public.founder_action_authorizations (
    owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint,
    reason, status, reuse_policy, expires_at, idempotency_key, decided_at, decided_by, use_count, consumed_at
  ) values (
    '${owner.id}', '${projectId}', '${ENV}', '${ACTION}', 'recover', '${fp([ENV, ACTION, "recover"])}',
    'recover', 'CONSUMED', 'ONE_TIME', now() + interval '1 hour', 'p02-rec-${randomUUID().slice(0,8)}',
    now(), '${owner.id}', 1, now()
  ) returning id;
`);
let recoveryTask;
try {
  recoveryTask = sql(`
    insert into public.agent_tasks (
      owner_id, project_id, status, authorization_id, authorization_kind,
      action_type, action_scope, environment_label, scope_fingerprint, idempotency_key, authorization_consumed
    ) values (
      '${owner.id}', '${projectId}', 'QUEUED', '${consumedAuth}', 'DEVELOPMENT',
      '${ACTION}', 'recover', '${ENV}', '${fp([ENV, ACTION, "recover"])}', 'p02-rec-task-${randomUUID().slice(0,8)}', true
    ) returning id;
  `);
  const ck = sql(`
    insert into public.agent_task_checkpoints (
      task_id, owner_id, sequence, label, progress_ref, authorization_id, scope_fingerprint
    ) values (
      '${recoveryTask}', '${owner.id}', 1, 'recover-step', 'ref:recover', '${consumedAuth}', '${fp([ENV, ACTION, "recover"])}'
    ) returning id;
  `);
  sql(`update public.agent_tasks set last_checkpoint_id='${ck}', checkpoint_sequence=1, status='CHECKPOINT' where id='${recoveryTask}';`);
  const persisted = sql(`
    select status::text || '|' || checkpoint_sequence::text from public.agent_tasks where id='${recoveryTask}';
  `);
  record("RECOVERY_CHECKPOINT", persisted === "CHECKPOINT|1", `state=${persisted}`);
} catch (e) {
  record("RECOVERY_CHECKPOINT", false, e.message.slice(0, 200));
}

// Duplicate claim simulation: second consume on already CONSUMED race auth
const second = sql(`
  with u as (
    update public.founder_action_authorizations
    set use_count = use_count + 1
    where id='${raceAuth}' and status='APPROVED' and use_count=0
    returning id
  ) select count(*)::text from u;
`);
record("DUPLICATE_CLAIM_BLOCKED", second === "0", `updated=${second}`);

// Evidence tampering: rewrite binding blocked
try {
  sql(`update public.agent_tasks set action_scope='tampered' where id='${recoveryTask}';`);
  record("EVIDENCE_TAMPER_BLOCKED", false, "rewrite succeeded");
} catch (e) {
  record("EVIDENCE_TAMPER_BLOCKED", /cannot be rewritten|does not match/i.test(e.message), e.message.slice(0, 180));
}

// IMPORTANT: do NOT approve Pilot 02 authorization — stop at founder gate
const authStill = await loadAuthorizationById(owner.client, owner.id, authId);
record(
  "FOUNDER_APPROVAL_GATE",
  authStill.status === "ok" && authStill.data?.status === "PENDING",
  `status=${authStill.status === "ok" ? authStill.data?.status : authStill.message} — STOPPED awaiting founder`,
);

// Docker car-rental validation capability proof (not post-approval Ghost execution of authorized task)
process.env.GHOST_ISOLATED_PILOT_ENABLED = "1";
delete process.env.GHOST_AGENT_EXECUTION_ENABLED;
const workspaceRoot = path.join(os.tmpdir(), "ghost-pilot-02-workspaces");
mkdirSync(workspaceRoot, { recursive: true });
process.env.GHOST_AGENT_WORKSPACE_ROOT = workspaceRoot;

const { runCarRentalValidationPilot } = await import(
  pathToFileURL(path.join(root, "src/lib/pilot-02/docker-validate.ts")).href
);
const dockerReport = runCarRentalValidationPilot({ workspaceRoot });
const dockerPass =
  dockerReport.realContainerExecution &&
  dockerReport.scenarios.every((s) => s.classification === "PASS");
record(
  "DOCKER_CAR_RENTAL_VALIDATION",
  dockerPass,
  `real=${dockerReport.realContainerExecution} scenarios=${dockerReport.scenarios.map((s) => `${s.scenario}:${s.classification}`).join(",")}`,
);
writeFileSync(path.join(evidenceDir, "docker-car-rental-validation.json"), JSON.stringify(dockerReport, null, 2));

const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();

const report = {
  build: "PILOT_02",
  finalStatus: "GHOST_PILOT_02_AWAITING_FOUNDER_APPROVAL",
  environment: { os: process.platform, host: process.env.COMPUTERNAME, root, branch, head },
  isolation,
  taskId: remoteId,
  authorizationId: authId,
  ownerId: owner.id,
  projectId,
  founderApprovalStatus: "PENDING",
  durableTaskStatus: "AWAITING_APPROVAL",
  agentTaskId: null,
  stateTransitionsObserved: [
    "REQUESTED→AWAITING_APPROVAL/PENDING (created)",
    "QUEUE blocked without approval",
    "STOPPED at founder approval gate (no fabricated APPROVED)",
  ],
  dockerExecution: {
    realContainerExecution: dockerReport.realContainerExecution,
    purpose: dockerReport.purpose,
    attribution: dockerReport.attribution,
    note: dockerReport.note,
    scenarios: dockerReport.scenarios.map((s) => ({
      scenario: s.scenario,
      classification: s.classification,
      exitCode: s.exitCode,
      timedOut: s.timedOut,
    })),
    fixtureSha256: dockerReport.fixture?.contentSha256 ?? null,
  },
  carRentalValidation: dockerPass ? "PASS" : "FAIL",
  securityNegativeTests: results.filter((r) => r.name.startsWith("NEG_") || /CROSS_|MISSING_|REUSE|DUPLICATE|TAMPER|DEV_NOT/.test(r.name)),
  recoveryTest: results.find((r) => r.name === "RECOVERY_CHECKPOINT"),
  results,
  passed: results.filter((r) => r.result === "PASS").length,
  failed: results.filter((r) => r.result === "FAIL").length,
  founderReviewStatus: "AWAITING_FOUNDER_APPROVAL",
  at: new Date().toISOString(),
};

report.evidenceHash = createHash("sha256").update(JSON.stringify(report)).digest("hex");
writeFileSync(path.join(evidenceDir, "pilot-02-report.json"), JSON.stringify(report, null, 2));
writeFileSync(
  path.join(evidenceDir, "summary.json"),
  JSON.stringify(
    {
      finalStatus: report.finalStatus,
      taskId: remoteId,
      authorizationId: authId,
      founderApprovalStatus: "PENDING",
      durableTaskStatus: "AWAITING_APPROVAL",
      dockerCarRentalValidation: dockerPass,
      evidenceHash: report.evidenceHash,
      passed: report.passed,
      failed: report.failed,
    },
    null,
    2,
  ),
);

console.log(JSON.stringify({
  finalStatus: report.finalStatus,
  taskId: remoteId,
  authorizationId: authId,
  passed: report.passed,
  failed: report.failed,
  docker: dockerPass,
}, null, 2));

process.exit(report.failed === 0 ? 0 : 1);
