/**
 * Run durable remote-development DB integration tests against local disposable Supabase only.
 * Refuses production hosts. Never runs supabase db push. Never resets existing Ghost DBs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const status = execFileSync("npx", ["supabase", "status", "-o", "env"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
const local = parseStatusEnv(status);
const apiUrl = local.API_URL ?? "";
const dbUrl = local.DB_URL ?? "";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(apiUrl)) {
  console.error(`Refusing durable DB tests: API_URL is not local (${apiUrl || "missing"}).`);
  process.exit(2);
}
if (!/127\.0\.0\.1|localhost/i.test(dbUrl)) {
  console.error(`Refusing durable DB tests: DB_URL is not local (${dbUrl || "missing"}).`);
  process.exit(2);
}
if (/supabase\.co/i.test(apiUrl) || /supabase\.co/i.test(dbUrl)) {
  console.error("Refusing durable DB tests: production Supabase host detected.");
  process.exit(2);
}

const env = {
  ...process.env,
  GHOST_LOCAL_DURABLE_DB_TEST: "1",
  GHOST_LOCAL_APPROVAL_DB_TEST: "1",
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  GHOST_LOCAL_DB_URL: dbUrl,
  GHOST_LOCAL_DB_CONTAINER: process.env.GHOST_LOCAL_DB_CONTAINER ?? "supabase_db_ghost",
};

console.log(`Running local durable DB tests against ${apiUrl}`);
console.log("Migrations must already be applied on this disposable stack (900–913).");

const approval = spawnSync(
  "npx",
  ["tsx", "--test", "src/lib/approvals/db.integration.test.ts"],
  { cwd: root, env, stdio: "inherit", shell: true },
);
if ((approval.status ?? 1) !== 0) {
  process.exit(approval.status ?? 1);
}

const durable = spawnSync(
  "npx",
  ["tsx", "--test", "src/lib/remote-development/db.integration.test.ts"],
  { cwd: root, env, stdio: "inherit", shell: true },
);
process.exit(durable.status ?? 1);
