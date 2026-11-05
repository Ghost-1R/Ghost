/**
 * Dedicated worker entrypoint.
 * Start: npm run worker
 *
 * When GHOST_UNDERWORLD_SHIFTS=1, runs the Underworld shift claim loop
 * (Mon–Fri 09:00–17:00 America/New_York by default) using the service role.
 * When GHOST_LEAD_WORKERS=1 (and GHOST_LEAD_WORKERS_ENABLED=1), runs Will/Bubba
 * Opportunity Radar lead-finder ticks (hourly, America/New_York day/night).
 * Continues with the browser closed. Refuses LIVE=1.
 */

import { createClient } from "@supabase/supabase-js";
import { isCodegenLiveEnabled } from "../codegen/provider-config";
import { shouldStartInProcessMockWorker } from "./in-process-worker";
import { runLeadWorkerTick } from "../lead-workers/tick";
import { runUnderworldShiftTick } from "../underworld-shifts/runner";

const SHIFT_FLAG = "GHOST_UNDERWORLD_SHIFTS";
const LEAD_FLAG = "GHOST_LEAD_WORKERS";
const TICK_MS = Number(process.env.GHOST_UNDERWORLD_SHIFT_TICK_MS ?? 15_000);
const LEAD_TICK_MS = Number(process.env.GHOST_LEAD_WORKER_TICK_MS ?? 60_000);

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the shift worker.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function runShiftLoop(): Promise<void> {
  const supabase = serviceClient();
  const forceWithinShift = process.env.GHOST_UNDERWORLD_SHIFT_FORCE?.trim() === "1";
  console.info("ghost.underworld.shift.worker", {
    mode: "SHIFT_RUNNER",
    tickMs: TICK_MS,
    forceWithinShift,
    liveHttp: false,
  });

  for (;;) {
    if (isCodegenLiveEnabled()) {
      console.error("ghost.underworld.shift.refused LIVE=1");
      process.exit(2);
    }
    try {
      const tick = await runUnderworldShiftTick(supabase, { forceWithinShift });
      console.info("ghost.underworld.shift.tick", tick);
    } catch (error) {
      console.error("ghost.underworld.shift.tick_error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(TICK_MS) ? TICK_MS : 15_000));
  }
}

async function runLeadWorkerLoop(): Promise<void> {
  const supabase = serviceClient();
  console.info("ghost.lead.workers.loop", {
    mode: "LEAD_FINDER",
    tickMs: LEAD_TICK_MS,
    enabledEnv: process.env.GHOST_LEAD_WORKERS_ENABLED?.trim() === "1",
  });
  for (;;) {
    if (isCodegenLiveEnabled()) {
      console.error("ghost.lead.workers.refused LIVE=1");
      process.exit(2);
    }
    try {
      const tick = await runLeadWorkerTick(supabase, { trigger: "schedule" });
      console.info("ghost.lead.workers.tick", tick);
    } catch (error) {
      console.error("ghost.lead.workers.tick_error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Number.isFinite(LEAD_TICK_MS) ? LEAD_TICK_MS : 60_000),
    );
  }
}

async function main(): Promise<void> {
  if (isCodegenLiveEnabled()) {
    console.error("ghost.worker.refused LIVE=1 — no paid dispatch from this process.");
    process.exit(2);
  }

  if (process.env[LEAD_FLAG]?.trim() === "1") {
    await runLeadWorkerLoop();
    return;
  }

  if (process.env[SHIFT_FLAG]?.trim() === "1") {
    await runShiftLoop();
    return;
  }

  const gate = shouldStartInProcessMockWorker({
    ...process.env,
    GHOST_WORKER_IN_PROCESS: process.env.GHOST_WORKER_IN_PROCESS ?? "1",
  });
  if (!gate.ok && process.env.GHOST_WORKER_IN_PROCESS?.trim() !== "1") {
    console.info("ghost.worker.cli", {
      mode: "MOCK_GENERATION",
      detail:
        "Standalone worker ready. Set GHOST_LEAD_WORKERS=1 or GHOST_UNDERWORLD_SHIFTS=1 for background runners.",
    });
    return;
  }
  console.info("ghost.worker.cli", {
    mode: "MOCK_GENERATION",
    liveHttp: false,
    instruction:
      "Claim is demand-driven from the worker workspace MOCK step, or enable GHOST_LEAD_WORKERS=1 / GHOST_UNDERWORLD_SHIFTS=1.",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
