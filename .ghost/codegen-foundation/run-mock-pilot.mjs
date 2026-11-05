/**
 * Safe mock code-generation pilot — MOCK_GENERATION only.
 * No live providers. No Pilot 02 auth reuse. No deployment.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(root, ".ghost", "codegen-foundation", "evidence");
mkdirSync(evidenceDir, { recursive: true });

process.env.GHOST_NO_LIVE_PROVIDER_CALLS = "1";
delete process.env.GHOST_CODEGEN_LIVE_ENABLED;
delete process.env.GHOST_AGENT_EXECUTION_ENABLED;

const { makeApprovedCodingAuth, runSupervisedMockCodegen } = await import(
  pathToFileURL(path.join(root, "src/lib/codegen/index.ts")).href
);

const workspaceRoot = path.join(os.tmpdir(), "ghost-codegen-mock-pilot");
mkdirSync(workspaceRoot, { recursive: true });

const objective = "Generate a responsive vehicle comparison component with three dummy vehicles.";
const auth = makeApprovedCodingAuth({ objective });
const run = await runSupervisedMockCodegen({
  authorization: auth,
  ownerId: auth.ownerId,
  projectId: auth.projectId,
  objective,
  classification: "INTERNAL",
  workspaceRoot,
});

if (!run.ok) {
  writeFileSync(path.join(evidenceDir, "mock-codegen-pilot.json"), JSON.stringify({ ok: false, run }, null, 2));
  console.error("MOCK_PILOT_FAILED", run.reason, run.message);
  process.exit(1);
}

let dockerTest = { ran: false, exitCode: null, stdout: "", stderr: "" };
if (run.run.materialize?.ok) {
  const testFile = path.join(run.run.materialize.workspacePath, "generated/vehicle-comparison/test.mjs");
  const result = spawnSync(process.execPath, [testFile], {
    encoding: "utf8",
    timeout: 15_000,
    cwd: path.dirname(testFile),
  });
  dockerTest = {
    ran: true,
    mode: "NODE_LOCAL_TEST",
    note: "Node test runner inside isolated workspace (not claiming Docker for this step).",
    exitCode: result.status,
    stdout: (result.stdout || "").slice(0, 2000),
    stderr: (result.stderr || "").slice(0, 2000),
  };
}

// Optional restricted Docker validate when Docker available
let docker = { attempted: false, real: false };
try {
  const ver = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 10_000 });
  if (ver.status === 0 && run.run.materialize?.ok) {
    docker.attempted = true;
    const hostDir = path.join(run.run.materialize.workspacePath, "generated/vehicle-comparison");
    const name = `ghost-codegen-mock-${Date.now()}`;
    const argv = [
      "run",
      "--rm",
      "--name",
      name,
      "--network",
      "none",
      "--user",
      "10001:10001",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      "--memory",
      "256m",
      "--cpus",
      "0.5",
      "--pids-limit",
      "128",
      "-v",
      `${hostDir}:/workspace:ro`,
      "-w",
      "/workspace",
      "node:22-alpine",
      "node",
      "./test.mjs",
    ];
    const d = spawnSync("docker", argv, { encoding: "utf8", timeout: 60_000 });
    docker = {
      attempted: true,
      real: true,
      exitCode: d.status,
      timedOut: Boolean(d.error && /TIMEDOUT/i.test(String(d.error))),
      stdout: (d.stdout || "").slice(0, 2000),
      stderr: (d.stderr || "").slice(0, 2000),
    };
    spawnSync("docker", ["rm", "-f", name], { timeout: 10_000 });
  }
} catch {
  docker = { attempted: false, real: false, error: "docker probe failed" };
}

const report = {
  mode: "MOCK_GENERATION",
  note: "Deterministic mock code generation. Not real AI coding. Not Cursor-prepared car-rental reuse.",
  finalStatus: "MOCK_CODEGEN_AWAITING_FOUNDER_REVIEW",
  founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
  autoAccepted: false,
  liveProvider: false,
  deployment: false,
  authorizationFixture: {
    id: auth.id,
    status: auth.status,
    environmentLabel: auth.environmentLabel,
    note: "In-memory APPROVED fixture for mock pilot — separate from Pilot 02 consumed authorization.",
  },
  run: {
    runId: run.run.runId,
    checkpoints: run.run.checkpoints,
    generationOk: run.run.generation.ok,
    attribution: run.run.generation.ok ? run.run.generation.attribution : run.run.generation.attribution,
    proposalCount: run.run.generation.ok ? run.run.generation.proposals.length : 0,
    materialize: run.run.materialize,
  },
  nodeTest: dockerTest,
  docker,
  productionUnchanged: true,
};

const body = JSON.stringify(report, null, 2);
report.evidenceSha256 = createHash("sha256").update(body).digest("hex");
writeFileSync(path.join(evidenceDir, "mock-codegen-pilot.json"), JSON.stringify(report, null, 2));

if (run.run.materialize?.ok) {
  // keep workspace for founder inspection under evidence copy list
  writeFileSync(
    path.join(evidenceDir, "mock-workspace-pointer.json"),
    JSON.stringify(
      {
        workspacePath: run.run.materialize.workspacePath,
        contentSha256: run.run.materialize.contentSha256,
        files: run.run.materialize.files,
      },
      null,
      2,
    ),
  );
}

console.log(
  JSON.stringify(
    {
      mode: "MOCK_GENERATION",
      finalStatus: report.finalStatus,
      generationOk: report.run.generationOk,
      dockerReal: docker.real,
      dockerExit: docker.exitCode ?? null,
      evidenceSha256: report.evidenceSha256,
    },
    null,
    2,
  ),
);
