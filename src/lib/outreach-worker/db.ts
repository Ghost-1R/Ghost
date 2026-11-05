import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function outreachServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Outreach worker.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Process may run ticks. Live provider sends still require config.live_enabled. */
export function outreachEnvEnabled(): boolean {
  return process.env.GHOST_OUTREACH_ENABLED?.trim() === "1";
}

export function outreachWorkerSecret(): string {
  return process.env.GHOST_OUTREACH_WORKER_SECRET?.trim() || "";
}

export function outreachProviderFromEnv(): "fake" | "ses" {
  const raw = (process.env.GHOST_OUTREACH_PROVIDER ?? "fake").trim().toLowerCase();
  return raw === "ses" ? "ses" : "fake";
}

/** Optional override for SES sandbox allowlist (also stored on config). */
export function outreachSesSandboxToFromEnv(): string {
  return (process.env.GHOST_OUTREACH_SES_SANDBOX_TO ?? "").trim().toLowerCase();
}
