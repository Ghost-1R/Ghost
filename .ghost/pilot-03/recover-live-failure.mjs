/**
 * Recover stuck Pilot 03 live failure on disposable ghost99f ONLY.
 * - No OpenAI calls, no new auth consume, no success fabrication.
 * - Transitions RUNNING → FAILED, agent QUEUED → CANCELLED.
 * - Places BILLING_UNCERTAIN hold (does not claim external $0).
 * - Leaves FAILED dispatch identity terminal.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { persistDurableRemoteStatus } from "../../src/lib/remote-development/durable-workflow.ts";
import { loadRemoteDevTaskById } from "../../src/lib/remote-development/queries.ts";
import { persistAgentTaskState, loadAgentTaskById } from "../../src/lib/agent-runtime/queries.ts";
import { appendRemoteDevReviewEvent } from "../../src/lib/remote-development/queries.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = new Map();
for (const raw of readFileSync(path.join(root, ".env.local"), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  const i = raw.indexOf("=");
  if (i > 0) env.set(raw.slice(0, i).trim(), raw.slice(i + 1).trim());
}

const url = env.get("NEXT_PUBLIC_SUPABASE_URL");
if (url !== "http://127.0.0.1:54331") throw new Error(`not ghost99f: ${url}`);
if (env.get("GHOST_CODEGEN_LIVE_ENABLED") === "1") {
  throw new Error("Refuse recovery while live flag is enabled — set GHOST_CODEGEN_LIVE_ENABLED=0 first.");
}

const dbPort = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost99f"], { encoding: "utf8" }))[0]
  ?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
if (dbPort !== "55432") throw new Error(`unexpected db port ${dbPort}`);

const TASK = "8bdfde20-2f66-4518-9aea-6e632001fe7f";
const AGENT = "ad000507-5915-4b15-b851-3b4b728071f8";
const AUTH = "5aee1635-62c3-4ab6-8237-060ee4bc1b16";
const OWNER = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const PROJECT = "f5397422-1c9d-4ef5-b639-8eee89981f5e";
const ORIG_RES = "32d915f5-5952-4e7b-b9af-899bf916488a";
const HOLD_KEY = `billing-uncertain-hold-${TASK}`;
const HOLD_IDEMP = `billing-uncertain-hold-${TASK}`;

const sb = createClient(url, env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const at = new Date().toISOString();

const beforeTask = await loadRemoteDevTaskById(sb, OWNER, TASK);
if (beforeTask.status !== "ok" || !beforeTask.data) throw new Error("task missing");
if (beforeTask.data.status !== "RUNNING" && beforeTask.data.status !== "FAILED") {
  throw new Error(`unexpected task status ${beforeTask.data.status}`);
}

const { data: dispatch } = await sb
  .from("codegen_provider_dispatches")
  .select("id,status,mode,detail,idempotency_key")
  .eq("remote_development_task_id", TASK)
  .eq("idempotency_key", `codegen-live-${TASK}`)
  .maybeSingle();
if (!dispatch || dispatch.status !== "FAILED" || dispatch.mode !== "LIVE_PROVIDER") {
  throw new Error("expected terminal FAILED LIVE_PROVIDER dispatch");
}

const { data: auth } = await sb
  .from("founder_action_authorizations")
  .select("id,status,use_count")
  .eq("id", AUTH)
  .maybeSingle();
if (auth?.status !== "CONSUMED" || Number(auth.use_count) !== 1) {
  throw new Error("authorization must remain CONSUMED uses=1");
}

// 1) Remote RUNNING → FAILED with LIVE failure evidence (legitimate transition helper)
if (beforeTask.data.status === "RUNNING") {
  const failed = await persistDurableRemoteStatus(sb, {
    ownerId: OWNER,
    remoteTaskId: TASK,
    toStatus: "FAILED",
    expectedStatus: "RUNNING",
    detail:
      "Recovery: LIVE_PROVIDER empty visible content after one OpenAI request. Dispatch remains FAILED. External billing UNCONFIRMED. No retry.",
    evidence: {
      repository: beforeTask.data.git.repository,
      baseCommitSha: beforeTask.data.git.baseCommitSha,
      taskBranch: beforeTask.data.git.taskBranch,
      commitSha: null,
      pullRequestRef: null,
      testResultsRef: null,
      artifactHashes: [],
      verificationState: "FAILED",
      providerClaimedAt: beforeTask.data.startedAt ?? at,
      independentlyCheckedAt: null,
      executionMode: "LIVE_PROVIDER",
    },
    lastError: {
      code: "EMPTY_PROVIDER_CONTENT",
      message:
        "OpenAI returned empty visible content after HTTP success. Token/finish metadata was not persisted at failure time. External billing unconfirmed. Do not retry this dispatch.",
      retryable: false,
      at,
    },
    at,
  });
  if (!failed.ok) throw new Error(`${failed.reason}: ${failed.message}`);
}

// 2) Agent QUEUED → CANCELLED
const agentLoaded = await loadAgentTaskById(sb, OWNER, AGENT);
if (agentLoaded.status !== "ok" || !agentLoaded.data) throw new Error("agent missing");
if (agentLoaded.data.status === "QUEUED" || agentLoaded.data.status === "CLAIMED" || agentLoaded.data.status === "RUNNING") {
  const cancelled = await persistAgentTaskState(sb, {
    ...agentLoaded.data,
    status: "CANCELLED",
    blockReason:
      "LIVE_PROVIDER aborted: empty visible content / billing uncertain. Authorization stays CONSUMED. No reuse.",
    completedAt: at,
    updatedAt: at,
    authorizationConsumed: true,
  });
  if (cancelled.status !== "ok") throw new Error(cancelled.message);
}

// 3) Audit event — do not erase original dispatch detail
await appendRemoteDevReviewEvent(sb, {
  ownerId: OWNER,
  projectId: PROJECT,
  remoteDevelopmentTaskId: TASK,
  agentTaskId: AGENT,
  authorizationId: AUTH,
  eventType: "CODEGEN_LIVE_BILLING_UNCERTAIN",
  detail: `BILLING_UNCERTAIN recovery audit. originalReservation=${ORIG_RES} was RELEASED after empty content; placing hold ${HOLD_KEY}. External OpenAI spend unconfirmed. dispatch=${dispatch.idempotency_key} remains FAILED terminal.`,
  scopeFingerprint: beforeTask.data.binding.scopeFingerprint,
});

// 4) Billing uncertain hold via docker SQL (service-role RPCs require auth.uid())
const sql = `
BEGIN;
-- Hold Pilot 03 allowance until founder reconciles external OpenAI usage.
INSERT INTO public.project_ai_allowance_reservations (
  id, project_id, owner_id, task_key, estimated_cents, status, idempotency_key, created_at
)
SELECT
  gen_random_uuid(),
  '${PROJECT}'::uuid,
  '${OWNER}'::uuid,
  '${HOLD_KEY}',
  100,
  'OPEN',
  '${HOLD_IDEMP}',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_ai_allowance_reservations
  WHERE owner_id = '${OWNER}'::uuid AND task_key = '${HOLD_KEY}' AND status = 'OPEN'
);

UPDATE public.project_ai_allowances a
SET reserved_cents = 100,
    updated_at = now()
WHERE a.project_id = '${PROJECT}'::uuid
  AND a.owner_id = '${OWNER}'::uuid
  AND EXISTS (
    SELECT 1 FROM public.project_ai_allowance_reservations r
    WHERE r.owner_id = a.owner_id AND r.task_key = '${HOLD_KEY}' AND r.status = 'OPEN'
  );

INSERT INTO public.project_ai_usage_events (
  project_id, owner_id, reservation_id, event_type, amount_cents, detail, idempotency_key
)
SELECT
  '${PROJECT}'::uuid,
  '${OWNER}'::uuid,
  r.id,
  'ALERT',
  100,
  'BILLING_UNCERTAIN_HOLD after empty LIVE OpenAI response; external spend unconfirmed; do not treat as $0',
  'usage-${HOLD_IDEMP}'
FROM public.project_ai_allowance_reservations r
WHERE r.owner_id = '${OWNER}'::uuid AND r.task_key = '${HOLD_KEY}' AND r.status = 'OPEN'
  AND NOT EXISTS (
    SELECT 1 FROM public.project_ai_usage_events e
    WHERE e.owner_id = '${OWNER}'::uuid AND e.idempotency_key = 'usage-${HOLD_IDEMP}'
  );

COMMIT;
`;

const sqlFile = path.join(root, ".ghost", "pilot-03", "evidence", "recover-billing-hold.sql");
mkdirSync(path.dirname(sqlFile), { recursive: true });
writeFileSync(sqlFile, sql, "utf8");

// Copy SQL into container and execute as postgres
execFileSync(
  "docker",
  ["cp", sqlFile, "supabase_db_ghost99f:/tmp/recover-billing-hold.sql"],
  { stdio: "inherit" },
);
const psqlOut = execFileSync(
  "docker",
  ["exec", "-i", "supabase_db_ghost99f", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "/tmp/recover-billing-hold.sql"],
  { encoding: "utf8" },
);

const { data: allowance } = await sb
  .from("project_ai_allowances")
  .select("allowance_cents,reserved_cents,charged_cents")
  .eq("project_id", PROJECT)
  .eq("owner_id", OWNER)
  .maybeSingle();
const { data: hold } = await sb
  .from("project_ai_allowance_reservations")
  .select("id,status,task_key,estimated_cents")
  .eq("task_key", HOLD_KEY)
  .eq("owner_id", OWNER)
  .maybeSingle();
const { data: agentAfter } = await sb
  .from("agent_tasks")
  .select("id,status,authorization_consumed,block_reason,completed_at")
  .eq("id", AGENT)
  .maybeSingle();
const afterTask = await loadRemoteDevTaskById(sb, OWNER, TASK);

const report = {
  LIVE_DISABLED: env.get("GHOST_CODEGEN_LIVE_ENABLED") !== "1",
  REMOTE_TASK_FINAL_STATUS: afterTask.status === "ok" ? afterTask.data?.status : "ERROR",
  AGENT_TASK_FINAL_STATUS: agentAfter?.status ?? null,
  AUTHORIZATION_USES: auth.use_count,
  AUTHORIZATION_STATUS: auth.status,
  DISPATCH_TERMINAL: dispatch.status === "FAILED",
  RESERVATION_ACCOUNTING: {
    originalReservation: ORIG_RES,
    originalStatus: "RELEASED",
    billingUncertainHold: hold,
    allowance,
  },
  EVIDENCE: {
    executionMode: afterTask.status === "ok" ? afterTask.data?.evidence?.executionMode : null,
    verificationState: afterTask.status === "ok" ? afterTask.data?.evidence?.verificationState : null,
    lastErrorCode: afterTask.status === "ok" ? afterTask.data?.lastError?.code : null,
  },
  psqlOut: psqlOut.slice(0, 500),
  at,
};

writeFileSync(
  path.join(root, ".ghost", "pilot-03", "evidence", "live-failure-recovery.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
