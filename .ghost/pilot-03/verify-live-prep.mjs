/**
 * Final live-dispatch prep — READ ONLY.
 * No queue/consume/enable/dispatch/OpenAI calls. No secret print.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseCodegenScopeFragment } from "../../src/lib/codegen/request-contract.ts";
import { verifyPilot03LiveFounderScope } from "../../src/lib/codegen/live-scope.ts";
import { isCodegenLiveEnabled } from "../../src/lib/codegen/provider-config.ts";
import { PILOT_03_MAX_TRIAL_CENTS } from "../../src/lib/codegen/openai-models.ts";

const env = new Map();
for (const raw of readFileSync(".env.local", "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  const i = raw.indexOf("=");
  if (i > 0) env.set(raw.slice(0, i).trim(), raw.slice(i + 1).trim());
}

const TASK = "8bdfde20-2f66-4518-9aea-6e632001fe7f";
const AUTH = "5aee1635-62c3-4ab6-8237-060ee4bc1b16";
const OWNER = "adcc741f-1570-472f-9bf4-ef44028f57fc";
const PROJECT = "f5397422-1c9d-4ef5-b639-8eee89981f5e";
const FP = "c98ad5b97432d22a9600990dc664fa43b52a8d24a3932015ee82cf88475fcf71";

const url = env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const runtime = env.get("GHOST_AGENT_RUNTIME_API_URL") ?? "";
const live = env.get("GHOST_CODEGEN_LIVE_ENABLED") ?? "";
const openaiPresent = Boolean(env.get("OPENAI_API_KEY")?.trim());
const nextPublicOpenai = Boolean(env.get("NEXT_PUBLIC_OPENAI_API_KEY")?.trim());
const hosted = [...env.entries()].some(
  ([k, v]) => /SUPABASE|AGENT_RUNTIME|PRODUCTION_URL/i.test(k) && /supabase\.co/i.test(v ?? ""),
);

const ghostPort = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_ghost"], { encoding: "utf8" }))[0]
  ?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;
const disposablePort = JSON.parse(
  execFileSync("docker", ["inspect", "supabase_db_ghost99f"], { encoding: "utf8" }),
)[0]?.NetworkSettings?.Ports?.["5432/tcp"]?.[0]?.HostPort;

if (url !== "http://127.0.0.1:54331") throw new Error(`not ghost99f API: ${url}`);
if (runtime !== "http://127.0.0.1:54331") throw new Error(`runtime not ghost99f: ${runtime}`);
if (disposablePort !== "55432") throw new Error(`DB port ${disposablePort}`);
if (ghostPort !== "54322") throw new Error(`Ghost port unexpected ${ghostPort}`);
if (live === "1") throw new Error("live flag must remain off for this prep mission");

const sb = createClient(url, env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: task } = await sb
  .from("remote_development_tasks")
  .select(
    "id,status,owner_id,project_id,authorization_id,agent_task_id,scope_fingerprint,action_scope,environment_label,deployment_authorized,max_estimated_cost_usd,queued_at,started_at,created_at",
  )
  .eq("id", TASK)
  .maybeSingle();

const { data: auth } = await sb
  .from("founder_action_authorizations")
  .select(
    "id,status,use_count,reuse_policy,owner_id,project_id,scope_fingerprint,action_scope,action_type,environment_label,expires_at,consumed_at,decided_at,created_at",
  )
  .eq("id", AUTH)
  .maybeSingle();

const { data: agent } = task?.agent_task_id
  ? await sb
      .from("agent_tasks")
      .select(
        "id,status,owner_id,project_id,authorization_id,authorization_consumed,action_type,action_scope,environment_label,scope_fingerprint",
      )
      .eq("id", task.agent_task_id)
      .maybeSingle()
  : { data: null };

const { data: allowance } = await sb
  .from("project_ai_allowances")
  .select("allowance_cents,reserved_cents,charged_cents")
  .eq("project_id", PROJECT)
  .eq("owner_id", OWNER)
  .maybeSingle();

const { data: dispatches, count: dispatchCount } = await sb
  .from("codegen_provider_dispatches")
  .select("id,status,mode,idempotency_key,created_at", { count: "exact" })
  .eq("remote_development_task_id", TASK);

const { count: liveDispatchCount } = await sb
  .from("codegen_provider_dispatches")
  .select("id", { count: "exact", head: true })
  .eq("remote_development_task_id", TASK)
  .eq("mode", "LIVE_PROVIDER");

const available =
  Number(allowance?.allowance_cents ?? 0) -
  Number(allowance?.reserved_cents ?? 0) -
  Number(allowance?.charged_cents ?? 0);

const scope = auth?.action_scope ?? task?.action_scope ?? "";
const contract = parseCodegenScopeFragment(scope);
const consumedAt = auth?.consumed_at ? Date.parse(auth.consumed_at) : NaN;
const expiresAt = auth?.expires_at ? Date.parse(auth.expires_at) : NaN;
const validWhenConsumed =
  Number.isFinite(consumedAt) && Number.isFinite(expiresAt) ? consumedAt < expiresAt : false;

const liveScope = verifyPilot03LiveFounderScope({
  actionScope: scope,
  environmentLabel: auth?.environment_label ?? task?.environment_label ?? "",
  authorization: {
    status: auth?.status ?? "PENDING",
    effectiveStatus: auth?.status ?? "PENDING",
    reusePolicy: auth?.reuse_policy ?? "ONE_TIME",
    actionType: auth?.action_type ?? "",
  },
});

const bindingOk =
  Boolean(task?.agent_task_id) &&
  agent?.id === task?.agent_task_id &&
  agent?.authorization_id === AUTH &&
  agent?.owner_id === OWNER &&
  agent?.project_id === PROJECT &&
  agent?.scope_fingerprint === FP &&
  agent?.authorization_consumed === true;

const ready =
  task?.status === "QUEUED" &&
  auth?.status === "CONSUMED" &&
  Number(auth?.use_count) === 1 &&
  bindingOk &&
  task?.owner_id === OWNER &&
  task?.project_id === PROJECT &&
  task?.scope_fingerprint === FP &&
  auth?.scope_fingerprint === FP &&
  contract?.providerId === "openai" &&
  contract?.model === "gpt-5-mini" &&
  contract?.classification === "PUBLIC" &&
  contract?.maxSpendCents === 100 &&
  /deploy=false/.test(scope) &&
  (auth?.environment_label === "LOCAL_PILOT_03" || task?.environment_label === "LOCAL_PILOT_03") &&
  task?.deployment_authorized === false &&
  validWhenConsumed &&
  (liveDispatchCount ?? 0) === 0 &&
  available === 100 &&
  openaiPresent &&
  !nextPublicOpenai &&
  !hosted &&
  !isCodegenLiveEnabled(Object.fromEntries(env)) &&
  liveScope.ok;

console.log(
  JSON.stringify(
    {
      isolation: {
        url,
        runtime,
        disposableDbPort: disposablePort,
        ghostDbPort: ghostPort,
        liveFlag: live === "" ? "(empty)" : live,
        liveEnabled: isCodegenLiveEnabled(Object.fromEntries(env)),
        hostedActive: hosted,
        container: env.get("GHOST_LOCAL_DB_CONTAINER") ?? null,
      },
      task: {
        id: task?.id,
        status: task?.status,
        queuedAt: task?.queued_at,
        agentTaskId: task?.agent_task_id,
        ownerId: task?.owner_id,
        projectId: task?.project_id,
        fingerprint: task?.scope_fingerprint,
        deploymentAuthorized: task?.deployment_authorized,
        maxEstimatedCostUsd: task?.max_estimated_cost_usd,
      },
      authorization: {
        id: auth?.id,
        status: auth?.status,
        useCount: auth?.use_count,
        reusePolicy: auth?.reuse_policy,
        consumedAt: auth?.consumed_at,
        expiresAt: auth?.expires_at,
        validWhenConsumed,
        currentlyExpired: Number.isFinite(expiresAt) ? expiresAt <= Date.now() : true,
      },
      agentBinding: {
        ok: bindingOk,
        agentId: agent?.id ?? null,
        status: agent?.status ?? null,
        authorizationConsumed: agent?.authorization_consumed ?? null,
        fingerprint: agent?.scope_fingerprint ?? null,
      },
      scope: {
        provider: contract?.providerId ?? null,
        model: contract?.model ?? null,
        classification: contract?.classification ?? null,
        maxSpendCents: contract?.maxSpendCents ?? null,
        dispatch: contract?.dispatch ?? null,
        deployFalse: /deploy=false/.test(scope),
        environment: auth?.environment_label ?? task?.environment_label,
        liveScopeOk: liveScope.ok,
        liveScopeDetail: liveScope.ok ? liveScope.detail : `${liveScope.reason}: ${liveScope.message}`,
      },
      allowance: {
        allowanceCents: Number(allowance?.allowance_cents ?? 0),
        reservedCents: Number(allowance?.reserved_cents ?? 0),
        chargedCents: Number(allowance?.charged_cents ?? 0),
        availableCents: available,
      },
      dispatches: {
        total: dispatchCount ?? 0,
        liveProvider: liveDispatchCount ?? 0,
        rows: (dispatches ?? []).map((d) => ({
          status: d.status,
          mode: d.mode,
          key: d.idempotency_key,
        })),
      },
      credentials: {
        OPENAI_KEY_PRESENT: openaiPresent,
        NEXT_PUBLIC_OPENAI_PRESENT: nextPublicOpenai,
      },
      ceilings: {
        pilotMaxTrialCents: PILOT_03_MAX_TRIAL_CENTS,
        taskMaxUsd: task?.max_estimated_cost_usd ?? null,
      },
      READY_FOR_ONE_LIVE_CALL: ready,
    },
    null,
    2,
  ),
);
