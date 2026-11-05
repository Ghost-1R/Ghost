/**
 * Dedicated Outreach email worker (browser-closed).
 * Start: npm run outreach-workers
 *
 * Required for ticks:
 * - GHOST_OUTREACH_ENABLED=1
 * - ceo_outreach_config.live_enabled = true (starts false)
 * - Verified sender + reply-to + postal address
 * - SUPABASE service role
 *
 * Provider: GHOST_OUTREACH_PROVIDER=fake|ses (default fake). Live SES needs AWS keys.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { runOutreachTick } from "./tick";

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

const TICK_MS = Number(process.env.GHOST_OUTREACH_TICK_MS ?? 60_000);

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
    console.error("ghost.outreach.workers.refused LIVE=1");
    process.exit(2);
  }
  const supabase = serviceClient();
  console.info("ghost.outreach.workers.loop", {
    tickMs: TICK_MS,
    enabledEnv: process.env.GHOST_OUTREACH_ENABLED?.trim() === "1",
    provider: process.env.GHOST_OUTREACH_PROVIDER?.trim() || "fake",
  });
  for (;;) {
    try {
      const tick = await runOutreachTick(supabase, { trigger: "schedule" });
      console.info("ghost.outreach.workers.tick", tick);
    } catch (error) {
      console.error("ghost.outreach.workers.tick_error", {
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
