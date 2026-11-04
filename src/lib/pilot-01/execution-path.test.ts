import assert from "node:assert/strict";
import test from "node:test";
import { describePilot01ExecutionPath, summarizePilot01Attribution } from "./execution-path";

test("pilot 01 path honestly marks Ghost codegen as not implemented without docker fixture", () => {
  const path = describePilot01ExecutionPath({ securitySqlVerified: true, dockerPilotRan: false });
  const exec = path.find((s) => s.stage === "EXECUTION");
  assert.ok(exec);
  assert.equal(exec?.status, "NOT_IMPLEMENTED");
  assert.equal(exec?.actor, "NONE");
  const summary = summarizePilot01Attribution(path);
  assert.ok(summary.notImplemented.some((line) => /NOT IMPLEMENTED/i.test(line)));
  assert.equal(summary.ghostActualExecution.length, 0);
});

test("pilot 01 path attributes docker fixture run to Ghost runtime when verified", () => {
  const path = describePilot01ExecutionPath({ securitySqlVerified: true, dockerPilotRan: true });
  const exec = path.find((s) => s.stage === "EXECUTION");
  assert.equal(exec?.status, "VERIFIED");
  assert.equal(exec?.actor, "GHOST_RUNTIME");
  assert.match(exec?.detail ?? "", /fixture/i);
  assert.doesNotMatch(exec?.detail ?? "", /car-rental code generation/i);
});
