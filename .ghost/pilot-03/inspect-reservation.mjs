import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = new Map();
for (const raw of readFileSync(".env.local", "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  const i = raw.indexOf("=");
  if (i > 0) env.set(raw.slice(0, i).trim(), raw.slice(i + 1).trim());
}
const sb = createClient(env.get("NEXT_PUBLIC_SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rid = "32d915f5-5952-4e7b-b9af-899bf916488a";
const { data: res, error: re } = await sb.from("project_ai_allowance_reservations").select("*").eq("id", rid).maybeSingle();
const { data: agent, error: ae } = await sb
  .from("agent_tasks")
  .select(
    "id,status,authorization_consumed,updated_at,block_reason,claimed_at,completed_at,checkpoint_sequence,last_checkpoint_id",
  )
  .eq("id", "ad000507-5915-4b15-b851-3b4b728071f8")
  .maybeSingle();
const { data: allRes } = await sb
  .from("project_ai_allowance_reservations")
  .select("id,status,task_key,estimated_cents,actual_cents,created_at,updated_at")
  .eq("project_id", "f5397422-1c9d-4ef5-b639-8eee89981f5e")
  .order("created_at", { ascending: false })
  .limit(20);
const { data: allowance } = await sb
  .from("project_ai_allowances")
  .select("*")
  .eq("project_id", "f5397422-1c9d-4ef5-b639-8eee89981f5e")
  .eq("owner_id", "adcc741f-1570-472f-9bf4-ef44028f57fc")
  .maybeSingle();

function scrub(row) {
  if (!row) return null;
  const out = { ...row };
  // never print secrets; none expected in these rows
  return out;
}

console.log(
  JSON.stringify(
    {
      reservationError: re?.message ?? null,
      reservation: scrub(res),
      agentError: ae?.message ?? null,
      agent: scrub(agent),
      projectReservations: allRes ?? [],
      allowance,
    },
    null,
    2,
  ),
);
