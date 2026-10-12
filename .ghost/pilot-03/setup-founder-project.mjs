/**
 * Pilot 03 — founder-owned project + 100¢ allowance + PENDING OpenAI request.
 * Disposable ghost99f only. Authenticates as existing founder (no RLS bypass).
 * No approve / queue / live dispatch / provider calls.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const disposableRoot = path.resolve(root, "..", "ghost-09-9f-supabase");
const evidenceDir = path.join(root, ".ghost", "pilot-03", "evidence");
mkdirSync(evidenceDir, { recursive: true });

const REQUIRED_DB = "supabase_db_ghost99f";
const REQUIRED_API_PORT = "54331";
const REQUIRED_DB_PORT = "55432";
const FOUNDER_EMAIL = "pilot02-owner-a3446b04@ghost.local";
const FOUNDER_ID = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const PROJECT_NAME = "Ghost Pilot 03 — AI Coding Test";
const OBJECTIVE =
  "Use OpenAI gpt-5-mini to generate original responsive HTML, CSS and JavaScript for comparing three fictional rental vehicles, including prices, features and interactive selection.";

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

function slugify(value) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "item";
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
process.env.GHOST_CODEGEN_LIVE_ENABLED = "";
process.env.OPENAI_API_KEY = "";

const loginPath = path.join(root, ".ghost", "pilot-02", "founder-ui-login.local.json");
const login = JSON.parse(readFileSync(loginPath, "utf8").replace(/^\uFEFF/, ""));
if (login.email !== FOUNDER_EMAIL || login.ownerId !== FOUNDER_ID) {
  throw new Error("Founder login file identity mismatch — refusing setup.");
}
if (login.apiUrl !== `http://127.0.0.1:${REQUIRED_API_PORT}`) {
  throw new Error("Founder login API URL is not ghost99f.");
}

const { createDurableDevelopmentRequest } = await import(
  pathToFileURL(path.join(root, "src/lib/remote-development/durable-workflow.ts")).href
);
const { setSqlProjectAllowance, loadSqlAllowanceSnapshot } = await import(
  pathToFileURL(path.join(root, "src/lib/allowance/sql-ledger.ts")).href
);
const {
  buildCodegenTaskContract,
  encodeCodegenScopeFragment,
} = await import(pathToFileURL(path.join(root, "src/lib/codegen/request-contract.ts")).href);
const { isCodegenLiveEnabled } = await import(
  pathToFileURL(path.join(root, "src/lib/codegen/provider-config.ts")).href
);
const { developmentApprovalGrantsDeployment } = await import(
  pathToFileURL(path.join(root, "src/lib/agent-runtime/authorization-kind.ts")).href
);

if (isCodegenLiveEnabled()) throw new Error("Live flag must stay disabled");
if (developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT")) {
  throw new Error("Development must not grant deployment");
}

// Authenticated founder session — anon key + password sign-in (RLS applies).
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

// Ensure profile exists (authenticated upsert pattern used elsewhere).
await founder.from("profiles").upsert({ id: FOUNDER_ID, display_name: "Pilot 03 Founder" });

const { data: companyRow, error: companySelectError } = await founder
  .from("companies")
  .select("id")
  .eq("owner_id", FOUNDER_ID)
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();
if (companySelectError) throw new Error(companySelectError.message);

let companyId = companyRow?.id ?? null;
if (!companyId) {
  const { data: createdCompany, error: companyInsertError } = await founder
    .from("companies")
    .insert({
      owner_id: FOUNDER_ID,
      name: "Workspace",
      slug: "workspace",
      description: "Default founder workspace created with the first project.",
    })
    .select("id")
    .single();
  if (companyInsertError || !createdCompany?.id) {
    throw new Error(`Company create failed: ${companyInsertError?.message ?? "missing id"}`);
  }
  companyId = createdCompany.id;
}

let slug = slugify(PROJECT_NAME);
let projectId = null;
let lastError = null;
for (let attempt = 0; attempt < 2; attempt += 1) {
  const { data, error } = await founder
    .from("projects")
    .insert({
      company_id: companyId,
      name: PROJECT_NAME,
      slug,
      description: "Founder-owned disposable Pilot 03 AI coding trial project. PUBLIC fictional demo only.",
      current_milestone: "Pilot 03 — awaiting founder approval",
      status: "PLANNING",
      repository_url: "https://github.com/Ghost-1R/Ghost",
    })
    .select("id, name, company_id")
    .single();
  if (!error && data) {
    projectId = data.id;
    break;
  }
  lastError = error?.message ?? "Project was not created.";
  if (error?.code !== "23505") break;
  slug = `${slugify(PROJECT_NAME).slice(0, 42)}-${Math.random().toString(36).slice(2, 6)}`;
}
if (!projectId) throw new Error(`Authenticated project creation failed: ${lastError}`);

await founder.from("milestones").insert({
  project_id: projectId,
  title: "Pilot 03 — awaiting founder approval",
  description: "",
  status: "PLANNING",
  position: 0,
});

// Ownership verification via RLS (founder client must see the row).
const { data: owned, error: ownErr } = await founder
  .from("projects")
  .select("id, name, company_id, companies!inner(owner_id)")
  .eq("id", projectId)
  .maybeSingle();
if (ownErr || !owned) throw new Error(`Ownership verify failed: ${ownErr?.message ?? "not visible"}`);
const ownerId = owned.companies?.owner_id ?? owned.companies?.[0]?.owner_id;
if (ownerId !== FOUNDER_ID) throw new Error(`Project owner mismatch: ${ownerId}`);

const allowanceSet = await setSqlProjectAllowance(founder, {
  ownerId: FOUNDER_ID,
  projectId,
  allowanceCents: 100,
});
if (allowanceSet.status !== "ok") {
  throw new Error(`Allowance set failed: ${allowanceSet.message}`);
}

const snap1 = await loadSqlAllowanceSnapshot(founder, FOUNDER_ID, projectId);
if (snap1.status !== "ok") throw new Error(snap1.message);
if (
  snap1.data.allowanceCents !== 100 ||
  snap1.data.reservedCents !== 0 ||
  snap1.data.chargedCents !== 0 ||
  snap1.data.availableCents !== 100
) {
  throw new Error(`Allowance snapshot unexpected: ${JSON.stringify(snap1.data)}`);
}

// Fresh DB session persistence check (new authenticated client).
const founder2 = createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const signed2 = await founder2.auth.signInWithPassword({
  email: login.email,
  password: login.password,
});
if (signed2.error) throw new Error(`Re-auth failed: ${signed2.error.message}`);
const snap2 = await loadSqlAllowanceSnapshot(founder2, FOUNDER_ID, projectId);
if (snap2.status !== "ok") throw new Error(snap2.message);
if (snap2.data.availableCents !== 100 || snap2.data.reservedCents !== 0 || snap2.data.chargedCents !== 0) {
  throw new Error("Allowance did not persist across new session");
}

const contract = buildCodegenTaskContract({
  providerId: "openai",
  model: "gpt-5-mini",
  classification: "PUBLIC",
  objective: OBJECTIVE,
  maxSpendUsd: 1,
});
if (!contract.ok) throw new Error(contract.message);

const created = await createDurableDevelopmentRequest(founder, {
  ownerId: FOUNDER_ID,
  projectId,
  projectName: PROJECT_NAME,
  objective: OBJECTIVE,
  repository: "Ghost-1R/Ghost",
  approvedBaseBranch: "cursor/pilot-03-real-ai-coding-prep",
  environmentLabel: "LOCAL_PILOT_03",
  maxEstimatedCostUsd: 1,
  maxDurationMs: 3_600_000,
  requirements:
    "TITLE: Generate Vehicle Comparison Component. No real customer data. No external publishing. Deployment forbidden.",
  evidenceSource: "pilot_03_founder_setup",
  evidenceReference: `setup-${randomUUID().slice(0, 8)}`,
  idempotencyKey: `pilot03-founder-live-prep-${randomUUID()}`,
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
if (!auth.actionScope.includes("provider=openai") || !auth.actionScope.includes("model=gpt-5-mini")) {
  throw new Error("Scope missing openai/gpt-5-mini");
}
if (!auth.actionScope.includes("deploy=false")) throw new Error("Scope must forbid deployment");
if (auth.environmentLabel !== "LOCAL_PILOT_03") throw new Error("Environment mismatch");

const report = {
  status: "PILOT_03_AWAITING_FOUNDER_APPROVAL",
  isolation,
  projectId,
  projectName: PROJECT_NAME,
  projectOwnerId: FOUNDER_ID,
  projectOwnerEmail: FOUNDER_EMAIL,
  companyId,
  allowance: {
    allowanceCents: 100,
    reservedCents: 0,
    chargedCents: 0,
    availableCents: 100,
    currency: "USD",
  },
  taskId: remote.id,
  taskStatus: remote.status,
  authorizationId: auth.id,
  authorizationStatus: auth.status,
  authorizationFingerprint: auth.scopeFingerprint,
  actionScope: auth.actionScope,
  environmentLabel: auth.environmentLabel,
  reusePolicy: auth.reusePolicy,
  expiresAt: auth.expiresAt,
  approvalsUrl: "http://127.0.0.1:3012/approvals",
  developmentTasksUrl: "http://127.0.0.1:3012/development-tasks",
  loginUrl: "http://127.0.0.1:3012/login",
  openaiCredentialPresent: false,
  liveFlagEnabled: false,
  providerBillingVerified: false,
  approved: false,
  queued: false,
  liveDispatched: false,
  realProviderCalls: 0,
  actualSpendUsd: 0,
  productionChanged: false,
  at: new Date().toISOString(),
};

writeFileSync(path.join(evidenceDir, "founder-project-setup.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
