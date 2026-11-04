import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPilot01AuthorizationPreview,
  inspectPilot01Sources,
  preparePilot01Harness,
  reviewPilot01Sample,
} from "./harness";
import {
  PILOT_01_ACTION_TYPE,
  PILOT_01_AUTHORIZATION_KIND,
  PILOT_01_OBJECTIVE,
  PILOT_01_PERMITTED_FILES,
} from "./task-spec";
import { developmentApprovalGrantsDeployment } from "@/lib/agent-runtime/authorization-kind";

test("pilot 01 sources exist in disposable sample workspace", () => {
  const checks = inspectPilot01Sources();
  assert.equal(checks.length, PILOT_01_PERMITTED_FILES.length);
  for (const row of checks) {
    assert.equal(row.present, true, `missing ${row.path}`);
    assert.ok(row.bytes > 0);
  }
});

test("pilot 01 static review accepts sample landing page", () => {
  const review = reviewPilot01Sample();
  const failed = review.filter((row) => !row.pass);
  assert.deepEqual(failed, []);
});

test("pilot 01 authorization dry-run passes and does not grant deployment", () => {
  const preview = buildPilot01AuthorizationPreview();
  assert.equal(preview.gateDryRun.ok, true);
  assert.equal(preview.fingerprint.length, 64);
  assert.equal(developmentApprovalGrantsDeployment(PILOT_01_ACTION_TYPE, "DEPLOYMENT"), false);
  assert.equal(PILOT_01_AUTHORIZATION_KIND, "DEVELOPMENT");
});

test("pilot 01 harness prepares without claiming Ghost docker/db execution", () => {
  const report = preparePilot01Harness({ runDockerPilot: false });
  assert.equal(report.objective, PILOT_01_OBJECTIVE);
  assert.equal(report.executionAttribution.ghostDurableWorkflow, "PREPARED_NOT_DISPATCHED");
  assert.equal(report.executionAttribution.ghostIsolatedDockerPilot, "NOT_RUN");
  assert.equal(report.executionAttribution.cursorCloudOrDesktopPreparation, "SOURCE_AND_HARNESS");
  assert.equal(report.dockerPilot.attribution, "NOT_RUN");
  assert.ok(report.evidenceSha256.length === 64);
  assert.ok(report.overall === "READY" || report.overall === "PARTIAL");
});

test("security migration text rejects revoked/expired new binds", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261011100000_agent_tasks_reject_revoked_expired_auth.sql"),
    "utf8",
  );
  assert.match(sql, /LOCAL ONLY/i);
  assert.match(sql, /Do not apply to hosted Supabase/i);
  assert.match(sql, /tg_op = 'INSERT'/);
  assert.match(sql, /REVOKED/);
  assert.match(sql, /EXPIRED/);
  assert.match(sql, /CONSUMED/);
  assert.match(sql, /cannot bind to revoked/);
});
