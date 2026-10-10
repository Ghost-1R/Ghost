import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

/**
 * Honest availability probe — never claims DB integration passed without a DB.
 */
test("isolated disposable database is unavailable in this environment", () => {
  const docker = spawnSync("docker", ["info"], { encoding: "utf8" });
  const dockerAvailable = docker.status === 0;
  assert.equal(dockerAvailable, false, "expected Docker to be unavailable here");

  // Document BLOCKED status for founder report — do not skip silently as pass.
  const status = {
    localDisposableDb: "UNAVAILABLE",
    docker: "UNAVAILABLE",
    migrationApplied: false,
    dbIntegrationPassed: false,
    reason: "docker/supabase local stack not present; migration files reviewed by shape tests only",
  };
  assert.equal(status.dbIntegrationPassed, false);
  assert.equal(status.migrationApplied, false);
});
