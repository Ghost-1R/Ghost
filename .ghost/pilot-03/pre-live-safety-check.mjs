/**
 * Final pre-live safety check — READ ONLY.
 * No mutations, no OpenAI calls, no secret printing, no task queue/execute.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(root, ".env.local");

const TASK_ID = "8bdfde20-2f66-4518-9aea-6e632001fe7f";
const AUTH_ID = "5aee1635-62c3-4ab6-8237-060ee4bc1b16";
const PROJECT_ID = "f5397422-1c9d-4ef5-b639-8eee89981f5e";
const FOUNDER_ID = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const EXPECTED_FP = "c98ad5b97432d22a9600990dc664fa43b52a8d24a3932015ee82cf88475fcf71";

function parseDotEnv(text) {
  const map = new Map();
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    map.set(raw.slice(0, eq).trim(), raw.slice(eq + 1).trim());
  }
  return map;
}

const env = parseDotEnv(readFileSync(envPath, "utf8"));
const url = env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const svc = env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const runtime = env.get("GHOST_AGENT_RUNTIME_API_URL") ?? "";
const live = env.get("GHOST_CODEGEN_LIVE_ENABLED") ?? "";
const openaiPresent = Boolean(env.get("OPENAI_API_KEY")?.trim());

const hostedActive = [...env.entries()].some(
  ([k, v]) =>
    /SUPABASE|AGENT_RUNTIME|PRODUCTION_URL/i.test(k) && /supabase\.co/i.test(v ?? ""),
);
const disposableOnly =
  url === "http://127.0.0.1:54331" &&
  runtime === "http://127.0.0.1:54331" &&
  !hostedActive &&
  Boolean(svc);

const supabase = createClient(url, svc, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: task, error: taskErr } = await supabase
  .from("remote_development_tasks")
  .select(
    "id, status, authorization_id, scope_fingerprint, owner_id, project_id, environment_label, deployment_authorized, max_estimated_cost_usd",
  )
  .eq("id", TASK_ID)
  .maybeSingle();
if (taskErr) throw new Error(`task query: ${taskErr.message}`);

const { data: auth, error: authErr } = await supabase
  .from("founder_action_authorizations")
  .select(
    "id, status, expires_at, use_count, max_uses, reuse_policy, owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint, estimated_cost",
  )
  .eq("id", AUTH_ID)
  .maybeSingle();
if (authErr) throw new Error(`auth query: ${authErr.message}`);

const { data: allowance, error: allowErr } = await supabase
  .from("project_ai_allowances")
  .select("allowance_cents, reserved_cents, charged_cents")
  .eq("project_id", PROJECT_ID)
  .eq("owner_id", FOUNDER_ID)
  .maybeSingle();
if (allowErr) throw new Error(`allowance query: ${allowErr.message}`);

const available =
  Number(allowance?.allowance_cents ?? 0) -
  Number(allowance?.charged_cents ?? 0) -
  Number(allowance?.reserved_cents ?? 0);

const scope = auth?.action_scope ?? "";
const scopeChecks = {
  providerOpenai: /(?:^|;|\|)provider=openai(?:;|$)/.test(scope),
  modelGpt5Mini: /(?:^|;|\|)model=gpt-5-mini(?:;|$)/.test(scope),
  classPublic: /(?:^|;|\|)class=PUBLIC(?:;|$)/.test(scope),
  maxCents100: /(?:^|;|\|)maxCents=100(?:;|$)/.test(scope),
  deployFalse: /(?:^|;|\|)deploy=false(?:;|$)/.test(scope),
  dispatchDisabled: /(?:^|;|\|)dispatch=DISABLED(?:;|$)/.test(scope),
  envLocalPilot03: auth?.environment_label === "LOCAL_PILOT_03",
  oneTime: auth?.reuse_policy === "ONE_TIME",
  ownerBind: auth?.owner_id === FOUNDER_ID,
  projectBind: auth?.project_id === PROJECT_ID,
  taskOwnerBind: task?.owner_id === FOUNDER_ID,
  taskProjectBind: task?.project_id === PROJECT_ID,
  taskAuthBind: task?.authorization_id === AUTH_ID,
  noDeployment: task?.deployment_authorized === false,
};

const fingerprintMatch =
  auth?.scope_fingerprint === EXPECTED_FP &&
  task?.scope_fingerprint === EXPECTED_FP &&
  auth?.scope_fingerprint === task?.scope_fingerprint;

const scopeMatch = Object.values(scopeChecks).every(Boolean) && fingerprintMatch;

// Credential rotation: metadata / founder confirmation only — never compare secret values.
let credentialRotation = "NOT_CONFIRMED";
const metaCandidates = [
  path.join(root, ".ghost", "pilot-03", "evidence", "credential-rotation.json"),
  path.join(root, ".ghost", "pilot-03", "CREDENTIAL_ROTATION.md"),
  path.join(root, ".ghost", "pilot-03", "FOUNDER_APPROVAL_HANDOFF.md"),
];
for (const p of metaCandidates) {
  if (!existsSync(p)) continue;
  const text = readFileSync(p, "utf8");
  if (/credential[s]?\s+rotated|rotation\s*:\s*yes|OPENAI.*rotated/i.test(text)) {
    credentialRotation = "CONFIRMED_VIA_METADATA";
    break;
  }
  if (/OPENAI_API_KEY.*\*\*NO\*\*|openaiCredentialPresent:\s*false/i.test(text)) {
    credentialRotation = "UNCONFIRMED_EXPOSURE_RECORDED_KEY_NOW_PRESENT";
  }
}
if (credentialRotation === "NOT_CONFIRMED" && openaiPresent) {
  credentialRotation = "UNCONFIRMED_NO_FOUNDER_ROTATION_METADATA";
}

const liveDisabled = live === "0" || live === "" || live === "false";

// Provider billing: cannot confirm gpt-5-mini eligibility / balance without OpenAI network calls.
// Per mission: no paid calls; free confirmation path not available → UNVERIFIED.
const providerBilling = "UNVERIFIED";

const ready =
  task?.status === "AWAITING_APPROVAL" &&
  auth?.status === "PENDING" &&
  Number(auth?.use_count) === 0 &&
  scopeMatch &&
  available === 100 &&
  liveDisabled &&
  disposableOnly &&
  openaiPresent;

console.log(
  JSON.stringify(
    {
      TASK_STATUS: task?.status ?? "MISSING",
      AUTHORIZATION_STATUS: auth?.status ?? "MISSING",
      AUTHORIZATION_EXPIRES: auth?.expires_at ?? null,
      AUTHORIZATION_USES: {
        useCount: auth?.use_count ?? null,
        maxUses: auth?.max_uses ?? null,
        reusePolicy: auth?.reuse_policy ?? null,
      },
      BINDING: {
        ownerId: auth?.owner_id ?? null,
        projectId: auth?.project_id ?? null,
        taskOwnerId: task?.owner_id ?? null,
        taskProjectId: task?.project_id ?? null,
        taskAuthorizationId: task?.authorization_id ?? null,
      },
      SCOPE_CHECKS: scopeChecks,
      FINGERPRINT_MATCH: fingerprintMatch,
      SCOPE_MATCH: scopeMatch,
      AVAILABLE_ALLOWANCE: available,
      LIVE_DISABLED: liveDisabled,
      LIVE_FLAG_VALUE: live === "" ? "(empty)" : live,
      CREDENTIAL_ROTATION_STATUS: credentialRotation,
      OPENAI_KEY_PRESENT: openaiPresent,
      DISPOSABLE_GHOST99F_ONLY: disposableOnly,
      SUPABASE_URL: url,
      PROVIDER_BILLING_STATUS: providerBilling,
      READY_FOR_FOUNDER_APPROVAL: ready,
    },
    null,
    2,
  ),
);
