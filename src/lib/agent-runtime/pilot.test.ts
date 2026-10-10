import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildPilotEvidencePack } from "./pilot-evidence";
import { getIsolatedPilotGate, PILOT_ENV_FLAG } from "./pilot-config";
import { runIsolatedPilot, resolvePilotCommandOrReject } from "./pilot-executor";
import {
  buildFixtureManifest,
  materializeHarmlessFixture,
  resolveHarmlessFixtureSource,
} from "./pilot-fixture";
import {
  assertNoSymlinkEscape,
  assertWorkspacePathAllowed,
  createCodeWorkspaceContract,
} from "./workspace";
import { OWNER_ID, PROJECT_ID } from "./test-helpers";

const WORK_ROOT = "/tmp/ghost-pilot-workspaces-test";

test("pilot gate disabled by default", () => {
  const previous = process.env[PILOT_ENV_FLAG];
  delete process.env[PILOT_ENV_FLAG];
  try {
    const gate = getIsolatedPilotGate();
    assert.equal(gate.ok, false);
    assert.equal(gate.enabled, false);
  } finally {
    if (previous === undefined) delete process.env[PILOT_ENV_FLAG];
    else process.env[PILOT_ENV_FLAG] = previous;
  }
});

test("pilot gate refuses when hosted agent execution flag is set", () => {
  const prevPilot = process.env[PILOT_ENV_FLAG];
  const prevExec = process.env.GHOST_AGENT_EXECUTION_ENABLED;
  process.env[PILOT_ENV_FLAG] = "1";
  process.env.GHOST_AGENT_EXECUTION_ENABLED = "1";
  try {
    const gate = getIsolatedPilotGate();
    assert.equal(gate.ok, false);
  } finally {
    if (prevPilot === undefined) delete process.env[PILOT_ENV_FLAG];
    else process.env[PILOT_ENV_FLAG] = prevPilot;
    if (prevExec === undefined) delete process.env.GHOST_AGENT_EXECUTION_ENABLED;
    else process.env.GHOST_AGENT_EXECUTION_ENABLED = prevExec;
  }
});

test("harmless fixture manifest is stable and secret-free", () => {
  const source = resolveHarmlessFixtureSource();
  assert.ok(existsSync(source));
  const manifest = buildFixtureManifest(source);
  assert.equal(manifest.fixtureId, "harmless-node");
  assert.ok(manifest.fileCount >= 4);
  assert.equal(manifest.contentSha256.length, 64);
  assert.ok(!manifest.files.some((f) => f.relativePath.includes(".env")));
});

test("materialize fixture into isolated workspace and cleanup path", () => {
  rmSync(WORK_ROOT, { recursive: true, force: true });
  mkdirSync(WORK_ROOT, { recursive: true });
  const ws = createCodeWorkspaceContract({
    taskId: "pilot-mat-1",
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    workspaceRoot: WORK_ROOT,
  });
  assert.equal(ws.ok, true);
  if (!ws.ok) return;
  const mat = materializeHarmlessFixture(ws.contract);
  assert.equal(mat.ok, true);
  if (!mat.ok) return;
  assert.ok(existsSync(path.join(mat.workspaceFixturePath, "package.json")));
  rmSync(ws.contract.hostPath, { recursive: true, force: true });
  assert.equal(existsSync(ws.contract.hostPath), false);
});

test("symlink escape is rejected", () => {
  rmSync(WORK_ROOT, { recursive: true, force: true });
  const ws = createCodeWorkspaceContract({
    taskId: "pilot-symlink",
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    workspaceRoot: WORK_ROOT,
  });
  assert.equal(ws.ok, true);
  if (!ws.ok) return;
  mkdirSync(ws.contract.hostPath, { recursive: true });
  const link = path.join(ws.contract.hostPath, "escape-link");
  symlinkSync("/etc", link);
  const check = assertNoSymlinkEscape(ws.contract.hostPath, link);
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.reason, "SYMLINK_ESCAPE");
  rmSync(WORK_ROOT, { recursive: true, force: true });
});

test("malicious commands rejected; allowlisted commands resolve", () => {
  assert.equal(resolvePilotCommandOrReject("rm -rf /").ok, false);
  assert.equal(resolvePilotCommandOrReject("build").ok, true);
});

test("dry-run pilot with gate enabled records NOT_RUN container execution honestly", () => {
  const prevPilot = process.env[PILOT_ENV_FLAG];
  const prevRoot = process.env.GHOST_AGENT_WORKSPACE_ROOT;
  process.env[PILOT_ENV_FLAG] = "1";
  process.env.GHOST_AGENT_WORKSPACE_ROOT = WORK_ROOT;
  rmSync(WORK_ROOT, { recursive: true, force: true });
  try {
    const report = runIsolatedPilot({
      workspaceRoot: WORK_ROOT,
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      forceDryRun: true,
    });
    assert.equal(report.pilotEnabled, true);
    assert.equal(report.realContainerExecution, false);
    assert.ok(report.fixture);
    assert.ok(report.scenarios.length >= 5);
    assert.ok(report.scenarios.every((s) => s.classification === "NOT_RUN"));
    assert.ok(report.scenarios.every((s) => s.dockerArgv != null));
    assert.equal(report.cleanup.classification, "PASS");
    assert.equal(existsSync(report.workspacePath ?? ""), false);

    const evidence = buildPilotEvidencePack(report, {
      writeDir: "/opt/cursor/artifacts",
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
    });
    assert.ok(evidence.classification === "NOT_RUN" || evidence.classification === "PARTIAL");
    assert.equal(evidence.evidenceSha256.length, 64);
    assert.ok(evidence.writtenPath && existsSync(evidence.writtenPath));
    assert.ok(evidence.notes.some((n) => /No real container execution/i.test(n)));
  } finally {
    if (prevPilot === undefined) delete process.env[PILOT_ENV_FLAG];
    else process.env[PILOT_ENV_FLAG] = prevPilot;
    if (prevRoot === undefined) delete process.env.GHOST_AGENT_WORKSPACE_ROOT;
    else process.env.GHOST_AGENT_WORKSPACE_ROOT = prevRoot;
    rmSync(WORK_ROOT, { recursive: true, force: true });
  }
});

test("disabled pilot does not create workspace or claim success", () => {
  const previous = process.env[PILOT_ENV_FLAG];
  delete process.env[PILOT_ENV_FLAG];
  try {
    const report = runIsolatedPilot({ forceDryRun: true, workspaceRoot: WORK_ROOT });
    assert.equal(report.pilotEnabled, false);
    assert.equal(report.realContainerExecution, false);
    assert.equal(report.scenarios.length, 0);
    const evidence = buildPilotEvidencePack(report);
    assert.equal(evidence.classification, "BLOCKED");
  } finally {
    if (previous === undefined) delete process.env[PILOT_ENV_FLAG];
    else process.env[PILOT_ENV_FLAG] = previous;
  }
});

test("workspace rejects writing .env into fixture path", () => {
  rmSync(WORK_ROOT, { recursive: true, force: true });
  const ws = createCodeWorkspaceContract({
    taskId: "pilot-env",
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    workspaceRoot: WORK_ROOT,
  });
  assert.equal(ws.ok, true);
  if (!ws.ok) return;
  mkdirSync(ws.contract.hostPath, { recursive: true });
  writeFileSync(path.join(ws.contract.hostPath, ".env"), "SECRET=1");
  const denied = assertWorkspacePathAllowed(ws.contract, ".env");
  assert.equal(denied.ok, false);
  rmSync(WORK_ROOT, { recursive: true, force: true });
});
