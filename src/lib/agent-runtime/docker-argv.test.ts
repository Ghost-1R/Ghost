import assert from "node:assert/strict";
import test from "node:test";
import { buildDockerRunArgv } from "./docker-argv";
import { buildDockerExecutionSpec } from "./docker-safeguards";
import { createCodeWorkspaceContract } from "./workspace";
import { OWNER_ID, PROJECT_ID } from "./test-helpers";
import { PILOT_IMAGE, PILOT_USER } from "./pilot-config";

function safeSpec() {
  const ws = createCodeWorkspaceContract({
    taskId: "task-argv",
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    workspaceRoot: "/var/ghost-agent-workspaces",
  });
  assert.equal(ws.ok, true);
  if (!ws.ok) throw new Error("workspace");
  const spec = buildDockerExecutionSpec({
    workspace: ws.contract,
    image: PILOT_IMAGE,
    user: PILOT_USER,
  });
  assert.equal(spec.ok, true);
  if (!spec.ok) throw new Error("spec");
  return spec.spec;
}

test("builds docker argv with non-root network-none no privileged", () => {
  const result = buildDockerRunArgv({
    spec: safeSpec(),
    containerName: "ghost-pilot-test-1",
    command: ["node", "--test", "./test.mjs"],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.argv.includes("--network"));
  assert.ok(result.argv.includes("none"));
  assert.ok(result.argv.includes("--read-only"));
  assert.ok(result.argv.includes("--cap-drop"));
  assert.ok(result.argv.includes("ALL"));
  assert.ok(!result.argv.includes("--privileged"));
  assert.ok(!result.argv.some((p) => p.includes("docker.sock")));
  assert.ok(result.argv.includes(PILOT_IMAGE));
});

test("rejects shell metacharacters and docker flag injection", () => {
  const spec = safeSpec();
  assert.equal(
    buildDockerRunArgv({
      spec,
      containerName: "ghost-pilot-test-2",
      command: ["node", "-e", "console.log(1); rm -rf /"],
    }).ok,
    false,
  );
  assert.equal(
    buildDockerRunArgv({
      spec,
      containerName: "ghost-pilot-test-3",
      command: ["--privileged"],
    }).ok,
    false,
  );
  assert.equal(
    buildDockerRunArgv({
      spec,
      containerName: "bad;name",
      command: ["node", "./build.mjs"],
    }).ok,
    false,
  );
});
