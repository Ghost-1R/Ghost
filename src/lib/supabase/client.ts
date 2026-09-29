import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";

export function createSupabaseBrowserClient(): SupabaseClient<Database> | null {
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }

  return createBrowserClient<Database>(env.url, env.publishableKey);
}
