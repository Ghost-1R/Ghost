/**
 * Workday mission state verify — READ ONLY.
 * No queue/consume/approve/mutate. No OpenAI calls. No secret print.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = new Map();
for (const raw of readFileSync(path.join(root, ".env.local"), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  const eq = raw.indexOf("=");
  if (eq > 0) env.set(raw.slice(0, eq).trim(), raw.slice(eq + 1).trim());
}

const TASK_ID = "8bdfde20-2f66-4518-9aea-6e632001fe7f";
const AUTH_ID = "5aee1635-62c3-4ab6-8237-060ee4bc1b16";
const PROJECT_ID = "f5397422-1c9d-4ef5-b639-8eee89981f5e";
const FOUNDER_ID = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const EXPECTED_FP = "c98ad5b97432d22a9600990dc664fa43b52a8d24a3932015ee82cf88475fcf71";

const url = env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const pub = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? "";
const svc = env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const runtime = env.get("GHOST_AGENT_RUNTIME_API_URL") ?? "";
const live = env.get("GHOST_CODEGEN_LIVE_ENABLED") ?? "";
const openai = env.get("OPENAI_API_KEY") ?? "";
const nextPublicOpenai = env.get("NEXT_PUBLIC_OPENAI_API_KEY");

const hosted = [...env.entries()].some(
  ([k, v]) => /SUPABASE|AGENT_RUNTIME|PRODUCTION_URL/i.test(k) && /supabase\.co/i.test(v ?? ""),
);

const disposable =
  url === "http://127.0.0.1:54331" &&
  runtime === "http://127.0.0.1:54331" &&
  !hosted &&
  Boolean(svc) &&
  Boolean(pub);

const supabase = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: task } = await supabase
  .from("remote_development_tasks")
  .select(
    "id, status, authorization_id, scope_fingerprint, owner_id, project_id, environment_label, deployment_authorized, action_scope, queued_at, started_at",
  )
  .eq("id", TASK_ID)
  .maybeSingle();

const { data: auth } = await supabase
  .from("founder_action_authorizations")
  .select(
    "id, status, expires_at, use_count, max_uses, reuse_policy, owner_id, project_id, environment_label, action_type, action_scope, scope_fingerprint",
  )
  .eq("id", AUTH_ID)
  .maybeSingle();

const { data: allowance } = await supabase
  .from("project_ai_allowances")
  .select("allowance_cents, reserved_cents, charged_cents, updated_at")
  .eq("project_id", PROJECT_ID)
  .eq("owner_id", FOUNDER_ID)
  .maybeSingle();

const { data: dispatches } = await supabase
  .from("codegen_provider_dispatches")
  .select("id, status, mode, idempotency_key, created_at")
  .eq("remote_development_task_id", TASK_ID);

const { count: dispatchCount } = await supabase
  .from("codegen_provider_dispatches")
  .select("id", { count: "exact", head: true })
  .eq("remote_development_task_id", TASK_ID);

const now = Date.now();
const expiresAt = auth?.expires_at ? Date.parse(auth.expires_at) : NaN;
const expired = Number.isFinite(expiresAt) ? expiresAt <= now : true;
const scope = auth?.action_scope ?? "";

const available =
  Number(allowance?.allowance_cents ?? 0) -
  Number(allowance?.charged_cents ?? 0) -
  Number(allowance?.reserved_cents ?? 0);

const scopeOk =
  /provider=openai/.test(scope) &&
  /model=gpt-5-mini/.test(scope) &&
  /class=PUBLIC/.test(scope) &&
  /maxCents=100/.test(scope) &&
  /deploy=false/.test(scope) &&
  /dispatch=DISABLED/.test(scope) &&
  auth?.environment_label === "LOCAL_PILOT_03" &&
  auth?.reuse_policy === "ONE_TIME" &&
  auth?.action_type === "agent_task.develop";

const fpMatch =
  auth?.scope_fingerprint === EXPECTED_FP &&
  task?.scope_fingerprint === EXPECTED_FP &&
  auth?.scope_fingerprint === task?.scope_fingerprint;

const authOk =
  auth?.status === "APPROVED" &&
  Number(auth?.use_count) === 0 &&
  !expired &&
  auth?.owner_id === FOUNDER_ID &&
  auth?.project_id === PROJECT_ID &&
  scopeOk &&
  fpMatch;

const taskOk =
  task?.authorization_id === AUTH_ID &&
  task?.owner_id === FOUNDER_ID &&
  task?.project_id === PROJECT_ID &&
  task?.deployment_authorized === false;

// Conversation tables diagnostic
const convTables = {};
for (const t of ["conversations", "conversation_messages", "chat_threads", "messages"]) {
  const { error } = await supabase.from(t).select("*", { count: "exact", head: true }).limit(0);
  convTables[t] = error ? `MISSING_OR_DENIED:${error.message.slice(0, 80)}` : "PRESENT";
}

console.log(
  JSON.stringify(
    {
      isolation: {
        DISPOSABLE_ENV_VERIFIED: disposable,
        HOSTED_CREDENTIALS_ACTIVE: hosted,
        SUPABASE_URL: url,
        RUNTIME_URL: runtime,
        LIVE_FLAG: live === "" ? "(empty)" : live,
        LIVE_DISABLED: live !== "1",
        OPENAI_KEY_PRESENT: Boolean(openai.trim()),
        OPENAI_KEY_LOOKS_PROJECT_FORM: openai.trim().startsWith("sk-"),
        NEXT_PUBLIC_OPENAI_PRESENT: Boolean(nextPublicOpenai?.trim()),
        // Never print key material.
        GHOST_LOCAL_DB_CONTAINER: env.get("GHOST_LOCAL_DB_CONTAINER") ?? null,
      },
      authorization: {
        id: auth?.id ?? null,
        status: auth?.status ?? "MISSING",
        expiresAt: auth?.expires_at ?? null,
        expired,
        useCount: auth?.use_count ?? null,
        reusePolicy: auth?.reuse_policy ?? null,
        scopeOk,
        fingerprintMatch: fpMatch,
        APPROVED_READY: authOk,
      },
      task: {
        id: task?.id ?? null,
        status: task?.status ?? "MISSING",
        queuedAt: task?.queued_at ?? null,
        taskOk,
        NOT_QUEUED: !task?.queued_at && task?.status !== "QUEUED" && task?.status !== "RUNNING",
      },
      allowance: {
        allowanceCents: Number(allowance?.allowance_cents ?? 0),
        reservedCents: Number(allowance?.reserved_cents ?? 0),
        chargedCents: Number(allowance?.charged_cents ?? 0),
        availableCents: available,
      },
      dispatches: {
        count: dispatchCount ?? dispatches?.length ?? 0,
        rows: (dispatches ?? []).map((d) => ({
          status: d.status,
          mode: d.mode,
          key: d.idempotency_key,
        })),
      },
      conversationTables: convTables,
      STOP_LIVE_PATH: expired || !disposable || live === "1",
    },
    null,
    2,
  ),
);
