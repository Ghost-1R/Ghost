/**
 * Pilot 02 resume — after genuine Founder UI APPROVED.
 * Queue → claim → restricted Docker car-rental validation → AWAITING_FOUNDER_REVIEW.
 * No general workers. No auto-accept. No second consume.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const disposableRoot = path.resolve(root, "..", "ghost-09-9f-supabase");
const evidenceDir = path.join(root, ".ghost", "pilot-02", "evidence");
mkdirSync(evidenceDir, { recursive: true });

const AUTH_ID = "b549744a-a3ad-4694-ba23-89bc040091ea";
const TASK_ID = "1513be21-f47b-4092-8ce4-8e14c538557b";
const OWNER_ID = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const PROJECT_ID = "da4946e5-2afc-497c-8302-05738f803d18";
const EXPECTED_FP = "4ee06168d3cc4470cb71093a6c830612ecc5f27840ffd080c4b96f8efad40993";
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
  return { hostPort, apiPort, ghostPort, volume: "supabase_db_ghost99f" };
}

function sql(query) {
  return execFileSync(
    "docker",
    ["exec", "-i", REQUIRED_DB, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", query],
    { encoding: "utf8" },
  ).trim();
}

const transitions = [];
function note(label, detail) {
  transitions.push({ at: new Date().toISOString(), label, detail: String(detail).slice(0, 500) });
  console.log(`STATE ${label}: ${String(detail).slice(0, 220)}`);
}

const isolation = assertIsolation();
console.log("PASS ISOLATION", JSON.stringify(isolation));

const statusText = execFileSync("npx", ["supabase", "status", "-o", "env"], {
  cwd: disposableRoot,
  encoding: "utf8",
  shell: true,
});
const local = parseStatusEnv(statusText);
if (local.API_URL !== `http://127.0.0.1:${REQUIRED_API_PORT}`) {
  throw new Error(`API mismatch ${local.API_URL}`);
}

process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = local.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = local.SERVICE_ROLE_KEY;
process.env.GHOST_LOCAL_DB_CONTAINER = REQUIRED_DB;
process.env.GHOST_09_9F_REQUIRE_DISPOSABLE = "1";
process.env.GHOST_ISOLATED_PILOT_ENABLED = "1";
delete process.env.GHOST_AGENT_EXECUTION_ENABLED;

const authBefore = sql(`
  select status::text||'|uses='||use_count||'|reuse='||reuse_policy::text||'|action='||action_type
    ||'|env='||environment_label||'|owner='||owner_id||'|project='||project_id||'|fp='||scope_fingerprint
    ||'|exp_ok='||(expires_at>now())::text||'|revoked='||(revoked_at is not null)::text
    ||'|consumed='||(consumed_at is not null)::text
  from public.founder_action_authorizations where id='${AUTH_ID}'
`);
const taskBefore = sql(`
  select status::text||'|owner='||owner_id||'|project='||project_id||'|auth='||authorization_id
    ||'|agent='||coalesce(agent_task_id::text,'null')
  from public.remote_development_tasks where id='${TASK_ID}'
`);
console.log("AUTH_BEFORE", authBefore);
console.log("TASK_BEFORE", taskBefore);

if (!authBefore.startsWith("APPROVED|uses=0|reuse=ONE_TIME|action=agent_task.develop|env=LOCAL_PILOT")) {
  throw new Error(`Authorization invariants failed: ${authBefore}`);
}
if (!authBefore.includes(`owner=${OWNER_ID}`) || !authBefore.includes(`project=${PROJECT_ID}`)) {
  throw new Error("Owner/project mismatch");
}
if (!authBefore.includes(`fp=${EXPECTED_FP}`) || !authBefore.includes("exp_ok=true") || !authBefore.includes("revoked=false")) {
  throw new Error("Fingerprint/expiry/revocation invariant failed");
}
if (!authBefore.includes("consumed=false")) {
  throw new Error("Authorization already consumed — refusing second execution");
}
if (!taskBefore.startsWith("AWAITING_APPROVAL|") || !taskBefore.includes(`auth=${AUTH_ID}`) || !taskBefore.includes("agent=null")) {
  throw new Error(`Task not ready for single resume: ${taskBefore}`);
}
if (!taskBefore.includes(`owner=${OWNER_ID}`) || !taskBefore.includes(`project=${PROJECT_ID}`)) {
  throw new Error("Task owner/project mismatch");
}

note("AUTH_VERIFIED", "APPROVED uses=0 ONE_TIME develop LOCAL_PILOT");
note("TASK_VERIFIED", "AWAITING_APPROVAL unbound");

const loginPath = path.join(root, ".ghost", "pilot-02", "founder-ui-login.local.json");
const loginRaw = readFileSync(loginPath, "utf8").replace(/^\uFEFF/, "");
const login = JSON.parse(loginRaw);
if (login.ownerId !== OWNER_ID || login.authorizationId !== AUTH_ID) {
  throw new Error("Login file identity mismatch");
}
if (login.apiUrl !== local.API_URL) {
  throw new Error("Login file API mismatch");
}

const client = createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const signed = await client.auth.signInWithPassword({
  email: login.email,
  password: login.password,
});
if (signed.error || !signed.data.user) {
  throw new Error(`Owner sign-in failed: ${signed.error?.message ?? "no user"}`);
}
if (signed.data.user.id !== OWNER_ID) {
  throw new Error("Signed-in user is not the authorization owner");
}
console.log("PASS OWNER_SESSION", signed.data.user.id);

const {
  queueDurableDevelopmentTask,
  loadDurableDevelopmentBundle,
  revalidateDurableDevelopmentStep,
  persistDurableRemoteStatus,
} = await import(pathToFileURL(path.join(root, "src/lib/remote-development/durable-workflow.ts")).href);
const {
  claimAgentTaskWithRevalidation,
  executeAgentTaskStepWithRevalidation,
  completeAgentTaskWithRevalidation,
} = await import(pathToFileURL(path.join(root, "src/lib/agent-runtime/contract.ts")).href);
const { persistAgentTaskState, insertAgentTaskCheckpoint, appendAgentTaskEvent } = await import(
  pathToFileURL(path.join(root, "src/lib/agent-runtime/queries.ts")).href
);
const { runCarRentalValidationPilot } = await import(
  pathToFileURL(path.join(root, "src/lib/pilot-02/docker-validate.ts")).href
);
const { developmentApprovalGrantsDeployment } = await import(
  pathToFileURL(path.join(root, "src/lib/agent-runtime/authorization-kind.ts")).href
);

if (developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT")) {
  throw new Error("Development must not grant deployment");
}

const queued = await queueDurableDevelopmentTask(client, {
  ownerId: OWNER_ID,
  remoteTaskId: TASK_ID,
});
if (!queued.ok) {
  throw new Error(`Queue failed: ${queued.reason} ${queued.message}`);
}
note("QUEUED", `agent=${queued.data.agent?.id} auth=${queued.data.authorization.status}`);
if (queued.data.authorization.status !== "CONSUMED") {
  throw new Error(`Expected CONSUMED after queue, got ${queued.data.authorization.status}`);
}
if (!queued.data.authorizationConsumed || !queued.data.agent?.authorizationConsumed) {
  throw new Error("Expected authorizationConsumed on agent after queue");
}
if (queued.data.remote.status !== "QUEUED" || !queued.data.remote.agentTaskId) {
  throw new Error("Queue bind incomplete");
}

const agentTaskId = queued.data.remote.agentTaskId;
const leaseToken = `pilot02-lease-${randomUUID()}`;

const claimed = claimAgentTaskWithRevalidation(queued.data.agent, queued.data.authorization, {
  taskId: agentTaskId,
  ownerId: OWNER_ID,
  claimantId: OWNER_ID,
  leaseToken,
});
if (!claimed.ok) {
  throw new Error(`Claim failed: ${claimed.reason} ${claimed.message}`);
}
if (claimed.shouldConsume) {
  throw new Error("Claim must not re-consume after durable queue");
}
const claimedPersist = await persistAgentTaskState(client, claimed.task);
if (claimedPersist.status === "error") throw new Error(claimedPersist.message);
if (claimed.audit) {
  await appendAgentTaskEvent(client, { ...claimed.audit, ownerId: OWNER_ID });
}
note("CLAIMED", `agent=${agentTaskId} shouldConsume=false`);

const stepGate = await revalidateDurableDevelopmentStep(client, {
  ownerId: OWNER_ID,
  remoteTaskId: TASK_ID,
});
if (!stepGate.ok) {
  throw new Error(`Step gate failed: ${stepGate.reason} ${stepGate.message}`);
}

const runningRemote = await persistDurableRemoteStatus(client, {
  ownerId: OWNER_ID,
  remoteTaskId: TASK_ID,
  toStatus: "RUNNING",
  expectedStatus: "QUEUED",
  detail: "Pilot 02 supervised restricted Docker car-rental validation started.",
});
if (!runningRemote.ok) throw new Error(`RUNNING transition failed: ${runningRemote.message}`);
note("REMOTE_RUNNING", runningRemote.data.status);

const runStep = executeAgentTaskStepWithRevalidation(claimedPersist.data, stepGate.data.authorization, {
  taskId: agentTaskId,
  ownerId: OWNER_ID,
  claimantId: OWNER_ID,
  leaseToken,
  stepIdempotencyKey: "pilot02-docker-validate",
  stepLabel: "car-rental-docker-validate",
  progressRef: "fixture:car-rental-validate",
});
if (!runStep.ok) {
  throw new Error(`Execute step failed: ${runStep.reason} ${runStep.message}`);
}
const stepPersist = await persistAgentTaskState(client, runStep.task);
if (stepPersist.status === "error") throw new Error(stepPersist.message);
if (runStep.checkpoint) {
  const cp = await insertAgentTaskCheckpoint(client, {
    ownerId: OWNER_ID,
    taskId: agentTaskId,
    checkpoint: runStep.checkpoint,
  });
  if (cp.status === "error") throw new Error(cp.message);
  note("CHECKPOINT", `seq=${runStep.checkpoint.sequence} id=${runStep.checkpoint.id}`);
}
if (runStep.audit) {
  await appendAgentTaskEvent(client, { ...runStep.audit, ownerId: OWNER_ID });
}

console.log("DOCKER_START car-rental validation");
const dockerReport = runCarRentalValidationPilot({
  workspaceRoot: path.join(process.env.TEMP || process.env.TMP || "/tmp", "ghost-pilot-02-resume-workspaces"),
});
writeFileSync(
  path.join(evidenceDir, "resume-docker-car-rental-validation.json"),
  JSON.stringify(dockerReport, null, 2),
);
const scenarioSummary = (dockerReport.scenarios || [])
  .map((s) => `${s.scenario}:${s.classification}:exit=${s.exitCode}:timeout=${s.timedOut}`)
  .join(",");
const dockerOk =
  dockerReport.realContainerExecution === true &&
  (dockerReport.scenarios || []).every((s) => s.classification === "PASS");
note("DOCKER_DONE", `real=${dockerReport.realContainerExecution} ok=${dockerOk} ${scenarioSummary}`);
if (!dockerOk) {
  await persistDurableRemoteStatus(client, {
    ownerId: OWNER_ID,
    remoteTaskId: TASK_ID,
    toStatus: "FAILED",
    expectedStatus: "RUNNING",
    detail: `Pilot 02 Docker validation failed: ${scenarioSummary}`,
    lastError: { code: "DOCKER_VALIDATION_FAILED", message: scenarioSummary.slice(0, 500) },
  });
  throw new Error(`Docker validation failed: ${scenarioSummary}`);
}

const fresh = await loadDurableDevelopmentBundle(client, OWNER_ID, TASK_ID);
if (!fresh.ok) throw new Error(fresh.message);
const completed = completeAgentTaskWithRevalidation(stepPersist.data, fresh.data.authorization, {
  ownerId: OWNER_ID,
  claimantId: OWNER_ID,
  leaseToken,
});
if (!completed.ok) {
  throw new Error(`Complete failed: ${completed.reason} ${completed.message}`);
}
const completePersist = await persistAgentTaskState(client, completed.task);
if (completePersist.status === "error") throw new Error(completePersist.message);
if (completed.audit) {
  await appendAgentTaskEvent(client, { ...completed.audit, ownerId: OWNER_ID });
}
note("AGENT_SUCCEEDED", completePersist.data.status);

const review = await persistDurableRemoteStatus(client, {
  ownerId: OWNER_ID,
  remoteTaskId: TASK_ID,
  toStatus: "AWAITING_FOUNDER_REVIEW",
  expectedStatus: "RUNNING",
  detail: "Pilot 02 restricted Docker car-rental validation completed. Awaiting independent founder review. Not auto-accepted.",
});
if (!review.ok) throw new Error(`Review transition failed: ${review.message}`);
note("AWAITING_FOUNDER_REVIEW", review.data.status);

// Refuse second queue / second consume
const secondQueue = await queueDurableDevelopmentTask(client, {
  ownerId: OWNER_ID,
  remoteTaskId: TASK_ID,
});
note("SECOND_QUEUE_BLOCKED", secondQueue.ok ? "UNEXPECTED_OK" : `${secondQueue.reason}`);

const authAfter = sql(`
  select status::text||'|uses='||use_count||'|consumed='||(consumed_at is not null)::text
  from public.founder_action_authorizations where id='${AUTH_ID}'
`);
const taskAfter = sql(`
  select status::text||'|agent='||coalesce(agent_task_id::text,'null')
  from public.remote_development_tasks where id='${TASK_ID}'
`);
const agentAfter = sql(`
  select status::text||'|consumed='||authorization_consumed::text||'|ckpt='||checkpoint_sequence
  from public.agent_tasks where id='${agentTaskId}'
`);

const report = {
  finalStatus: "PILOT_02_EXECUTED_AWAITING_FOUNDER_REVIEW",
  disposableDbVerified: isolation,
  authorizationStatusBefore: authBefore,
  taskStatusBefore: taskBefore,
  authorizationStatusAfter: authAfter,
  taskStatusAfter: taskAfter,
  agentStatusAfter: agentAfter,
  approvalConsumption: {
    atQueue: true,
    authStatus: "CONSUMED",
    claimReconsume: false,
    secondQueueBlocked: !secondQueue.ok,
  },
  taskId: TASK_ID,
  authorizationId: AUTH_ID,
  agentTaskId,
  durableStateTransitions: transitions,
  dockerExecution: {
    realContainerExecution: dockerReport.realContainerExecution,
    image: dockerReport.image,
    imageDigest: dockerReport.imageDigest,
    scenarios: (dockerReport.scenarios || []).map((s) => ({
      scenario: s.scenario,
      classification: s.classification,
      exitCode: s.exitCode,
      timedOut: s.timedOut,
      containerName: s.containerName,
      durationMs: s.durationMs,
    })),
    fixtureSha256: dockerReport.fixture?.contentSha256 ?? null,
    attribution: dockerReport.attribution,
  },
  actualCarRentalValidation: dockerOk ? "PASS" : "FAIL",
  checkpoints: runStep.checkpoint
    ? [{ id: runStep.checkpoint.id, sequence: runStep.checkpoint.sequence, label: runStep.checkpoint.label }]
    : [],
  founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
  productionUnchanged: true,
};

const reportBody = JSON.stringify(report, null, 2);
const evidenceHash = createHash("sha256").update(reportBody).digest("hex");
report.evidenceHashes = {
  resumeReportSha256: evidenceHash,
  fixtureContentSha256: dockerReport.fixture?.contentSha256 ?? null,
};
writeFileSync(path.join(evidenceDir, "resume-execute-report.json"), JSON.stringify(report, null, 2));
writeFileSync(
  path.join(evidenceDir, "resume-summary.json"),
  JSON.stringify(
    {
      finalStatus: report.finalStatus,
      taskId: TASK_ID,
      authorizationId: AUTH_ID,
      agentTaskId,
      authAfter,
      taskAfter,
      agentAfter,
      dockerOk,
      evidenceHash,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      finalStatus: report.finalStatus,
      agentTaskId,
      authAfter,
      taskAfter,
      dockerOk,
      evidenceHash,
    },
    null,
    2,
  ),
);
