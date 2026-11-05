/**
 * Run Ghost isolated Docker pilot (harmless fixture only) for Pilot 01 overnight evidence.
 * Requires GHOST_ISOLATED_PILOT_ENABLED=1. Never activates general workers.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(root, ".ghost", "pilot-01", "evidence");
mkdirSync(evidenceDir, { recursive: true });

process.env.GHOST_ISOLATED_PILOT_ENABLED = "1";
delete process.env.GHOST_AGENT_EXECUTION_ENABLED;

const workspaceRoot = path.join(os.tmpdir(), "ghost-pilot-01-workspaces");
mkdirSync(workspaceRoot, { recursive: true });
process.env.GHOST_AGENT_WORKSPACE_ROOT = workspaceRoot;

const { runIsolatedPilot, summarizePilotReport } = await import(
  pathToFileURL(path.join(root, "src/lib/agent-runtime/pilot-executor.ts")).href
);
const { buildPilotEvidencePack } = await import(
  pathToFileURL(path.join(root, "src/lib/agent-runtime/pilot-evidence.ts")).href
);

const report = runIsolatedPilot({
  workspaceRoot,
  ownerId: "00000000-0000-4000-8000-0000000000a1",
  projectId: "00000000-0000-4000-8000-0000000000b1",
  taskId: "pilot-01-docker-fixture",
});
const summary = summarizePilotReport(report);
const pack = buildPilotEvidencePack(report, {
  writeDir: evidenceDir,
  ownerId: "00000000-0000-4000-8000-0000000000a1",
  projectId: "00000000-0000-4000-8000-0000000000b1",
  taskId: "pilot-01-docker-fixture",
});

const out = {
  attribution: "GHOST_ISOLATED_PILOT_FIXTURE_ONLY",
  note: "Executes predefined harmless Node fixture — not car-rental code generation.",
  workspaceRoot,
  realContainerExecution: report.realContainerExecution,
  dockerAvailable: report.dockerAvailable,
  pilotEnabled: report.pilotEnabled,
  summary,
  securityChecks: report.securityChecks,
  scenarios: report.scenarios.map((s) => ({
    scenario: s.scenario,
    classification: s.classification,
    exitCode: s.exitCode,
    timedOut: s.timedOut,
    detail: s.detail,
  })),
  cleanup: report.cleanup.classification,
  evidencePath: pack.writtenPath,
  at: new Date().toISOString(),
};
writeFileSync(path.join(evidenceDir, "docker-pilot-run.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(report.realContainerExecution && summary.overall !== "FAIL" ? 0 : 2);
