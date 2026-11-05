import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Honest readiness probe for Build 09.9C.
 * Never claims PostgreSQL integration passed without a disposable local DB.
 */

test("durable DB integration suite is prepared and gated", () => {
  const integration = readFileSync(
    path.join(process.cwd(), "src/lib/remote-development/db.integration.test.ts"),
    "utf8",
  );
  const runner = readFileSync(
    path.join(process.cwd(), ".ghost/run-local-durable-db-tests.mjs"),
    "utf8",
  );
  const pack = readFileSync(
    path.join(process.cwd(), ".ghost/WINDOWS_DB_VERIFICATION_PACK.md"),
    "utf8",
  );

  assert.match(integration, /GHOST_LOCAL_DURABLE_DB_TEST/);
  assert.match(integration, /ONE_TIME/);
  assert.match(integration, /concurrent/i);
  assert.match(integration, /revoke|expir/i);
  assert.match(integration, /agent_task_id/);
  assert.match(integration, /hosted Supabase/);
  assert.match(integration, /GHOST_LOCAL_DURABLE_DB_TEST/);
  assert.match(runner, /Refusing durable DB tests/);
  assert.match(runner, /production Supabase host detected/);
  assert.match(runner, /Never runs supabase db push/i);
  assert.match(pack, /disposable/i);
  assert.match(pack, /NEVER reset an existing Ghost development database/i);
});

test("cloud environment does not claim PostgreSQL runtime results", () => {
  const docker = spawnSync("docker", ["info"], { encoding: "utf8" });
  const dockerAvailable = docker.status === 0;
  const durableFlag = process.env.GHOST_LOCAL_DURABLE_DB_TEST === "1";

  const report = {
    docker: dockerAvailable ? "AVAILABLE" : "UNAVAILABLE",
    durableDbFlag: durableFlag,
    dbRuntimeResults: "NOT_RUN",
    reason: dockerAvailable
      ? "Docker present but durable DB suite was not executed in this cloud prep turn"
      : "Docker unavailable in this cloud environment; Windows pack prepared instead",
  };

  assert.equal(report.dbRuntimeResults, "NOT_RUN");
  assert.equal(report.durableDbFlag, false);
  // Do not require docker absence forever — only assert we did not claim a pass.
  assert.notEqual(report.dbRuntimeResults, "PASS");
});
