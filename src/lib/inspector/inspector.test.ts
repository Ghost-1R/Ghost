import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { actionFingerprint, canExecute, chatCannotApprove } from "./approval";
import { commandAllowed, findSafeCheck, shellInputRejected } from "./checks";
import { explainInspections } from "./evidence";
import { classifyRisk } from "./risk";
import { runDisposableFailure } from "./runner";
import { sanitizeOutput } from "./sanitize";
import { decideApproval, deleteInspection, listApprovals, listInspections, proposeApproval, saveInspection } from "./store";
import { authSignupStatus, databaseDistinction, deploymentStatus, isStale, treeStamp } from "./status";
import type { ActionApproval, ActionRequest } from "./types";

const ownerA = "18cc1011-3b62-4dba-8359-1b77c37f2118";
const ownerB = "d1b38554-5dae-4112-9e14-8baaa05181cf";

function request(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionType: "apply-remote-migration",
    target: "20260929053000_message_metadata.sql",
    parameters: { migration: "20260929053000_message_metadata.sql" },
    projectId: "7f252953-ecab-4b5e-9762-5f3fe1c6a45d",
    reason: "represent only",
    expectedEffect: "none",
    verificationPlan: "confirm no remote change",
    rollbackPlan: "nothing was applied",
    ...overrides,
  };
}

function approvalFor(value: ActionRequest, status: ActionApproval["status"]): ActionApproval {
  return {
    id: "approval-a",
    ownerId: ownerA,
    projectId: value.projectId,
    actionType: value.actionType,
    target: value.target,
    parameters: value.parameters,
    fingerprint: actionFingerprint(value),
    risk: "HIGH",
    reason: value.reason,
    expectedEffect: value.expectedEffect,
    verificationPlan: value.verificationPlan,
    rollbackPlan: value.rollbackPlan,
    status,
    createdAt: "2026-09-29T00:00:00.000Z",
    decidedAt: null,
  };
}

test("verification states stay distinct and checks reject shell text", () => {
  const states = ["CLAIMED", "OBSERVED", "VERIFIED", "FAILED", "BLOCKED", "NOT_VERIFIED"];
  assert.equal(new Set(states).size, states.length);
  assert.equal(shellInputRejected("npm test; Remove-Item -Recurse -Force ."), true);
  assert.equal(shellInputRejected("npm test"), true);
  assert.equal(findSafeCheck("test")?.command?.join(" "), "npm test");
  assert.equal(commandAllowed(["npm", "test"]), true);
  assert.equal(commandAllowed(["npm", "test", ";", "rm", "-rf", "."]), false);
  assert.equal(commandAllowed(["powershell", "-Command", "Remove-Item -Recurse -Force ."]), false);
});

test("evidence redaction and output bounds do not keep secret material", () => {
  const secret = "authorization: Bearer sk-test-secret-value-xxxx password=hunter2";
  const sanitized = sanitizeOutput(`${secret}\n${"x".repeat(2000)}`);
  assert.equal(sanitized.includes("sk-test-secret-value-xxxx"), false);
  assert.equal(sanitized.includes("hunter2"), false);
  assert.equal(sanitized.includes("[redacted]"), true);
  assert.equal(sanitized.includes("[truncated]"), true);
  assert.ok(sanitized.length < 1400);
});

test("local verification is bound to a tree and becomes stale when it changes", () => {
  const commitA = "8d30cfc581a5d29107d4f66bfad9bba0b501bb13";
  const commitB = "b00dc39b2bdbedc3c6d6e55ccaad95f8a45306c6";
  const clean = treeStamp(commitA, []);
  const dirty = treeStamp(commitA, ["note.txt"]);
  const result = {
    name: "Build",
    status: "VERIFIED" as const,
    commit: commitA,
    workingTree: "clean" as const,
    treeStamp: clean,
  };
  assert.equal(isStale(result, { commit: commitA, treeStamp: clean }), false);
  assert.equal(isStale(result, { commit: commitB, treeStamp: treeStamp(commitB, []) }), true);
  assert.equal(isStale(result, { commit: commitA, treeStamp: dirty }), true);
  const explained = explainInspections({
    question: "build",
    results: [
      {
        id: "build-1",
        ownerId: ownerA,
        projectId: null,
        checkId: "build",
        checkType: "BUILD",
        name: "Build",
        status: "VERIFIED",
        risk: "SAFE",
        startedAt: "2026-09-29T00:00:00.000Z",
        completedAt: "2026-09-29T00:01:00.000Z",
        exitCode: 0,
        stdout: "",
        stderr: "",
        commit: commitA,
        workingTree: "clean",
        treeStamp: clean,
        scope: "local",
        summary: "Build exited 0.",
      },
    ],
    current: { commit: commitB, workingTree: "dirty", treeStamp: treeStamp(commitB, ["note.txt"]) },
    verificationLines: [],
  });
  assert.match(explained.text, /does not verify the current tree/);
  assert.equal(explained.text.includes("deployment"), false);
});

test("risk, approval fingerprint, rejection, and critical actions cannot slip through", async () => {
  assert.equal(classifyRisk("run-tests"), "SAFE");
  assert.equal(classifyRisk("approve-memory"), "CAUTION");
  assert.equal(classifyRisk("apply-remote-migration"), "HIGH");
  assert.equal(classifyRisk("remote-db-reset"), "CRITICAL");
  assert.equal(chatCannotApprove("yeah sure"), true);

  const original = request();
  const changed = request({ parameters: { migration: "other.sql" } });
  assert.notEqual(actionFingerprint(original), actionFingerprint(changed));
  assert.equal(canExecute(null, original).reason, "UNSUPPORTED");
  assert.equal(canExecute(approvalFor(original, "PENDING"), original).reason, "PENDING");
  assert.equal(canExecute(approvalFor(original, "REJECTED"), original).reason, "REJECTED");
  assert.equal(canExecute(approvalFor(original, "APPROVED"), changed).reason, "FINGERPRINT_MISMATCH");
  assert.equal(canExecute(approvalFor(original, "APPROVED"), original).reason, "UNSUPPORTED");
  assert.equal(canExecute(null, request({ actionType: "remote-db-reset" })).reason, "UNSUPPORTED");
  assert.equal(canExecute(approvalFor(request({ actionType: "remote-db-reset" }), "APPROVED"), request({ actionType: "remote-db-reset" })).ok, false);

  const root = await mkdtemp(path.join(tmpdir(), "ghost-inspector-"));
  try {
    const stored = await proposeApproval(root, ownerA, original);
    assert.equal(stored?.status, "PENDING");
    assert.equal(await decideApproval(root, ownerB, stored?.id ?? "", "APPROVED"), null);
    const rejected = await decideApproval(root, ownerA, stored?.id ?? "", "REJECTED");
    assert.equal(rejected?.status, "REJECTED");
    assert.equal((await listApprovals(root, ownerB)).length, 0);
    assert.equal((await listApprovals(root, ownerA)).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("build does not verify deployment and database files are not remote proof", () => {
  assert.equal(deploymentStatus({ provider: null, buildVerified: true }), "NOT_VERIFIED");
  assert.equal(deploymentStatus({ provider: "other", buildVerified: true }), "NOT_VERIFIED");
  const database = databaseDistinction({ migrationFileExists: true, remoteSupported: false });
  assert.equal(database.fileStatus, "OBSERVED");
  assert.equal(database.remoteStatus, "NOT_VERIFIED");
  assert.equal(databaseDistinction({ migrationFileExists: true, remoteSupported: true }).remoteStatus, "VERIFIED");
  assert.equal(authSignupStatus({ accountAccepted: true, emailConfirmed: false }), "NOT_VERIFIED");
});

test("a disposable failing command stays FAILED and owners cannot read each other's evidence", async () => {
  const failed = await runDisposableFailure({ ownerId: ownerA, projectId: null, cwd: process.cwd() });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.exitCode, 1);
  assert.match(failed.summary, /failed/i);
  const inventory = explainInspections({
    question: "inventory",
    results: [failed],
    current: { commit: failed.commit ?? "", workingTree: failed.workingTree ?? "dirty", treeStamp: failed.treeStamp ?? "" },
    verificationLines: ["Production: NOT_VERIFIED"],
  });
  assert.match(inventory.text, /Failed checks stay failed/);
  assert.equal(/disposable failure: verified/i.test(inventory.text), false);

  const root = await mkdtemp(path.join(tmpdir(), "ghost-inspector-"));
  try {
    await saveInspection(root, failed);
    assert.equal((await listInspections(root, ownerB)).length, 0);
    assert.equal((await listInspections(root, ownerA)).length, 1);
    await deleteInspection(root, ownerA, failed.id);
    assert.equal((await listInspections(root, ownerA)).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
