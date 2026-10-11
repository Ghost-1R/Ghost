/**
 * Apply Build 09.9E authorization-match migration to disposable Postgres only.
 * Refuses supabase_db_ghost / port 54322 / hosted hosts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTAINER = "ghost-09-9d-disposable-pg";
const PORT = "55431";
const DB = "ghost99d";
const evidenceDir = path.join(root, ".ghost", "09-9e-evidence");
mkdirSync(evidenceDir, { recursive: true });

const inspect = JSON.parse(execFileSync("docker", ["inspect", CONTAINER], { encoding: "utf8" }))[0];
const hostPort = inspect?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
const networks = Object.keys(inspect?.NetworkSettings?.Networks ?? {});
const binds = inspect?.HostConfig?.Binds;
const tmpfs = inspect?.HostConfig?.Tmpfs ?? {};

const isolation = {
  container: CONTAINER,
  database: DB,
  hostPort,
  expectedPort: PORT,
  networks,
  binds,
  tmpfs,
  usesSupabaseNetwork: networks.some((n) => n.includes("supabase")),
};

if (hostPort !== PORT) {
  console.error(`Isolation fail: host port ${hostPort} != ${PORT}`);
  process.exit(2);
}
if (isolation.usesSupabaseNetwork) {
  console.error("Isolation fail: container on supabase network", isolation);
  process.exit(2);
}

const ghost = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0];
const ghostPort = ghost?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
if (ghostPort === PORT) {
  console.error("Isolation fail: port collision with Ghost DB");
  process.exit(2);
}

const migration = "supabase/migrations/20261011092000_agent_tasks_authorization_match.sql";
const sql = readFileSync(path.join(root, migration), "utf8");
console.log(`APPLY ${migration} -> ${CONTAINER}/${DB} @ ${hostPort}`);
execFileSync(
  "docker",
  ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1"],
  { input: sql, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
);

const probe = execFileSync(
  "docker",
  [
    "exec",
    "-i",
    CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    DB,
    "-t",
    "-A",
    "-c",
    "select tgname from pg_trigger where tgname='agent_tasks_match_authorization';",
  ],
  { encoding: "utf8" },
).trim();

const evidence = {
  isolation: { ...isolation, ghostPort },
  migration,
  triggerPresent: probe === "agent_tasks_match_authorization",
  at: new Date().toISOString(),
};
writeFileSync(path.join(evidenceDir, "migration-apply.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.triggerPresent) process.exit(1);
