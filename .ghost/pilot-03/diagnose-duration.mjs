import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = new Map();
for (const raw of readFileSync(".env.local", "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  const i = raw.indexOf("=");
  if (i > 0) env.set(raw.slice(0, i).trim(), raw.slice(i + 1).trim());
}
const url = env.get("NEXT_PUBLIC_SUPABASE_URL");
if (url !== "http://127.0.0.1:54331") throw new Error(`not ghost99f: ${url}`);
const sb = createClient(url, env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const TASK = "8bdfde20-2f66-4518-9aea-6e632001fe7f";
const AUTH = "5aee1635-62c3-4ab6-8237-060ee4bc1b16";
const { data: t, error: te } = await sb
  .from("remote_development_tasks")
  .select(
    "id,status,created_at,queued_at,started_at,updated_at,completed_at,max_duration_ms,authorization_id,scope_fingerprint,owner_id,project_id",
  )
  .eq("id", TASK)
  .maybeSingle();
const { data: a, error: ae } = await sb
  .from("founder_action_authorizations")
  .select(
    "id,status,expires_at,use_count,reuse_policy,created_at,updated_at,scope_fingerprint,environment_label",
  )
  .eq("id", AUTH)
  .maybeSingle();
const { count } = await sb
  .from("codegen_provider_dispatches")
  .select("id", { count: "exact", head: true })
  .eq("remote_development_task_id", TASK);
const now = Date.now();
const created = t ? Date.parse(t.created_at) : NaN;
const expires = a ? Date.parse(a.expires_at) : NaN;
console.log(
  JSON.stringify(
    {
      url,
      taskError: te?.message ?? null,
      authError: ae?.message ?? null,
      task: t,
      auth: a,
      dispatchCount: count ?? 0,
      nowIso: new Date(now).toISOString(),
      elapsedSinceCreateMs: Number.isFinite(created) ? now - created : null,
      elapsedSinceCreateHours: Number.isFinite(created) ? (now - created) / 3_600_000 : null,
      authExpired: Number.isFinite(expires) ? expires <= now : null,
      authExpiresInHours: Number.isFinite(expires) ? (expires - now) / 3_600_000 : null,
      exceedsMaxIfFromCreate:
        Number.isFinite(created) && t?.max_duration_ms != null
          ? now - created > Number(t.max_duration_ms)
          : null,
    },
    null,
    2,
  ),
);
