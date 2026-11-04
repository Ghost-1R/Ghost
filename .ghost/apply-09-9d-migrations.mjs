/**
 * Apply Ghost 09.9D migrations to the disposable Postgres container only.
 * Refuses supabase_db_ghost / port 54322 / hosted hosts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTAINER = process.env.GHOST_09_9D_CONTAINER ?? "ghost-09-9d-disposable-pg";
const PORT = process.env.GHOST_09_9D_PORT ?? "55431";
const evidenceDir = path.join(root, ".ghost", "09-9d-evidence");
mkdirSync(evidenceDir, { recursive: true });

if (CONTAINER === "supabase_db_ghost" || PORT === "54322") {
  console.error("Refusing to apply migrations to existing Ghost local DB.");
  process.exit(2);
}

const inspect = JSON.parse(
  execFileSync("docker", ["inspect", CONTAINER], { encoding: "utf8" }),
)[0];
const ports = inspect?.NetworkSettings?.Ports?.["5432/tcp"] ?? [];
const hostPort = ports[0]?.HostPort;
const networks = Object.keys(inspect?.NetworkSettings?.Networks ?? {});
const binds = inspect?.HostConfig?.Binds;
const tmpfs = inspect?.HostConfig?.Tmpfs ?? {};

const isolation = {
  container: CONTAINER,
  hostPort,
  expectedPort: PORT,
  networks,
  binds,
  tmpfs,
  usesSupabaseNetwork: networks.some((n) => n.includes("supabase")),
  usesSupabaseVolume:
    Array.isArray(binds) && binds.some((b) => String(b).includes("supabase")),
};

if (hostPort !== PORT) {
  console.error(`Isolation fail: host port ${hostPort} != ${PORT}`);
  process.exit(2);
}
if (isolation.usesSupabaseNetwork || isolation.usesSupabaseVolume) {
  console.error("Isolation fail: container shares Supabase network/volume", isolation);
  process.exit(2);
}

function psqlFile(relPath) {
  const abs = path.join(root, relPath);
  const sql = readFileSync(abs, "utf8");
  execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "ghost99d", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  return abs;
}

const files = [
  ".ghost/09-9d-bootstrap.sql",
  "supabase/migrations/20261010090000_founder_action_authorizations.sql",
  "supabase/migrations/20261010090100_founder_action_authorizations_privileges.sql",
  "supabase/migrations/20261010090200_founder_action_authorizations_immutable_scope.sql",
  "supabase/migrations/20261010090600_agent_tasks_approval_bound.sql",
  "supabase/migrations/20261010090800_agent_worker_queue_and_artifacts.sql",
  "supabase/migrations/20261010091000_remote_development_tasks.sql",
  "supabase/migrations/20261010091300_remote_dev_agent_task_link.sql",
  "supabase/migrations/20261011092000_agent_tasks_authorization_match.sql",
  "supabase/migrations/20261011100000_agent_tasks_reject_revoked_expired_auth.sql",
];

const applied = [];
for (const file of files) {
  console.log(`APPLY ${file}`);
  psqlFile(file);
  applied.push(file);
}

const tables = execFileSync(
  "docker",
  [
    "exec",
    "-i",
    CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    "ghost99d",
    "-t",
    "-A",
    "-c",
    `select tablename from pg_tables where schemaname='public' and tablename in (
      'founder_action_authorizations','agent_tasks','agent_task_checkpoints','remote_development_tasks'
    ) order by 1;`,
  ],
  { encoding: "utf8" },
).trim();

const report = {
  isolation,
  applied,
  tables: tables.split(/\r?\n/).filter(Boolean),
  at: new Date().toISOString(),
};
writeFileSync(path.join(evidenceDir, "migrations.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
