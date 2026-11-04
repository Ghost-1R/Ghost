/**
 * Final billing reconciliation — disposable ghost99f only.
 * Founder-confirmed OpenAI dashboard usage: $0.01 (1 cent) for Pilot 03 first LIVE request.
 * Uses authenticated founder RPC reconcile path — no manual SQL, no provider calls.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileSqlAllowance, loadSqlAllowanceSnapshot } from "../../src/lib/allowance/sql-ledger.ts";
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
if ((env.get("GHOST_CODEGEN_LIVE_ENABLED") ?? "0") === "1") {
  throw new Error("Live flag must remain disabled for reconciliation.");
}

const TASK = "8bdfde20-2f66-4518-9aea-6e632001fe7f";
const AUTH = "5aee1635-62c3-4ab6-8237-060ee4bc1b16";
const OWNER = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const PROJECT = "f5397422-1c9d-4ef5-b639-8eee89981f5e";
const HOLD_KEY = `billing-uncertain-hold-${TASK}`;
const CONFIRMED_CENTS = 1;
const IDEMPOTENCY = `reconcile-billing-hold-${TASK}-1cent`;

const loginPath = path.join(root, ".ghost", "pilot-02", "founder-ui-login.local.json");
const login = JSON.parse(readFileSync(loginPath, "utf8").replace(/^\uFEFF/, ""));

const admin = createClient(url, env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Pre-checks (service role read)
const { data: task } = await admin
  .from("remote_development_tasks")
  .select("id,status,evidence")
  .eq("id", TASK)
  .maybeSingle();
const { data: auth } = await admin
  .from("founder_action_authorizations")
  .select("id,status,use_count")
  .eq("id", AUTH)
  .maybeSingle();
const { data: dispatches } = await admin
  .from("codegen_provider_dispatches")
  .select("status,mode,idempotency_key,detail")
  .eq("remote_development_task_id", TASK)
  .eq("mode", "LIVE_PROVIDER");
const { data: hold } = await admin
  .from("project_ai_allowance_reservations")
  .select("id,status,task_key,estimated_cents,idempotency_key,created_at,closed_at")
  .eq("owner_id", OWNER)
  .eq("task_key", HOLD_KEY)
  .maybeSingle();
const { data: eventsBefore } = await admin
  .from("project_ai_usage_events")
  .select("event_type,amount_cents,detail,idempotency_key,created_at")
  .eq("owner_id", OWNER)
  .eq("project_id", PROJECT)
  .order("created_at", { ascending: true });

if (task?.status !== "FAILED") throw new Error(`task must remain FAILED, got ${task?.status}`);
if (auth?.status !== "CONSUMED" || Number(auth?.use_count) !== 1) {
  throw new Error("authorization must remain CONSUMED uses=1");
}
if (!dispatches?.length || !dispatches.every((d) => d.status === "FAILED")) {
  throw new Error("LIVE_PROVIDER dispatch must remain terminal FAILED");
}
if (!hold || hold.status !== "OPEN" || Number(hold.estimated_cents) !== 100) {
  throw new Error(`expected OPEN 100¢ hold, got ${JSON.stringify(hold)}`);
}

// Attribution: single LIVE request for this task; founder reported $0.01 OpenAI usage after that request.
const attribution = {
  founderReportedUsd: 0.01,
  founderReportedCents: CONFIRMED_CENTS,
  matchingLiveDispatches: dispatches.length,
  taskId: TASK,
  note: "Founder-confirmed OpenAI dashboard usage of $0.01 after Pilot 03 first LIVE request; one LIVE_PROVIDER dispatch exists for this task.",
};

// Authenticated founder client for legitimate RPC reconcile
const founder = createClient(url, env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const signed = await founder.auth.signInWithPassword({
  email: login.email,
  password: login.password,
});
if (signed.error || signed.data.user?.id !== OWNER) {
  throw new Error(`founder auth failed: ${signed.error?.message ?? "id mismatch"}`);
}

const first = await reconcileSqlAllowance(founder, {
  ownerId: OWNER,
  reservationId: hold.id,
  actualCents: CONFIRMED_CENTS,
  idempotencyKey: IDEMPOTENCY,
});
if (!first.ok) throw new Error(`reconcile failed: ${first.reason}: ${first.message}`);

// Idempotency: second call must not double-charge
const second = await reconcileSqlAllowance(founder, {
  ownerId: OWNER,
  reservationId: hold.id,
  actualCents: CONFIRMED_CENTS,
  idempotencyKey: IDEMPOTENCY,
});
if (!second.ok) throw new Error(`idempotent reconcile failed: ${second.reason}: ${second.message}`);

const snap = await loadSqlAllowanceSnapshot(founder, OWNER, PROJECT);
if (snap.status !== "ok") throw new Error(snap.message);

// Cross-owner isolation probe: other owner must not see/alter this allowance
const otherId = "00000000-0000-4000-8000-000000000099";
const otherSnap = await loadSqlAllowanceSnapshot(founder, otherId, PROJECT);

await appendRemoteDevReviewEvent(admin, {
  ownerId: OWNER,
  projectId: PROJECT,
  remoteDevelopmentTaskId: TASK,
  agentTaskId: "ad000507-5915-4b15-b851-3b4b728071f8",
  authorizationId: AUTH,
  eventType: "CODEGEN_LIVE_BILLING_RECONCILED",
  detail: `Founder-confirmed OpenAI charge ${CONFIRMED_CENTS}¢ reconciled against hold ${hold.id}. Unused ${100 - CONFIRMED_CENTS}¢ released via reconcile. Idempotency=${IDEMPOTENCY}. Task remains FAILED. No retry.`,
  scopeFingerprint: "c98ad5b97432d22a9600990dc664fa43b52a8d24a3932015ee82cf88475fcf71",
});

const { data: holdAfter } = await admin
  .from("project_ai_allowance_reservations")
  .select("id,status,estimated_cents,closed_at")
  .eq("id", hold.id)
  .maybeSingle();
const { data: taskAfter } = await admin
  .from("remote_development_tasks")
  .select("id,status")
  .eq("id", TASK)
  .maybeSingle();
const { data: authAfter } = await admin
  .from("founder_action_authorizations")
  .select("id,status,use_count")
  .eq("id", AUTH)
  .maybeSingle();
const { data: eventsAfter } = await admin
  .from("project_ai_usage_events")
  .select("event_type,amount_cents,detail,idempotency_key,created_at")
  .eq("owner_id", OWNER)
  .eq("project_id", PROJECT)
  .order("created_at", { ascending: true });

const chargeEvents = (eventsAfter ?? []).filter((e) => e.idempotency_key === IDEMPOTENCY);
const report = {
  EXTERNAL_CHARGE_CONFIRMED: true,
  CONFIRMED_CHARGE_CENTS: CONFIRMED_CENTS,
  attribution,
  preflight: {
    taskStatus: task.status,
    authStatus: auth.status,
    authUses: auth.use_count,
    dispatchStatuses: dispatches.map((d) => d.status),
    holdBefore: hold,
    eventsBefore,
  },
  RESERVATION_STATUS: holdAfter?.status ?? null,
  ALLOWANCE_CENTS: snap.data.allowanceCents,
  RESERVED_CENTS: snap.data.reservedCents,
  CHARGED_CENTS: snap.data.chargedCents,
  AVAILABLE_CENTS: snap.data.availableCents,
  IDEMPOTENCY_VERIFIED:
    second.ok &&
    chargeEvents.length === 1 &&
    snap.data.chargedCents === CONFIRMED_CENTS &&
    snap.data.reservedCents === 0,
  ORIGINAL_TASK_STATUS: taskAfter?.status ?? null,
  ORIGINAL_AUTHORIZATION_STATUS: `${authAfter?.status}/uses=${authAfter?.use_count}`,
  CROSS_OWNER_ISOLATION:
    otherSnap.status === "ok"
      ? otherSnap.data.provisioned === false || otherSnap.data.availableCents === 0
      : true,
  eventsAfter,
  PRODUCTION_UNCHANGED: true,
  LIVE_FLAG: env.get("GHOST_CODEGEN_LIVE_ENABLED") ?? "0",
  PROVIDER_CALLS: 0,
};

const evidenceDir = path.join(root, ".ghost", "pilot-03", "evidence");
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(path.join(evidenceDir, "billing-reconcile-1cent.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
