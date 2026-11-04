/**
 * Build 09.9F — run Auth/PostgREST integration against disposable ghost99f only.
 * Never targets supabase_*_ghost / :54321 / :54322 / production.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const disposableRoot = path.resolve(root, "..", "ghost-09-9f-supabase");
const evidenceDir = path.join(root, ".ghost", "09-9f-evidence");
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

function redact(obj) {
  const clone = { ...obj };
  for (const key of Object.keys(clone)) {
    if (/KEY|SECRET|PASSWORD|TOKEN/i.test(key)) clone[key] = "***REDACTED***";
  }
  return clone;
}

const ghostDb = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0];
const ghostDbPort = ghostDb?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
const disposableDb = JSON.parse(execFileSync("docker", ["inspect", REQUIRED_CONTAINER], { encoding: "utf8" }))[0];
const disposableDbPort = disposableDb?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
const disposableNets = Object.keys(disposableDb?.NetworkSettings?.Networks ?? {});
const ghostKong = JSON.parse(execFileSync("docker", ["inspect", "supabase_kong_ghost"], { encoding: "utf8" }))[0];
const ghostApiPort = ghostKong?.NetworkSettings?.Ports?.["8000/tcp"]?.[0]?.HostPort;
const disposableKong = JSON.parse(execFileSync("docker", ["inspect", "supabase_kong_ghost99f"], { encoding: "utf8" }))[0];
const disposableApiPort = disposableKong?.NetworkSettings?.Ports?.["8000/tcp"]?.[0]?.HostPort;

if (ghostDbPort !== "54322") throw new Error(`Ghost DB port unexpected: ${ghostDbPort}`);
if (disposableDbPort !== REQUIRED_DB_PORT) throw new Error(`Disposable DB port unexpected: ${disposableDbPort}`);
if (ghostApiPort !== "54321") throw new Error(`Ghost API port unexpected: ${ghostApiPort}`);
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
const apiUrl = local.API_URL ?? "";
const dbUrl = local.DB_URL ?? "";

if (apiUrl !== `http://127.0.0.1:${REQUIRED_API_PORT}`) {
  throw new Error(`API_URL mismatch: ${apiUrl}`);
}
if (!dbUrl.includes(`127.0.0.1:${REQUIRED_DB_PORT}`)) {
  throw new Error(`DB_URL mismatch: ${dbUrl}`);
}
if (/supabase\.co/i.test(apiUrl) || /supabase\.co/i.test(dbUrl)) {
  throw new Error("Production host detected");
}

const isolation = {
  requiredContainer: REQUIRED_CONTAINER,
  disposableApiPort,
  disposableDbPort,
  ghostApiPort,
  ghostDbPort,
  disposableNetworks: disposableNets,
  apiUrl,
  dbUrlHostPort: `127.0.0.1:${REQUIRED_DB_PORT}`,
  statusRedacted: redact(local),
};
writeFileSync(path.join(evidenceDir, "isolation-proof.json"), JSON.stringify(isolation, null, 2));
console.log("ISOLATION_OK", JSON.stringify(isolation));

const env = {
  ...process.env,
  GHOST_LOCAL_DURABLE_DB_TEST: "1",
  GHOST_LOCAL_APPROVAL_DB_TEST: "1",
  GHOST_09_9F_REQUIRE_DISPOSABLE: "1",
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  GHOST_LOCAL_DB_URL: dbUrl,
  GHOST_LOCAL_DB_CONTAINER: REQUIRED_CONTAINER,
};

const suites = [
  {
    name: "approvals-db",
    run: () =>
      spawnSync(process.execPath, ["--import", "tsx", "--test", "src/lib/approvals/db.integration.test.ts"], {
        cwd: root,
        env,
        encoding: "utf8",
      }),
  },
  {
    name: "durable-db",
    run: () =>
      spawnSync(process.execPath, ["--import", "tsx", "--test", "src/lib/remote-development/db.integration.test.ts"], {
        cwd: root,
        env,
        encoding: "utf8",
      }),
  },
  {
    name: "security-regression",
    run: () =>
      spawnSync(process.execPath, ["--import", "tsx", "--test", "src/lib/remote-development/security-regression.test.ts"], {
        cwd: root,
        env,
        encoding: "utf8",
      }),
  },
  {
    name: "api-pack",
    run: () =>
      spawnSync(process.execPath, [path.join(root, ".ghost", "verify-09-9f-api.mjs")], {
        cwd: root,
        env,
        encoding: "utf8",
      }),
  },
];

const results = [];
for (const suite of suites) {
  console.log(`\n=== RUN ${suite.name} ===`);
  const executed = suite.run();
  process.stdout.write(executed.stdout || "");
  process.stderr.write(executed.stderr || "");
  const ok = (executed.status ?? 1) === 0;
  results.push({
    name: suite.name,
    result: ok ? "PASS" : "FAIL",
    exit: executed.status,
    detail: ((executed.stderr || executed.stdout || "").trim().slice(-500)),
  });
  if (!ok) break;
}

writeFileSync(path.join(evidenceDir, "integration-suites.json"), JSON.stringify({ isolation, results }, null, 2));
const failed = results.filter((r) => r.result === "FAIL").length;
console.log(JSON.stringify({ passed: results.length - failed, failed }, null, 2));
process.exit(failed === 0 ? 0 : 1);
