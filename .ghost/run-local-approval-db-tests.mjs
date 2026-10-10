/**
 * Run Founder Approval DB integration tests against local disposable Supabase only.
 * Refuses production hosts and never runs supabase db push.
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
  console.error(`Refusing approval DB tests: API_URL is not local (${apiUrl || "missing"}).`);
  process.exit(2);
}
if (!/127\.0\.0\.1|localhost/i.test(dbUrl)) {
  console.error(`Refusing approval DB tests: DB_URL is not local (${dbUrl || "missing"}).`);
  process.exit(2);
}
if (/supabase\.co/i.test(apiUrl) || /supabase\.co/i.test(dbUrl)) {
  console.error("Refusing approval DB tests: production Supabase host detected.");
  process.exit(2);
}

const env = {
  ...process.env,
  GHOST_LOCAL_APPROVAL_DB_TEST: "1",
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  GHOST_LOCAL_DB_URL: dbUrl,
};

console.log(`Running local approval DB tests against ${apiUrl}`);
const result = spawnSync(
  "npx",
  ["tsx", "--test", "src/lib/approvals/db.integration.test.ts"],
  { cwd: root, env, stdio: "inherit", shell: true },
);
process.exit(result.status ?? 1);
