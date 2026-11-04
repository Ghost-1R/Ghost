/**
 * Pilot 04 — prepare fresh PENDING authorization on existing Pilot 03 project.
 * Reuses project f5397422… with remaining 99¢ — does NOT top up allowance.
 * No approve / queue / live dispatch / provider calls.
 * Does not reuse Pilot 03 authorization 5aee1635….
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const disposableRoot = path.resolve(root, "..", "ghost-09-9f-supabase");
const evidenceDir = path.join(root, ".ghost", "pilot-04", "evidence");
mkdirSync(evidenceDir, { recursive: true });

const REQUIRED_DB = "supabase_db_ghost99f";
const REQUIRED_API_PORT = "54331";
const REQUIRED_DB_PORT = "55432";
const FOUNDER_EMAIL = "pilot02-owner-a3446b04@ghost.local";
const FOUNDER_ID = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const PROJECT_ID = "f5397422-1c9d-4ef5-b639-8eee89981f5e";
const PILOT_03_AUTH = "5aee1635-62c3-4ab6-8237-060ee4bc1b16";
const TITLE = "Generate Responsive Vehicle Comparison Component — Pilot 04";
const OBJECTIVE =
  "Generate original HTML, CSS, and JavaScript for a responsive vehicle comparison component with three fictional rental cars, prices, features, and accessible interactive selection. Pilot 04.";

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

function assertIsolation() {
  const ghostDb = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0];
  const disposableDb = JSON.parse(execFileSync("docker", ["inspect", REQUIRED_DB], { encoding: "utf8" }))[0];
  const ghostPort = ghostDb?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  const disposablePort = disposableDb?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
  const disposableNets = Object.keys(disposableDb?.NetworkSettings?.Networks ?? {});
  const kong = JSON.parse(execFileSync("docker", ["inspect", "supabase_kong_ghost99f"], { encoding: "utf8" }))[0];
  const apiPort = kong?.NetworkSettings?.Ports?.["8000/tcp"]?.[0]?.HostPort;
  if (ghostPort !== "54322") throw new Error(`Ghost DB port unexpected: ${ghostPort}`);
  if (disposablePort !== REQUIRED_DB_PORT) throw new Error(`Disposable DB port unexpected: ${disposablePort}`);
  if (apiPort !== REQUIRED_API_PORT) throw new Error(`API port unexpected: ${apiPort}`);
  if (disposableNets.includes("supabase_network_ghost")) throw new Error("Shares Ghost network");
  return { ghostPort, disposablePort, apiPort };
}

const isolation = assertIsolation();
const statusText = execFileSync("npx", ["supabase", "status", "-o", "env"], {
  cwd: disposableRoot,
  encoding: "utf8",
  shell: true,
});
const local = parseStatusEnv(statusText);
if (local.API_URL !== `http://127.0.0.1:${REQUIRED_API_PORT}`) {
  throw new Error(`API_URL mismatch: ${local.API_URL}`);
}

process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = local.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = local.SERVICE_ROLE_KEY;
process.env.GHOST_CODEGEN_LIVE_ENABLED = "0";
process.env.OPENAI_API_KEY = "";

const loginPath = path.join(root, ".ghost", "pilot-02", "founder-ui-login.local.json");
const login = JSON.parse(readFileSync(loginPath, "utf8").replace(/^\uFEFF/, ""));
if (login.email !== FOUNDER_EMAIL || login.ownerId !== FOUNDER_ID) {
  throw new Error("Founder login file identity mismatch — refusing setup.");
}

const { createDurableDevelopmentRequest } = await import(
  pathToFileURL(path.join(root, "src/lib/remote-development/durable-workflow.ts")).href
);
const { loadSqlAllowanceSnapshot } = await import(
  pathToFileURL(path.join(root, "src/lib/allowance/sql-ledger.ts")).href
);
const { buildCodegenTaskContract, encodeCodegenScopeFragment } = await import(
  pathToFileURL(path.join(root, "src/lib/codegen/request-contract.ts")).href
);
const { isCodegenLiveEnabled } = await import(
  pathToFileURL(path.join(root, "src/lib/codegen/provider-config.ts")).href
);
const { developmentApprovalGrantsDeployment } = await import(
  pathToFileURL(path.join(root, "src/lib/agent-runtime/authorization-kind.ts")).href
);
const { PILOT_04_MAX_TRIAL_CENTS, estimatePilotLiveWorstCaseCents } = await import(
  pathToFileURL(path.join(root, "src/lib/codegen/openai-models.ts")).href
);

if (isCodegenLiveEnabled()) throw new Error("Live flag must stay disabled");
if (developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT")) {
  throw new Error("Development must not grant deployment");
}

const founder = createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const signed = await founder.auth.signInWithPassword({
  email: login.email,
  password: login.password,
});
if (signed.error || !signed.data.user) {
  throw new Error(`Founder sign-in failed: ${signed.error?.message ?? "no user"}`);
}
if (signed.data.user.id !== FOUNDER_ID) {
  throw new Error(`Signed-in user id mismatch: ${signed.data.user.id}`);
}

const { data: project, error: projectErr } = await founder
  .from("projects")
  .select("id, name, company_id, companies!inner(owner_id)")
  .eq("id", PROJECT_ID)
  .maybeSingle();
if (projectErr || !project) throw new Error(`Project load failed: ${projectErr?.message ?? "missing"}`);
const ownerId = project.companies?.owner_id ?? project.companies?.[0]?.owner_id;
if (ownerId !== FOUNDER_ID) throw new Error(`Project owner mismatch: ${ownerId}`);

const snap = await loadSqlAllowanceSnapshot(founder, FOUNDER_ID, PROJECT_ID);
if (snap.status !== "ok") throw new Error(snap.message);
if (snap.data.availableCents !== 99) {
  throw new Error(`Expected available 99¢, got ${snap.data.availableCents} — refusing silent top-up`);
}
if (snap.data.chargedCents !== 1) {
  throw new Error(`Expected charged 1¢ from Pilot 03, got ${snap.data.chargedCents}`);
}

const maxSpendUsd = PILOT_04_MAX_TRIAL_CENTS / 100;
const worstCaseCents = estimatePilotLiveWorstCaseCents("gpt-5-mini");
if (worstCaseCents > PILOT_04_MAX_TRIAL_CENTS) {
  throw new Error(`Worst-case ${worstCaseCents}¢ exceeds available ${PILOT_04_MAX_TRIAL_CENTS}¢`);
}

const contract = buildCodegenTaskContract({
  providerId: "openai",
  model: "gpt-5-mini",
  classification: "PUBLIC",
  objective: OBJECTIVE,
  maxSpendUsd,
});
if (!contract.ok) throw new Error(contract.message);

const created = await createDurableDevelopmentRequest(founder, {
  ownerId: FOUNDER_ID,
  projectId: PROJECT_ID,
  projectName: project.name,
  objective: OBJECTIVE,
  repository: "Ghost-1R/Ghost",
  approvedBaseBranch: "cursor/pilot-04-first-success-prep",
  environmentLabel: "LOCAL_PILOT_04",
  maxEstimatedCostUsd: maxSpendUsd,
  maxDurationMs: 3_600_000,
  requirements: `TITLE: ${TITLE}. PUBLIC fictional data only. No customer data. No payments. No deployment. No public publishing. One future provider invocation after separate founder approval. Mandatory founder review.`,
  evidenceSource: "pilot_04_founder_setup",
  evidenceReference: `setup-${randomUUID().slice(0, 8)}`,
  idempotencyKey: `pilot04-founder-pending-${randomUUID()}`,
  requestKind: "CODEGEN_PILOT_03",
  codegenScopeFragment: encodeCodegenScopeFragment(contract.contract),
});
if (!created.ok) throw new Error(`${created.reason}: ${created.message}`);

const remote = created.data.remote;
const auth = created.data.authorization;
if (remote.status !== "AWAITING_APPROVAL") {
  throw new Error(`Expected AWAITING_APPROVAL remote, got ${remote.status}`);
}
if (auth.status !== "PENDING") {
  throw new Error(`Expected PENDING authorization, got ${auth.status}`);
}
if (auth.useCount !== 0) throw new Error("Authorization must be unused");
if (auth.id === PILOT_03_AUTH) throw new Error("Must not reuse Pilot 03 authorization");

const out = {
  ok: true,
  isolation,
  TITLE,
  OBJECTIVE,
  PILOT_04_REMOTE_TASK_ID: remote.id,
  PILOT_04_AUTHORIZATION_ID: auth.id,
  PROJECT_ID,
  FOUNDER_ID,
  AUTH_STATUS: auth.status,
  AUTH_USES: auth.useCount,
  REMOTE_STATUS: remote.status,
  MAX_SPEND_USD: maxSpendUsd,
  WORST_CASE_ESTIMATE_CENTS: worstCaseCents,
  ALLOWANCE_AVAILABLE_CENTS: snap.data.availableCents,
  ALLOWANCE_CHARGED_CENTS: snap.data.chargedCents,
  ALLOWANCE_TOPPED_UP: false,
  LIVE_ENABLED: false,
  PILOT_03_AUTH_REUSED: false,
  DEPLOYMENT_GRANTED: false,
  PROVIDER_CALLS: 0,
};

writeFileSync(path.join(evidenceDir, "pilot04-pending-setup.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
