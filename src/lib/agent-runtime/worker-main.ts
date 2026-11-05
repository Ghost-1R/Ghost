/**
 * Dedicated MOCK worker entrypoint.
 * Start: npm run worker
 * Render: same repo, start command `npm run worker` only if a background slot already exists.
 * Default recommended path: GHOST_WORKER_IN_PROCESS=1 on the existing web service.
 *
 * Does not call paid providers. Exits if LIVE=1.
 */

import { isCodegenLiveEnabled } from "../codegen/provider-config";
import { shouldStartInProcessMockWorker } from "./in-process-worker";

function main(): void {
  if (isCodegenLiveEnabled()) {
    console.error("ghost.worker.refused LIVE=1 — no paid dispatch from this process.");
    process.exit(2);
  }
  const gate = shouldStartInProcessMockWorker({
    ...process.env,
    GHOST_WORKER_IN_PROCESS: process.env.GHOST_WORKER_IN_PROCESS ?? "1",
  });
  if (!gate.ok && process.env.GHOST_WORKER_IN_PROCESS?.trim() !== "1") {
    console.info("ghost.worker.cli", {
      mode: "MOCK_GENERATION",
      detail: "Standalone worker process ready. It will not invent queued work.",
    });
    return;
  }
  console.info("ghost.worker.cli", {
    mode: "MOCK_GENERATION",
    liveHttp: false,
    instruction: "Claim is demand-driven from the worker workspace MOCK step.",
  });
}

main();
