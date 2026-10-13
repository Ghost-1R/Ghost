import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = new Map();
for (const raw of readFileSync(".env.local", "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  const i = raw.indexOf("=");
  if (i > 0) env.set(raw.slice(0, i).trim(), raw.slice(i + 1).trim());
}
if (env.get("NEXT_PUBLIC_SUPABASE_URL") !== "http://127.0.0.1:54331") throw new Error("not ghost99f");
if (env.get("GHOST_CODEGEN_LIVE_ENABLED") === "1") throw new Error("live must be off");

const TASK = "8bdfde20-2f66-4518-9aea-6e632001fe7f";
const AUTH = "5aee1635-62c3-4ab6-8237-060ee4bc1b16";
const AGENT = "ad000507-5915-4b15-b851-3b4b728071f8";
const OWNER = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const PROJECT = "f5397422-1c9d-4ef5-b639-8eee89981f5e";

const sb = createClient(env.get("NEXT_PUBLIC_SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: task } = await sb
  .from("remote_development_tasks")
  .select("id,status,evidence,last_error")
  .eq("id", TASK)
  .maybeSingle();
const { data: auth } = await sb
  .from("founder_action_authorizations")
  .select("id,status,use_count")
  .eq("id", AUTH)
  .maybeSingle();
const { data: agent } = await sb
  .from("agent_tasks")
  .select("id,status,authorization_consumed")
  .eq("id", AGENT)
  .maybeSingle();
const { data: dispatches } = await sb
  .from("codegen_provider_dispatches")
  .select("status,mode,idempotency_key")
  .eq("remote_development_task_id", TASK);
const { data: allowance } = await sb
  .from("project_ai_allowances")
  .select("allowance_cents,reserved_cents,charged_cents")
  .eq("project_id", PROJECT)
  .eq("owner_id", OWNER)
  .maybeSingle();
const available =
  Number(allowance?.allowance_cents ?? 0) -
  Number(allowance?.reserved_cents ?? 0) -
  Number(allowance?.charged_cents ?? 0);

const ok =
  task?.status === "FAILED" &&
  agent?.status === "CANCELLED" &&
  auth?.status === "CONSUMED" &&
  Number(auth?.use_count) === 1 &&
  (dispatches ?? []).every((d) => d.mode !== "LIVE_PROVIDER" || d.status === "FAILED") &&
  Number(allowance?.charged_cents) === 1 &&
  available === 99;

console.log(
  JSON.stringify(
    {
      ok,
      task: task?.status,
      agent: agent?.status,
      auth: `${auth?.status}/uses=${auth?.use_count}`,
      dispatches,
      allowance,
      available,
      evidenceMode: task?.evidence?.executionMode ?? task?.evidence?.execution_mode,
      lastError: task?.last_error?.code ?? null,
    },
    null,
    2,
  ),
);
if (!ok) process.exit(2);
