import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDockerSpecSafe,
  buildDockerExecutionSpec,
  invokeDockerExecution,
  probeDockerAvailability,
} from "./docker-safeguards";
import { createCodeWorkspaceContract } from "./workspace";
import { OWNER_ID, PROJECT_ID } from "./test-helpers";

function workspace() {
  const created = createCodeWorkspaceContract({
    taskId: "task-docker",
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    workspaceRoot: "/var/ghost-agent-workspaces",
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.reason);
  return created.contract;
}

test("builds non-root network-none resource-capped docker spec", () => {
  const spec = buildDockerExecutionSpec({
    workspace: workspace(),
    image: "ghost-agent-runner:local",
  });
  assert.equal(spec.ok, true);
  if (!spec.ok) return;
  assert.equal(spec.runtimeVerified, false);
  assert.equal(spec.spec.privileged, false);
  assert.equal(spec.spec.networkMode, "none");
  assert.equal(spec.spec.readOnlyRootFilesystem, true);
  assert.deepEqual(spec.spec.capDrop, ["ALL"]);
  assert.ok(spec.spec.user !== "root" && !spec.spec.user.startsWith("0:"));
  assert.ok(spec.spec.resourceCaps.memoryBytes <= 512 * 1024 * 1024);
  assert.ok(spec.spec.binds[0]?.includes(":rw"));
  assert.ok(!JSON.stringify(spec.spec).includes("docker.sock"));
});

test("rejects root user, secrets in env, unapproved image, and high caps", () => {
  const ws = workspace();
  assert.equal(
    buildDockerExecutionSpec({ workspace: ws, image: "ghost-agent-runner:local", user: "root" }).ok,
    false,
  );
  assert.equal(
    buildDockerExecutionSpec({
      workspace: ws,
      image: "ghost-agent-runner:local",
      env: { OPENAI_API_KEY: "sk-ant-api12345678" },
    }).ok,
    false,
  );
  assert.equal(
    buildDockerExecutionSpec({ workspace: ws, image: "ubuntu:latest" }).ok,
    false,
  );
  assert.equal(
    buildDockerExecutionSpec({
      workspace: ws,
      image: "ghost-agent-runner:local",
      resourceCaps: { memoryBytes: 8 * 1024 * 1024 * 1024 },
    }).ok,
    false,
  );
});

test("assertDockerSpecSafe rejects privileged network and docker.sock", () => {
  const built = buildDockerExecutionSpec({
    workspace: workspace(),
    image: "ghost-agent-runner:local",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(assertDockerSpecSafe(built.spec).ok, true);
  assert.equal(
    assertDockerSpecSafe({
      ...built.spec,
      networkMode: "bridge",
    } as typeof built.spec).ok,
    false,
  );
  assert.equal(
    assertDockerSpecSafe({
      ...built.spec,
      binds: ["/var/run/docker.sock:/var/run/docker.sock"],
    }).ok,
    false,
  );
});

test("docker invoke is disabled; availability probe reports UNVERIFIED runtime", () => {
  const probe = probeDockerAvailability();
  assert.equal(probe.runtimeVerified, false);
  // This environment has no Docker — document clearly.
  assert.equal(probe.available, false);
  assert.match(probe.detail, /UNVERIFIED|unavailable/i);

  const built = buildDockerExecutionSpec({
    workspace: workspace(),
    image: "ghost-agent-runner:local",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.throws(() => invokeDockerExecution(built.spec), /DOCKER_INVOKE_DISABLED/);
});
