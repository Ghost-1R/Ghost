/**
 * Inspect first live execution — READ ONLY. No retry/resend/mutate.
 * Never prints secrets or generated file contents.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const env = new Map();
for (const raw of readFileSync(".env.local", "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  const i = raw.indexOf("=");
  if (i > 0) env.set(raw.slice(0, i).trim(), raw.slice(i + 1).trim());
}
const url = env.get("NEXT_PUBLIC_SUPABASE_URL");
if (url !== "http://127.0.0.1:54331") throw new Error(`not ghost99f: ${url}`);

const TASK = "8bdfde20-2f66-4518-9aea-6e632001fe7f";
const AUTH = "5aee1635-62c3-4ab6-8237-060ee4bc1b16";
const AGENT = "ad000507-5915-4b15-b851-3b4b728071f8";
const OWNER = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const PROJECT = "f5397422-1c9d-4ef5-b639-8eee89981f5e";

const sb = createClient(url, env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: task } = await sb
  .from("remote_development_tasks")
  .select(
    "id,status,agent_task_id,authorization_id,queued_at,started_at,completed_at,updated_at,last_error,evidence,external_job_id",
  )
  .eq("id", TASK)
  .maybeSingle();

const { data: auth } = await sb
  .from("founder_action_authorizations")
  .select("id,status,use_count,consumed_at,expires_at")
  .eq("id", AUTH)
  .maybeSingle();

const { data: agent } = await sb
  .from("agent_tasks")
  .select(
    "id,status,authorization_consumed,claimed_at,started_at,completed_at,updated_at,block_reason,last_checkpoint_id,checkpoint_sequence",
  )
  .eq("id", AGENT)
  .maybeSingle();

const { data: dispatches } = await sb
  .from("codegen_provider_dispatches")
  .select(
    "id,status,mode,provider_id,model,reservation_id,idempotency_key,detail,created_at,updated_at",
  )
  .eq("remote_development_task_id", TASK)
  .order("created_at", { ascending: true });

const { data: reservations } = await sb
  .from("project_ai_allowance_reservations")
  .select(
    "id,status,task_key,estimated_cents,actual_cents,idempotency_key,created_at,updated_at,reconciled_at,released_at",
  )
  .eq("owner_id", OWNER)
  .eq("project_id", PROJECT)
  .or(`task_key.eq.codegen-live-${TASK},idempotency_key.ilike.%codegen-live-${TASK}%`)
  .order("created_at", { ascending: true });

// Broader reservation search if none via task_key pattern
const { data: allRes } = await sb
  .from("project_ai_allowance_reservations")
  .select(
    "id,status,task_key,estimated_cents,actual_cents,idempotency_key,created_at,updated_at",
  )
  .eq("owner_id", OWNER)
  .eq("project_id", PROJECT)
  .order("created_at", { ascending: false })
  .limit(20);

const { data: allowance } = await sb
  .from("project_ai_allowances")
  .select("allowance_cents,reserved_cents,charged_cents,updated_at")
  .eq("owner_id", OWNER)
  .eq("project_id", PROJECT)
  .maybeSingle();

const { data: events } = await sb
  .from("remote_development_review_events")
  .select("id,event_type,detail,created_at")
  .eq("remote_development_task_id", TASK)
  .order("created_at", { ascending: true });

const { data: checkpoints } = await sb
  .from("agent_task_checkpoints")
  .select("id,sequence,label,progress_ref,created_at")
  .eq("task_id", AGENT)
  .order("sequence", { ascending: true });

const evidence = task?.evidence;
const evidenceMeta = evidence
  ? {
      hasEvidence: true,
      verificationState: evidence.verificationState ?? evidence.verification_state ?? null,
      executionMode: evidence.executionMode ?? evidence.execution_mode ?? null,
      artifactHashCount: Array.isArray(evidence.artifactHashes ?? evidence.artifact_hashes)
        ? (evidence.artifactHashes ?? evidence.artifact_hashes).length
        : 0,
      testResultsRef: evidence.testResultsRef ?? evidence.test_results_ref ?? null,
      // never dump content
    }
  : { hasEvidence: false };

const liveDispatches = (dispatches ?? []).filter((d) => d.mode === "LIVE_PROVIDER");
const mockDispatches = (dispatches ?? []).filter((d) => d.mode === "MOCK_GENERATION");
const openRes = (allRes ?? []).filter((r) => r.status === "OPEN" || r.status === "RESERVED");
const uncertain = (dispatches ?? []).some(
  (d) => /UNCERTAIN_BILLING|STARTED/.test(`${d.status} ${d.detail ?? ""}`),
);

const updatedMs = task?.updated_at ? Date.parse(task.updated_at) : NaN;
const stuckMinutes =
  task?.status === "RUNNING" && Number.isFinite(updatedMs)
    ? (Date.now() - updatedMs) / 60_000
    : null;

let openaiInvokedInLogs = false;
let openaiUsageInLogs = false;
let liveDisabledInLogs = false;
let lastLogHits = [];
const terminalsDir = path.join(
  process.env.USERPROFILE ?? "",
  ".cursor",
  "projects",
  "c-Users-Badge-Documents-ghost",
  "terminals",
);
if (existsSync(terminalsDir)) {
  for (const name of readdirSync(terminalsDir).filter((n) => n.endsWith(".txt"))) {
    const text = readFileSync(path.join(terminalsDir, name), "utf8");
    if (!text.includes("3012") && !text.includes("ghost.codegen") && !text.includes("LIVE")) continue;
    if (/ghost\.codegen\.openai\.invoke/.test(text)) openaiInvokedInLogs = true;
    if (/ghost\.codegen\.openai\.usage/.test(text)) openaiUsageInLogs = true;
    if (/LIVE_DISABLED|live flag/i.test(text)) liveDisabledInLogs = true;
    const lines = text.split(/\r?\n/).filter((l) =>
      /ghost\.codegen|LIVE_|DURATION_EXCEEDED|DISPATCH|UNCERTAIN|openai|codegen-live/i.test(l),
    );
    for (const l of lines.slice(-15)) {
      // redact anything that looks like a key
      lastLogHits.push(
        l
          .replace(/sk-[A-Za-z0-9_\-]+/g, "[REDACTED_KEY]")
          .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
          .slice(0, 240),
      );
    }
  }
}

const available =
  Number(allowance?.allowance_cents ?? 0) -
  Number(allowance?.reserved_cents ?? 0) -
  Number(allowance?.charged_cents ?? 0);

const assessment = {
  realOpenAiRequestSent:
    liveDispatches.some((d) => ["STARTED", "SUCCEEDED", "FAILED"].includes(d.status)) ||
    openaiInvokedInLogs,
  providerRespondedWithUsage: openaiUsageInLogs || liveDispatches.some((d) => /chargedCents|usage/i.test(d.detail ?? "")),
  codeMaterialized: evidenceMeta.artifactHashCount > 0,
  dockerStartedOrFinished: /dockerPassed|DOCKER/i.test(
    JSON.stringify(dispatches ?? []) + JSON.stringify(events ?? []),
  ),
  allowanceReserved: Number(allowance?.reserved_cents ?? 0) > 0 || openRes.length > 0,
  allowanceReconciled: (allRes ?? []).some((r) => r.status === "RECONCILED"),
  stillRunning: task?.status === "RUNNING",
  mockLabelStale:
    task?.status === "RUNNING" &&
    liveDispatches.length > 0 &&
    !evidenceMeta.executionMode,
  billingUncertain: uncertain,
};

console.log(
  JSON.stringify(
    {
      isolationUrl: url,
      liveFlag: env.get("GHOST_CODEGEN_LIVE_ENABLED"),
      task: {
        status: task?.status,
        queuedAt: task?.queued_at,
        startedAt: task?.started_at,
        completedAt: task?.completed_at,
        updatedAt: task?.updated_at,
        stuckMinutes,
        lastErrorCode: task?.last_error?.code ?? null,
        lastErrorMessage: task?.last_error?.message
          ? String(task.last_error.message).slice(0, 300)
          : null,
        evidenceMeta,
      },
      auth: auth,
      agent: agent,
      dispatches: (dispatches ?? []).map((d) => ({
        status: d.status,
        mode: d.mode,
        provider: d.provider_id,
        model: d.model,
        reservationId: d.reservation_id,
        key: d.idempotency_key,
        detail: (d.detail ?? "").slice(0, 400),
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      })),
      liveDispatchCount: liveDispatches.length,
      mockDispatchCount: mockDispatches.length,
      reservationsMatched: reservations ?? [],
      recentReservations: (allRes ?? []).slice(0, 10),
      allowance: {
        ...allowance,
        availableCents: available,
      },
      events: (events ?? []).map((e) => ({
        type: e.event_type,
        detail: (e.detail ?? "").slice(0, 300),
        at: e.created_at,
      })),
      checkpoints: checkpoints ?? [],
      logSignals: {
        openaiInvokedInLogs,
        openaiUsageInLogs,
        liveDisabledInLogs,
        recentHits: [...new Set(lastLogHits)].slice(-20),
      },
      assessment,
    },
    null,
    2,
  ),
);
