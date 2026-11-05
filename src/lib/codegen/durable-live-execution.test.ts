import assert from "node:assert/strict";
import test from "node:test";
import { executeDurableCodegenLivePipeline } from "./durable-live-execution";
import type { GhostClient } from "@/lib/auth/session";

test("live entrypoint disabled by default without touching database", async () => {
  assert.notEqual(process.env.GHOST_CODEGEN_LIVE_ENABLED, "1");
  const result = await executeDurableCodegenLivePipeline({} as GhostClient, {
    ownerId: "00000000-0000-0000-0000-000000000001",
    remoteTaskId: "00000000-0000-0000-0000-000000000002",
    env: { GHOST_CODEGEN_LIVE_ENABLED: undefined },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "LIVE_DISABLED");
});
