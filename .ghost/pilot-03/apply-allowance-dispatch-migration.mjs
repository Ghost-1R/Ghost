/**
 * Apply Pilot 03 allowance reconcile + codegen dispatch migration to disposable ghost99f ONLY.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTAINER = "supabase_db_ghost99f";
const PORT = "55432";
const evidenceDir = path.join(root, ".ghost", "pilot-03", "evidence");
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
if (ghostPort !== "54322") throw new Error(`Ghost DB port unexpected: ${ghostPort}`);

const migration =
  "supabase/migrations/20261012120000_project_ai_allowance_reconcile_and_dispatch.sql";
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
    `select
      (to_regclass('public.codegen_provider_dispatches') is not null)::text || '|' ||
      (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='reconcile_project_ai_allowance'))::text || '|' ||
      (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='release_project_ai_allowance'))::text;`,
  ],
  { encoding: "utf8" },
).trim();

const [tableOk, reconcileOk, releaseOk] = probe.split("|");
const truthy = (v) => v === "t" || v === "true";
const evidence = {
  container: CONTAINER,
  hostPort,
  ghostPort,
  networks,
  migration,
  sha256,
  tableOk: truthy(tableOk),
  reconcileOk: truthy(reconcileOk),
  releaseOk: truthy(releaseOk),
  at: new Date().toISOString(),
};
writeFileSync(
  path.join(evidenceDir, "allowance-dispatch-migration-apply.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.tableOk || !evidence.reconcileOk || !evidence.releaseOk) process.exit(1);
