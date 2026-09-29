import assert from "node:assert/strict";
import test from "node:test";
import { commandWaves, overallStage, runWaves, type InspectionProgress } from "./schedule";

function event(stage: InspectionProgress["stage"], check: string | null, status: InspectionProgress["status"]): InspectionProgress {
  return { stage, check, status, elapsedMs: 0, detail: check ?? stage };
}

test("the headline stage follows checks that are still running", () => {
  assert.equal(overallStage([]), null);
  assert.equal(overallStage([event("QUEUED", null, null)]), "QUEUED");
  const wave = [event("RUNNING", "Lint", "running"), event("RUNNING", "Git status", "running"), event("COLLECTING_EVIDENCE", "Git status", "passed")];
  assert.equal(overallStage(wave), "RUNNING");
  const probes = [...wave, event("COLLECTING_EVIDENCE", "Lint", "passed"), event("VERIFYING", "security-boundary", "running")];
  assert.equal(overallStage(probes), "VERIFYING");
  assert.equal(overallStage([...probes, event("COMPLETE", null, null)]), "COMPLETE");
  assert.equal(overallStage([...probes, event("FAILED", null, "failed")]), "FAILED");
});

test("read-only checks share a wave and build stays alone", () => {
  const waves = commandWaves(["test", "lint", "typescript", "build", "git-status"]);
  assert.deepEqual(waves[0], ["lint", "typescript", "test", "git-status"]);
  assert.deepEqual(waves[1], ["build"]);
});

test("an unknown command stays in its own later wave", () => {
  const waves = commandWaves(["lint", "custom-tool", "build"]);
  assert.deepEqual(waves, [["lint"], ["build"], ["custom-tool"]]);
});

test("overlapping read-only work finishes near the slowest check, then build", async () => {
  const started = Date.now();
  const seen: string[] = [];
  await runWaves(["lint", "typescript", "test", "build"], async (id) => {
    seen.push(`start:${id}`);
    await new Promise((resolve) => setTimeout(resolve, id === "build" ? 40 : 50));
    seen.push(`end:${id}`);
  });
  const elapsed = Date.now() - started;
  assert.ok(seen.indexOf("start:typescript") < seen.indexOf("end:lint"));
  assert.ok(seen.indexOf("start:test") < seen.indexOf("end:lint"));
  assert.ok(seen.indexOf("end:lint") < seen.indexOf("start:build"));
  assert.ok(elapsed < 400, `expected overlap, took ${elapsed}ms`);
});
