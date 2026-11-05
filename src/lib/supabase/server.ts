import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";

export async function createSupabaseServerClient(
  onCookiesWritten?: (names: string[]) => void,
): Promise<SupabaseClient<Database> | null> {
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
          onCookiesWritten?.(cookiesToSet.filter(({ value }) => value).map(({ name }) => name));
        } catch {
          // Server Components cannot write cookies. src/proxy.ts refreshes the session.
        }
      },
    },
  });
}
