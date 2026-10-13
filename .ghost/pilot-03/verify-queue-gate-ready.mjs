/**
 * Read-only: prove founder Pilot 03 task would pass queue duration gate.
 * Does NOT call queueDurableDevelopmentTask / does not consume.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { gateRemoteDevQueue, elapsedMsSinceTaskCreated, elapsedMsSinceExecutionStart } from "../../src/lib/remote-development/authorization-gate.ts";
import { loadAuthorizationById } from "../../src/lib/approvals/queries.ts";
import { loadRemoteDevTaskById } from "../../src/lib/remote-development/queries.ts";

const env = new Map();
for (const raw of readFileSync(".env.local", "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  const i = raw.indexOf("=");
  if (i > 0) env.set(raw.slice(0, i).trim(), raw.slice(i + 1).trim());
}
const url = env.get("NEXT_PUBLIC_SUPABASE_URL");
if (url !== "http://127.0.0.1:54331") throw new Error(`not ghost99f: ${url}`);
if (env.get("GHOST_CODEGEN_LIVE_ENABLED") === "1") throw new Error("live flag must stay off");

const TASK = "8bdfde20-2f66-4518-9aea-6e632001fe7f";
const AUTH = "5aee1635-62c3-4ab6-8237-060ee4bc1b16";
const OWNER = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const FP = "c98ad5b97432d22a9600990dc664fa43b52a8d24a3932015ee82cf88475fcf71";

const sb = createClient(url, env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const taskLoaded = await loadRemoteDevTaskById(sb, OWNER, TASK);
const authLoaded = await loadAuthorizationById(sb, OWNER, AUTH);
if (taskLoaded.status !== "ok") throw new Error(taskLoaded.message);
if (authLoaded.status !== "ok") throw new Error(authLoaded.message);

const task = taskLoaded.data;
const auth = authLoaded.data;
const at = new Date().toISOString();
const createAge = elapsedMsSinceTaskCreated(task, at);
const execAge = elapsedMsSinceExecutionStart(task, at);
const gate = gateRemoteDevQueue(auth, task, {
  at,
  estimatedCostUsd: task.spending.maxEstimatedCostUsd,
});

const { count } = await sb
  .from("codegen_provider_dispatches")
  .select("id", { count: "exact", head: true })
  .eq("remote_development_task_id", TASK);

const expired = Date.parse(auth.expiresAt) <= Date.now();

console.log(
  JSON.stringify(
    {
      TASK_STATUS: task.status,
      AUTHORIZATION_STATUS: auth.status,
      USE_COUNT: auth.useCount,
      EXPIRATION_STATUS: expired ? "EXPIRED" : "VALID",
      expiresAt: auth.expiresAt,
      fingerprintMatch: task.binding.scopeFingerprint === FP && auth.scopeFingerprint === FP,
      createAgeMs: createAge,
      createAgeHours: createAge / 3_600_000,
      maxDurationMs: task.duration.maxDurationMs,
      execAgeMs: execAge,
      queuedAt: task.queuedAt,
      dispatchCount: count ?? 0,
      GATE_OK: gate.ok,
      GATE_REASON: gate.ok ? null : gate.reason,
      GATE_MESSAGE: gate.ok ? null : gate.message,
      READY_FOR_FOUNDER_QUEUE:
        gate.ok &&
        !expired &&
        auth.status === "APPROVED" &&
        auth.useCount === 0 &&
        task.status === "AWAITING_APPROVAL" &&
        !task.queuedAt &&
        (count ?? 0) === 0,
      NOTE: "No queue/consume performed",
    },
    null,
    2,
  ),
);
