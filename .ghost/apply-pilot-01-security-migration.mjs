/**
 * Apply Pilot 01 revoked/expired bind migration to disposable ghost99f ONLY.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTAINER = "supabase_db_ghost99f";
const PORT = "55432";
const evidenceDir = path.join(root, ".ghost", "pilot-01", "evidence");
mkdirSync(evidenceDir, { recursive: true });

const inspect = JSON.parse(execFileSync("docker", ["inspect", CONTAINER], { encoding: "utf8" }))[0];
const hostPort = inspect?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
const networks = Object.keys(inspect?.NetworkSettings?.Networks ?? {});
if (hostPort !== PORT) throw new Error(`Bad port ${hostPort}`);
if (networks.includes("supabase_network_ghost")) throw new Error("Shares Ghost network");
if (CONTAINER === "supabase_db_ghost") throw new Error("Refusing Ghost DB");

const ghost = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0];
const ghostPort = ghost?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
if (ghostPort === PORT) throw new Error("Port collision");

const migration = "supabase/migrations/20261011100000_agent_tasks_reject_revoked_expired_auth.sql";
const sql = readFileSync(path.join(root, migration), "utf8");
const sha256 = createHash("sha256").update(sql).digest("hex");
console.log(`APPLY ${migration} sha256=${sha256} -> ${CONTAINER}@${hostPort}`);
execFileSync(
  "docker",
  ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
  { input: sql, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
);

const probe = execFileSync(
  "docker",
  [
    "exec",
    CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-t",
    "-A",
    "-c",
    "select pg_get_functiondef('private.assert_agent_task_matches_authorization()'::regprocedure) like '%cannot bind to revoked%';",
  ],
  { encoding: "utf8" },
).trim();

const evidence = {
  container: CONTAINER,
  hostPort,
  ghostPort,
  networks,
  migration,
  sha256,
  functionHasRevokedGate: probe === "t",
  at: new Date().toISOString(),
};
writeFileSync(path.join(evidenceDir, "security-migration-apply.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.functionHasRevokedGate) process.exit(1);
