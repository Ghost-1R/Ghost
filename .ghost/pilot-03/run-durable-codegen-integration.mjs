/**
 * Run Pilot 03 durable codegen integration against disposable ghost99f only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const disposableRoot = path.resolve(root, "..", "ghost-09-9f-supabase");
const evidenceDir = path.join(root, ".ghost", "pilot-03", "evidence");
mkdirSync(evidenceDir, { recursive: true });

const REQUIRED_CONTAINER = "supabase_db_ghost99f";
const REQUIRED_API_PORT = "54331";
const REQUIRED_DB_PORT = "55432";

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

const ghostDb = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0];
const ghostDbPort = ghostDb?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
const disposableDb = JSON.parse(execFileSync("docker", ["inspect", REQUIRED_CONTAINER], { encoding: "utf8" }))[0];
const disposableDbPort = disposableDb?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
const disposableNets = Object.keys(disposableDb?.NetworkSettings?.Networks ?? {});
const disposableKong = JSON.parse(execFileSync("docker", ["inspect", "supabase_kong_ghost99f"], { encoding: "utf8" }))[0];
const disposableApiPort = disposableKong?.NetworkSettings?.Ports?.["8000/tcp"]?.[0]?.HostPort;

if (ghostDbPort !== "54322") throw new Error(`Ghost DB port unexpected: ${ghostDbPort}`);
if (disposableDbPort !== REQUIRED_DB_PORT) throw new Error(`Disposable DB port unexpected: ${disposableDbPort}`);
if (disposableApiPort !== REQUIRED_API_PORT) throw new Error(`Disposable API port unexpected: ${disposableApiPort}`);
if (disposableNets.some((n) => n === "supabase_network_ghost")) {
  throw new Error("Disposable stack shares Ghost network");
}

const statusText = execFileSync("npx", ["supabase", "status", "-o", "env"], {
  cwd: disposableRoot,
  encoding: "utf8",
  shell: true,
});
const local = parseStatusEnv(statusText);
if (local.API_URL !== `http://127.0.0.1:${REQUIRED_API_PORT}`) {
  throw new Error(`API_URL mismatch: ${local.API_URL}`);
}

const env = {
  ...process.env,
  GHOST_LOCAL_DURABLE_DB_TEST: "1",
  GHOST_09_9F_REQUIRE_DISPOSABLE: "1",
  GHOST_LOCAL_DB_CONTAINER: REQUIRED_CONTAINER,
  NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  GHOST_CODEGEN_LIVE_ENABLED: "",
  OPENAI_API_KEY: "",
};

console.log(`Running Pilot 03 durable codegen integration against ${local.API_URL}`);
const result = spawnSync(
  "npx",
  ["tsx", "--test", "src/lib/codegen/durable-codegen.integration.test.ts"],
  { cwd: root, env, stdio: "inherit", shell: true },
);

writeFileSync(
  path.join(evidenceDir, "durable-codegen-integration.json"),
  JSON.stringify(
    {
      apiUrl: local.API_URL,
      container: REQUIRED_CONTAINER,
      dbPort: disposableDbPort,
      ghostDbPort,
      exitCode: result.status ?? 1,
      liveEnabled: false,
      at: new Date().toISOString(),
    },
    null,
    2,
  ),
);

process.exit(result.status ?? 1);
