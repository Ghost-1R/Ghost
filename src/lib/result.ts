import type { PostgrestError } from "@supabase/supabase-js";

export type QueryResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

export function fromError(error: PostgrestError): QueryResult<never> {
  return { status: "error", message: error.message };
}
