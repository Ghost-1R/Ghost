import assert from "node:assert/strict";
import test from "node:test";
import { shouldStartInProcessMockWorker } from "./in-process-worker";

test("in-process worker stays off by default and refuses LIVE", () => {
  assert.equal(shouldStartInProcessMockWorker({}).ok, false);
  const live = shouldStartInProcessMockWorker({
    GHOST_WORKER_IN_PROCESS: "1",
    GHOST_CODEGEN_LIVE_ENABLED: "1",
  });
  assert.equal(live.ok, false);
  if (!live.ok) assert.match(live.reason, /LIVE/);
});

test("in-process worker may start only as MOCK when explicitly armed", () => {
  const ok = shouldStartInProcessMockWorker({
    GHOST_WORKER_IN_PROCESS: "1",
    GHOST_CODEGEN_LIVE_ENABLED: "0",
  });
  assert.equal(ok.ok, true);
});
