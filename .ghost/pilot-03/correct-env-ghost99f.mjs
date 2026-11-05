/**
 * Rewrite Pilot 03 .env.local to disposable ghost99f only.
 * Preserves OPENAI_API_KEY. Never prints secrets.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const disposableRoot = path.resolve(root, "..", "ghost-09-9f-supabase");
const envPath = path.join(root, ".env.local");
const TARGET_URL = "http://127.0.0.1:54331";

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

function parseDotEnv(text) {
  const map = new Map();
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    const key = raw.slice(0, eq).trim();
    let value = raw.slice(eq + 1);
    map.set(key, value);
  }
  return map;
}

const ghostDb = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0];
const disposableDb = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost99f"], { encoding: "utf8" }))[0];
const kong = JSON.parse(execFileSync("docker", ["inspect", "supabase_kong_ghost99f"], { encoding: "utf8" }))[0];
const ghostPort = ghostDb?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
const disposablePort = disposableDb?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
const apiPort = kong?.NetworkSettings?.Ports?.["8000/tcp"]?.[0]?.HostPort;
if (ghostPort !== "54322") throw new Error(`Ghost DB unexpected: ${ghostPort}`);
if (disposablePort !== "55432") throw new Error(`Disposable DB unexpected: ${disposablePort}`);
if (apiPort !== "54331") throw new Error(`API unexpected: ${apiPort}`);

const statusText = execFileSync("npx", ["supabase", "status", "-o", "env"], {
  cwd: disposableRoot,
  encoding: "utf8",
  shell: true,
});
const local = parseStatusEnv(statusText);
if (local.API_URL !== TARGET_URL) throw new Error(`API_URL mismatch: ${local.API_URL}`);
if (!local.ANON_KEY || !local.SERVICE_ROLE_KEY) throw new Error("Missing disposable keys");
if (!String(local.DB_URL).includes("127.0.0.1:55432")) throw new Error("DB_URL not ghost99f");

const existing = parseDotEnv(readFileSync(envPath, "utf8"));
const openaiKey = existing.get("OPENAI_API_KEY");
if (!openaiKey || !openaiKey.trim() || openaiKey.trim().replace(/^["']|["']$/g, "").length === 0) {
  throw new Error("OPENAI_API_KEY missing — refusing to rewrite");
}

// Preserve non-Supabase local helpers; strip hosted Supabase / production overrides.
const preserved = new Map();
for (const key of [
  "GHOST_LOCAL_FOUNDER_EMAIL",
  "GHOST_LOCAL_FOUNDER_PASSWORD",
  "GHOST_MODEL_PROVIDER",
  "GHOST_AI_MODEL",
  "XAI_API_KEY",
  "GROQ_API_KEY",
]) {
  if (existing.has(key)) preserved.set(key, existing.get(key));
}

const lines = [
  "# Pilot 03 disposable ghost99f ONLY — do not point at hosted Supabase.",
  `NEXT_PUBLIC_SUPABASE_URL=${TARGET_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${local.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${local.SERVICE_ROLE_KEY}`,
  "GHOST_CODEGEN_LIVE_ENABLED=0",
  `OPENAI_API_KEY=${openaiKey.replace(/^["']|["']$/g, "")}`,
  "",
  "# Cleared / aligned for disposable Pilot 03 (no hosted overrides).",
  "GHOST_PRODUCTION_URL=",
  `GHOST_AGENT_RUNTIME_API_URL=${TARGET_URL}`,
  `GHOST_AGENT_RUNTIME_SERVICE_KEY=${local.SERVICE_ROLE_KEY}`,
  "GHOST_LOCAL_DB_CONTAINER=supabase_db_ghost99f",
];

for (const [k, v] of preserved) {
  lines.push(`${k}=${v}`);
}
lines.push("");

writeFileSync(envPath, lines.join("\n"), "utf8");

// Post-write verification without printing secrets
const after = parseDotEnv(readFileSync(envPath, "utf8"));
const url = after.get("NEXT_PUBLIC_SUPABASE_URL");
const pub = after.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? "";
const svc = after.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const runtime = after.get("GHOST_AGENT_RUNTIME_API_URL") ?? "";
const live = after.get("GHOST_CODEGEN_LIVE_ENABLED");
const keyOk = Boolean(after.get("OPENAI_API_KEY")?.trim());
const hosted =
  /supabase\.co/i.test(url) ||
  /supabase\.co/i.test(runtime) ||
  /supabase\.co/i.test(after.get("GHOST_PRODUCTION_URL") ?? "");

if (url !== TARGET_URL) throw new Error("URL rewrite failed");
if (pub !== local.ANON_KEY) throw new Error("Publishable key mismatch");
if (svc !== local.SERVICE_ROLE_KEY) throw new Error("Service role mismatch");
if (runtime !== TARGET_URL) throw new Error("Runtime API URL mismatch");
if (live !== "0") throw new Error("Live flag not 0");
if (!keyOk) throw new Error("OpenAI key lost");
if (hosted) throw new Error("Hosted credentials still present");

console.log(
  JSON.stringify(
    {
      ok: true,
      supabaseUrl: url,
      disposableCredentialsMatch: true,
      hostedCredentialsActive: false,
      openaiKeyPresent: true,
      liveFlag: live,
      publishableKeyLen: pub.length,
      serviceRoleKeyLen: svc.length,
      ghostDbPort: ghostPort,
      disposableDbPort: disposablePort,
      apiPort,
    },
    null,
    2,
  ),
);
