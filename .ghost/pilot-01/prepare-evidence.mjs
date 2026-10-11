/**
 * Write Pilot 01 harness evidence without claiming Docker/DB Ghost execution.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(root, ".ghost", "pilot-01", "evidence");
mkdirSync(evidenceDir, { recursive: true });

const { preparePilot01Harness, writePilot01Evidence } = await import(
  pathToFileURL(path.join(root, "src/lib/pilot-01/harness.ts")).href
);

const report = preparePilot01Harness({ root, runDockerPilot: false });
const written = writePilot01Evidence(report, evidenceDir);
const summary = {
  pilotId: report.pilotId,
  overall: report.overall,
  evidenceSha256: report.evidenceSha256,
  ghostExecution: report.executionAttribution,
  dockerRuntime: "NOT_CLAIMED",
  databaseRuntime: "NOT_CLAIMED",
  written,
  blockers: report.blockers,
  at: new Date().toISOString(),
};
writeFileSync(path.join(evidenceDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(report.overall === "BLOCKED" ? 1 : 0);
