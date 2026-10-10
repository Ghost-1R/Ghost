import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { assertWorkspacePathAllowed, createCodeWorkspaceContract } from "./workspace";
import { OWNER_ID, PROJECT_ID } from "./test-helpers";

test("creates isolated workspace under configured root outside app cwd", () => {
  const root = "/var/ghost-agent-workspaces";
  const result = createCodeWorkspaceContract({
    taskId: "task-1",
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    workspaceRoot: root,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.contract.containerPath, "/workspace");
  assert.equal(
    result.contract.hostPath,
    path.join(root, OWNER_ID, PROJECT_ID, "task-1"),
  );
  assert.ok(result.contract.forbiddenPaths.includes(path.resolve(process.cwd())));
  assert.equal(result.contract.secretMountMode, "TMPFS_ENV_ONLY");
});

test("refuses application cwd as workspace root", () => {
  const result = createCodeWorkspaceContract({
    taskId: "task-1",
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    workspaceRoot: process.cwd(),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "HOST_ROOT_FORBIDDEN");
});

test("refuses relative or missing workspace root", () => {
  const previous = process.env.GHOST_AGENT_WORKSPACE_ROOT;
  delete process.env.GHOST_AGENT_WORKSPACE_ROOT;
  try {
    const result = createCodeWorkspaceContract({
      taskId: "task-1",
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      workspaceRoot: "relative/path",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "INVALID_ROOT");
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENT_WORKSPACE_ROOT;
    else process.env.GHOST_AGENT_WORKSPACE_ROOT = previous;
  }
});

test("path escape and secret filenames fail closed", () => {
  const created = createCodeWorkspaceContract({
    taskId: "task-1",
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    workspaceRoot: "/var/ghost-agent-workspaces",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const escape = assertWorkspacePathAllowed(created.contract, "../../etc/passwd");
  assert.equal(escape.ok, false);
  if (!escape.ok) assert.equal(escape.reason, "PATH_ESCAPE");

  const secret = assertWorkspacePathAllowed(created.contract, ".env");
  assert.equal(secret.ok, false);
  if (!secret.ok) assert.equal(secret.reason, "SECRET_PATH_IN_WORKSPACE");

  const ok = assertWorkspacePathAllowed(created.contract, "src/index.ts");
  assert.equal(ok.ok, true);
});
