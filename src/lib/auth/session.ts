import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

export type GhostClient = SupabaseClient<Database>;

export type AuthenticatedUser = {
  id: string;
  email: string | null;
};

export type SessionResult =
  | { status: "unconfigured" }
  | { status: "anonymous" }
  | { status: "authenticated"; supabase: GhostClient; user: AuthenticatedUser };

export const getSession = cache(async (): Promise<SessionResult> => {
  if (!getSupabaseEnv()) {
    return { status: "unconfigured" };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "unconfigured" };
  }

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) {
    return { status: "anonymous" };
  }

  return {
    status: "authenticated",
    supabase,
    user: {
      id: data.claims.sub,
      email: data.claims.email ?? null,
    },
  };
});
