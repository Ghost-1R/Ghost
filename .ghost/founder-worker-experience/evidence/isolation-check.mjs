import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const svc = env.GHOST_AGENT_RUNTIME_SERVICE_KEY;
const admin = createClient(url, svc, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `isolation-d-${Math.floor(Math.random() * 1e6)}@ghost.local`;
const password = "IsoTest-Pass-4242";
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (created.error) throw created.error;

const user = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const signed = await user.auth.signInWithPassword({ email, password });
if (signed.error) throw signed.error;
const token = signed.data.session.access_token;
const authed = createClient(url, anon, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

const taskId = "a1d3acfb-a768-4cb6-b746-b28ce5a690dd";
const task = await authed.from("agent_tasks").select("id,status").eq("id", taskId);
const arts = await authed
  .from("agent_review_artifacts")
  .select("id")
  .eq("task_id", taskId);
const patch = await authed
  .from("agent_tasks")
  .update({ status: "CANCELLED" })
  .eq("id", taskId)
  .select("id,status");

const out = {
  email,
  userId: created.data.user.id,
  taskRows: (task.data || []).length,
  artifactRows: (arts.data || []).length,
  patchRows: (patch.data || []).length,
  taskError: task.error?.message || null,
  patchError: patch.error?.message || null,
};
writeFileSync(
  ".ghost/founder-worker-experience/evidence/isolation-second-user.json",
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out));
