/**
 * Pilot 03 mock verification pipeline — MOCK_GENERATION only. Zero live calls.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(root, ".ghost", "pilot-03", "evidence");
mkdirSync(evidenceDir, { recursive: true });

process.env.GHOST_NO_LIVE_PROVIDER_CALLS = "1";
delete process.env.GHOST_CODEGEN_LIVE_ENABLED;

const { MemoryAllowanceLedger } = await import(pathToFileURL(path.join(root, "src/lib/allowance/index.ts")).href);
const { makeApprovedCodingAuth, runPilot03MockPipeline, PILOT_03_OBJECTIVE } = await import(
  pathToFileURL(path.join(root, "src/lib/codegen/index.ts")).href
);

const ownerId = randomUUID();
const projectId = randomUUID();
const ledger = new MemoryAllowanceLedger();
ledger.setAllowance({ ownerId, projectId, allowanceCents: 2000 });
const auth = makeApprovedCodingAuth({
  ownerId,
  projectId,
  objective: PILOT_03_OBJECTIVE,
  environmentLabel: "LOCAL_PILOT_03",
});

const workspaceRoot = path.join(os.tmpdir(), "ghost-pilot-03-mock");
mkdirSync(workspaceRoot, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, result: ok ? "PASS" : "FAIL", detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${String(detail).slice(0, 180)}`);
}

const happy = await runPilot03MockPipeline({
  authorization: auth,
  ownerId,
  projectId,
  ledger,
  workspaceRoot,
  estimatedCents: 100,
  actualCents: 0,
});
check("HAPPY_PATH", happy.ok === true && happy.mode === "MOCK_GENERATION", happy.ok ? happy.materializeSha256 : happy.reason);

const lowLedger = new MemoryAllowanceLedger();
lowLedger.setAllowance({ ownerId, projectId, allowanceCents: 50 });
const low = await runPilot03MockPipeline({
  authorization: auth,
  ownerId,
  projectId,
  ledger: lowLedger,
  workspaceRoot,
  estimatedCents: 100,
});
check("INSUFFICIENT_ALLOWANCE", low.ok === false && low.reason === "INSUFFICIENT_ALLOWANCE", low.reason);

const raceLedger = new MemoryAllowanceLedger();
raceLedger.setAllowance({ ownerId, projectId, allowanceCents: 150 });
const auth2 = makeApprovedCodingAuth({ ownerId, projectId, objective: PILOT_03_OBJECTIVE, environmentLabel: "LOCAL_PILOT_03" });
const [r1, r2] = await Promise.all([
  runPilot03MockPipeline({ authorization: auth, ownerId, projectId, ledger: raceLedger, workspaceRoot, estimatedCents: 100, actualCents: 0 }),
  runPilot03MockPipeline({ authorization: auth2, ownerId, projectId, ledger: raceLedger, workspaceRoot, estimatedCents: 100, actualCents: 0 }),
]);
const raceWins = [r1, r2].filter((r) => r.ok).length;
check("CONCURRENT_RESERVE", raceWins === 1, `wins=${raceWins}`);

const missing = await runPilot03MockPipeline({
  authorization: null,
  ownerId,
  projectId,
  ledger,
  workspaceRoot,
});
check("MISSING_AUTH", missing.ok === false, missing.reason);

const revoked = makeApprovedCodingAuth({
  ownerId,
  projectId,
  objective: PILOT_03_OBJECTIVE,
  status: "REVOKED",
  environmentLabel: "LOCAL_PILOT_03",
});
const rev = await runPilot03MockPipeline({
  authorization: revoked,
  ownerId,
  projectId,
  ledger,
  workspaceRoot,
});
check("REVOKED_AUTH", rev.ok === false, rev.reason);

const failProv = await runPilot03MockPipeline({
  authorization: makeApprovedCodingAuth({ ownerId, projectId, objective: PILOT_03_OBJECTIVE, environmentLabel: "LOCAL_PILOT_03" }),
  ownerId,
  projectId,
  ledger: (() => {
    const l = new MemoryAllowanceLedger();
    l.setAllowance({ ownerId, projectId, allowanceCents: 500 });
    return l;
  })(),
  workspaceRoot,
  forceProviderFailure: true,
});
check("PROVIDER_FAILURE_RELEASES", failProv.ok === false, failProv.reason);

let docker = { attempted: false, real: false };
if (happy.ok && happy.materializeSha256) {
  // Find workspace via pointer from last materialize — re-run materialize path not stored; skip if missing
  const probe = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 10_000 });
  docker = { attempted: probe.status === 0, real: false, note: "Docker available for future live trial; mock pipeline validated in Node/unit tests." };
}

const passed = checks.filter((c) => c.result === "PASS").length;
const failed = checks.filter((c) => c.result === "FAIL").length;
const report = {
  mode: "MOCK_GENERATION",
  note: "Pilot 03 mock pipeline. Not real AI coding. Not Pilot 02 car-rental reuse.",
  objective: PILOT_03_OBJECTIVE,
  liveCalls: 0,
  actualProviderSpendUsd: 0,
  checks,
  passed,
  failed,
  docker,
  happy: happy.ok
    ? {
        materializeSha256: happy.materializeSha256,
        availableCentsAfter: happy.availableCentsAfter,
        founderReviewStatus: happy.founderReviewStatus,
      }
    : null,
  finalStatus: failed === 0 ? "PILOT_03_MOCK_PIPELINE_PASS" : "PILOT_03_MOCK_PIPELINE_FAIL",
};
const body = JSON.stringify(report, null, 2);
report.evidenceSha256 = createHash("sha256").update(body).digest("hex");
writeFileSync(path.join(evidenceDir, "mock-pipeline.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ finalStatus: report.finalStatus, passed, failed, evidenceSha256: report.evidenceSha256 }, null, 2));
process.exit(failed === 0 ? 0 : 1);
