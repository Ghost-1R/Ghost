/**
 * Dedicated Will/Bubba lead-finder process (browser-closed).
 * Start: npm run lead-workers
 *
 * Required:
 * - GHOST_LEAD_WORKERS_ENABLED=1
 * - ceo_lead_worker_config.enabled = true
 * - BRAVE_SEARCH_API_KEY
 * - SUPABASE service role
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { runLeadWorkerTick } from "./tick";

/** Load .env.local into process.env without overriding already-set vars. Never logs values. */
function loadLocalEnvFile(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

const TICK_MS = Number(process.env.GHOST_LEAD_WORKER_TICK_MS ?? 60_000);

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main(): Promise<void> {
  if (isCodegenLiveEnabled()) {
    console.error("ghost.lead.workers.refused LIVE=1");
    process.exit(2);
  }
  const supabase = serviceClient();
  console.info("ghost.lead.workers.loop", {
    tickMs: TICK_MS,
    enabledEnv: process.env.GHOST_LEAD_WORKERS_ENABLED?.trim() === "1",
  });
  for (;;) {
    try {
      const tick = await runLeadWorkerTick(supabase, { trigger: "schedule" });
      console.info("ghost.lead.workers.tick", tick);
    } catch (error) {
      console.error("ghost.lead.workers.tick_error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Number.isFinite(TICK_MS) ? TICK_MS : 60_000),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
