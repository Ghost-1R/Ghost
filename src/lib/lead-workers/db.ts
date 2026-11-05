import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function leadWorkerServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for lead workers.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function leadWorkersEnvEnabled(): boolean {
  return process.env.GHOST_LEAD_WORKERS_ENABLED?.trim() === "1";
}

export function leadWorkersSecret(): string {
  return process.env.GHOST_LEAD_WORKER_SECRET?.trim() || "";
}
