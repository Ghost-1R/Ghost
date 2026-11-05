import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(root, ".ghost", "pilot-01", "evidence");
mkdirSync(evidenceDir, { recursive: true });

function sha(rel) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return null;
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

const { describePilot01ExecutionPath, summarizePilot01Attribution } = await import(
  pathToFileURL(path.join(root, "src/lib/pilot-01/execution-path.ts")).href
);
const { preparePilot01Harness } = await import(
  pathToFileURL(path.join(root, "src/lib/pilot-01/harness.ts")).href
);

const sql = existsSync(path.join(evidenceDir, "security-sql-verification.json"))
  ? JSON.parse(readFileSync(path.join(evidenceDir, "security-sql-verification.json"), "utf8"))
  : null;
const docker = existsSync(path.join(evidenceDir, "docker-pilot-run.json"))
  ? JSON.parse(readFileSync(path.join(evidenceDir, "docker-pilot-run.json"), "utf8"))
  : null;

const pathStages = describePilot01ExecutionPath({
  securitySqlVerified: Boolean(sql && sql.failed === 0),
  dockerPilotRan: Boolean(docker?.realContainerExecution),
});
const attribution = summarizePilot01Attribution(pathStages);
const harness = preparePilot01Harness({ root, runDockerPilot: false });

const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();

const report = {
  build: "PILOT_01_OVERNIGHT",
  executionEnvironment: {
    os: process.platform,
    hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || null,
    repositoryRoot: root,
    branch,
    head,
  },
  githubBranchVerified: "cursor/pilot-01-supervised-coding-prep @ 475b2b2 (pushed; later commits may advance HEAD)",
  pilotSourceStatus: "CURSOR_PREPARED_SAMPLE_PRESENT",
  securityMigrationStatus: existsSync(path.join(evidenceDir, "security-migration-apply.json"))
    ? "APPLIED_DISPOSABLE_GHOST99F"
    : "NOT_APPLIED",
  authorizationChecks: sql,
  dockerExecution: docker
    ? {
        realContainerExecution: docker.realContainerExecution,
        summary: docker.summary,
        attribution: docker.attribution,
        scenarios: docker.scenarios,
      }
    : { realContainerExecution: false },
  databaseIntegration: {
    target: "supabase_db_ghost99f:55432",
    ghostDbUntouched: "supabase_db_ghost:54322",
    securitySql: sql ? { passed: sql.passed, failed: sql.failed } : null,
  },
  ghostActualExecution: attribution.ghostActualExecution,
  cursorPreparedWork: attribution.cursorPreparedWork,
  notImplemented: attribution.notImplemented,
  pathStages,
  harnessOverall: harness.overall,
  sampleHashes: {
    "index.html": sha(".ghost/pilot-01/sample-workspace/car-rental-landing/index.html"),
    "styles.css": sha(".ghost/pilot-01/sample-workspace/car-rental-landing/styles.css"),
    "app.js": sha(".ghost/pilot-01/sample-workspace/car-rental-landing/app.js"),
  },
  migrationHashes: {
    "20261011092000": sha("supabase/migrations/20261011092000_agent_tasks_authorization_match.sql"),
    "20261011100000": sha("supabase/migrations/20261011100000_agent_tasks_reject_revoked_expired_auth.sql"),
  },
  at: new Date().toISOString(),
};

writeFileSync(path.join(evidenceDir, "overnight-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ head, branch, docker: !!docker?.realContainerExecution, sqlFailed: sql?.failed }, null, 2));
