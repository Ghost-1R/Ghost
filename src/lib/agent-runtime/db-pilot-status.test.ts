import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

/**
 * Honest DB/Docker availability for Build 09.9 — never claim integration passed.
 */
test("disposable database and docker remain unavailable — integration BLOCKED", () => {
  const docker = spawnSync("docker", ["info"], { encoding: "utf8" });
  const psql = spawnSync("psql", ["--version"], { encoding: "utf8" });
  assert.notEqual(docker.status, 0);
  assert.notEqual(psql.status ?? 1, 0);

  const status = {
    databaseEnvironment: "UNAVAILABLE",
    migrationsAppliedLocally: false,
    realDbIntegration: "BLOCKED",
    atomicApprovalConsumptionDb: "NOT_RUN",
    dockerAvailable: false,
    realContainerExecution: "NOT_RUN",
  };
  assert.equal(status.realDbIntegration, "BLOCKED");
  assert.equal(status.migrationsAppliedLocally, false);
  assert.equal(status.realContainerExecution, "NOT_RUN");
});
