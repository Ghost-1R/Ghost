/**
 * Post-restart verification — no mutations, no secret print, no OpenAI calls.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(root, ".env.local");
const loginPath = path.join(root, ".ghost", "pilot-02", "founder-ui-login.local.json");
const PROJECT_ID = "f5397422-1c9d-4ef5-b639-8eee89981f5e";
const FOUNDER_ID = "adcc741f-1570-472f-9bf4-ef44028f57fc";

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
const url = env.get("NEXT_PUBLIC_SUPABASE_URL");
const pub = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const svc = env.get("SUPABASE_SERVICE_ROLE_KEY");
const runtime = env.get("GHOST_AGENT_RUNTIME_API_URL");
const live = env.get("GHOST_CODEGEN_LIVE_ENABLED");
const openaiPresent = Boolean(env.get("OPENAI_API_KEY")?.trim());
const hostedActive = [...env.entries()].some(
  ([k, v]) =>
    /SUPABASE|AGENT_RUNTIME|PRODUCTION_URL/i.test(k) && /supabase\.co/i.test(v ?? ""),
);

const ghostPort = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0]
  ?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
const disposablePort = JSON.parse(
  execFileSync("docker", ["inspect", "supabase_db_ghost99f"], { encoding: "utf8" }),
)[0]?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;

const login = JSON.parse(readFileSync(loginPath, "utf8").replace(/^\uFEFF/, ""));
const client = createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });
const signed = await client.auth.signInWithPassword({
  email: login.email,
  password: login.password,
});
if (signed.error || signed.data.user?.id !== FOUNDER_ID) {
  throw new Error(`Founder login failed: ${signed.error?.message ?? "id mismatch"}`);
}

const { data: project, error: projectError } = await client
  .from("projects")
  .select("id, name, company_id")
  .eq("id", PROJECT_ID)
  .maybeSingle();
if (projectError || !project) {
  throw new Error(`Project not visible: ${projectError?.message ?? "missing"}`);
}

const { data: allowance, error: allowanceError } = await client
  .from("project_ai_allowances")
  .select("allowance_cents, reserved_cents, charged_cents")
  .eq("project_id", PROJECT_ID)
  .eq("owner_id", FOUNDER_ID)
  .maybeSingle();
if (allowanceError || !allowance) {
  throw new Error(`Allowance not visible: ${allowanceError?.message ?? "missing"}`);
}

const available =
  Number(allowance.allowance_cents) -
  Number(allowance.charged_cents) -
  Number(allowance.reserved_cents);

let health = 0;
try {
  const res = await fetch("http://127.0.0.1:3012/api/health");
  health = res.status;
} catch {
  health = 0;
}

console.log(
  JSON.stringify(
    {
      SUPABASE_URL: url,
      DISPOSABLE_CREDENTIALS_MATCH:
        url === "http://127.0.0.1:54331" &&
        runtime === "http://127.0.0.1:54331" &&
        Boolean(pub) &&
        Boolean(svc) &&
        !hostedActive,
      HOSTED_CREDENTIALS_ACTIVE: hostedActive,
      OPENAI_KEY_PRESENT: openaiPresent,
      LIVE_FLAG: live,
      LOCAL_SERVER: health === 200 ? "UP http://127.0.0.1:3012" : `DOWN status=${health}`,
      FOUNDER_LOGIN: "PASS",
      PILOT_03_PROJECT: `${project.id} (${project.name})`,
      ALLOWANCE: {
        allowanceCents: Number(allowance.allowance_cents),
        reservedCents: Number(allowance.reserved_cents),
        chargedCents: Number(allowance.charged_cents),
        availableCents: available,
      },
      PRODUCTION_UNCHANGED: ghostPort === "54322" && disposablePort === "55432",
      READY_FOR_NEXT_STEP:
        url === "http://127.0.0.1:54331" &&
        !hostedActive &&
        live === "0" &&
        openaiPresent &&
        health === 200 &&
        available === 100,
    },
    null,
    2,
  ),
);
