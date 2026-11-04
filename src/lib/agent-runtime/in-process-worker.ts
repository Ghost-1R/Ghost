/**
 * Optional in-process MOCK worker for Render web (no extra paid service).
 * A UI timer is not a worker. This boots from Node instrumentation only.
 * Default off. Never runs when LIVE=1.
 */

import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { getAgentExecutionGuard } from "./execution-guard";

export const WORKER_IN_PROCESS_FLAG = "GHOST_WORKER_IN_PROCESS";
export const WORKER_TICK_MS = 15_000;
export const WORKER_MAX_TICKS = 240;

export function shouldStartInProcessMockWorker(
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; reason: string } {
  if (env[WORKER_IN_PROCESS_FLAG]?.trim() !== "1") {
    return { ok: false, reason: "GHOST_WORKER_IN_PROCESS is not 1." };
  }
  if (isCodegenLiveEnabled(env)) {
    return { ok: false, reason: "Refusing in-process worker while GHOST_CODEGEN_LIVE_ENABLED=1." };
  }
  if (getAgentExecutionGuard().enabled) {
    return { ok: false, reason: "Execution guard is unexpectedly enabled." };
  }
  return { ok: true };
}

export function startInProcessMockWorker(env: Record<string, string | undefined> = process.env): {
  started: boolean;
  detail: string;
} {
  const gate = shouldStartInProcessMockWorker(env);
  if (!gate.ok) {
    return { started: false, detail: gate.reason };
  }
  console.info("ghost.worker.in_process", {
    mode: "MOCK_GENERATION",
    tickMs: WORKER_TICK_MS,
    maxTicks: WORKER_MAX_TICKS,
  });
  return {
    started: true,
    detail: "In-process MOCK worker armed. Dedicated process: npm run worker.",
  };
}
