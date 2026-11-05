import type { SupabaseClient } from "@supabase/supabase-js";
import { loose } from "@/lib/db/loose";
import { asStringList, normalizeCursor } from "./cursor";
import { leadWorkersEnvEnabled } from "./db";
import {
  isWorkerOnDuty,
  nextHourlyRunAt,
  onDutyWorker,
  workerShiftLabel,
} from "./schedule";
import {
  DEFAULT_INDUSTRIES,
  DEFAULT_MARKETS,
  DEFAULT_SERVICES,
  type LeadWorkerBoardState,
  type LeadWorkerCard,
  type LeadWorkerSlug,
} from "./types";

const WORKER_META: Record<LeadWorkerSlug, { displayName: string; colorHex: string }> = {
  will: { displayName: "Will", colorHex: "#3b82f6" },
  bubba: { displayName: "Bubba", colorHex: "#f59e0b" },
};

export async function loadLeadWorkerBoard(
  supabase: SupabaseClient,
): Promise<LeadWorkerBoardState> {
  const envOn = leadWorkersEnvEnabled();
  const configQuery = await loose(supabase)
    .from("ceo_lead_worker_config")
    .select(
      "id, company_id, company_slug, enabled, paused, daily_brave_cap, brave_requests_today, brave_quota_day, industries, markets, services, cursor, last_handoff, last_blocker",
    )
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (configQuery.error) {
    const missing = /does not exist|schema cache/i.test(configQuery.error.message);
    return {
      configured: false,
      enabled: false,
      paused: false,
      schedulerAvailable: false,
      unavailableReason: missing
        ? "Lead worker tables missing — apply migration 20261105150000_ceo_lead_workers.sql."
        : configQuery.error.message,
      companySlug: "badger-united",
      companyId: null,
      dailyBraveCap: 24,
      braveRequestsToday: 0,
      braveQuotaDay: "",
      industries: [...DEFAULT_INDUSTRIES],
      markets: [...DEFAULT_MARKETS],
      services: [...DEFAULT_SERVICES],
      cursor: { industryIdx: 0, marketIdx: 0, serviceIdx: 0 },
      workers: (["will", "bubba"] as LeadWorkerSlug[]).map((slug) => ({
        slug,
        displayName: WORKER_META[slug].displayName,
        colorHex: WORKER_META[slug].colorHex,
        duty: isWorkerOnDuty(slug) ? "on" : "off",
        executing: false,
        lastSuccessfulRunAt: null,
        nextRunAt: null,
        leadsAddedTotal: 0,
        lastBlocker: null,
        shiftLabel: workerShiftLabel(slug),
      })),
      lastHandoffSummary: null,
    };
  }

  const config = configQuery.data as Record<string, unknown> | null;
  if (!config) {
    return {
      configured: false,
      enabled: false,
      paused: false,
      schedulerAvailable: envOn,
      unavailableReason: envOn
        ? "Config row missing."
        : "Scheduler env off (GHOST_LEAD_WORKERS_ENABLED). DB enable still required.",
      companySlug: "badger-united",
      companyId: null,
      dailyBraveCap: 24,
      braveRequestsToday: 0,
      braveQuotaDay: "",
      industries: [...DEFAULT_INDUSTRIES],
      markets: [...DEFAULT_MARKETS],
      services: [...DEFAULT_SERVICES],
      cursor: { industryIdx: 0, marketIdx: 0, serviceIdx: 0 },
      workers: (["will", "bubba"] as LeadWorkerSlug[]).map((slug) => ({
        slug,
        displayName: WORKER_META[slug].displayName,
        colorHex: WORKER_META[slug].colorHex,
        duty: isWorkerOnDuty(slug) ? "on" : "off",
        executing: false,
        lastSuccessfulRunAt: null,
        nextRunAt: null,
        leadsAddedTotal: 0,
        lastBlocker: null,
        shiftLabel: workerShiftLabel(slug),
      })),
      lastHandoffSummary: null,
    };
  }

  const industries = asStringList(config.industries, DEFAULT_INDUSTRIES);
  const markets = asStringList(config.markets, DEFAULT_MARKETS);
  const services = asStringList(config.services, DEFAULT_SERVICES);
  const cursor = normalizeCursor(config.cursor, {
    industries: industries.length,
    markets: markets.length,
    services: services.length,
  });
  const enabled = Boolean(config.enabled);
  const paused = Boolean(config.paused);
  const companyId = config.company_id ? String(config.company_id) : null;

  const runsQuery = companyId
    ? await loose(supabase)
        .from("ceo_lead_worker_runs")
        .select("id, worker_slug, status, leads_added, completed_at, started_at, blocker, lease_expires_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(40)
    : { data: [] as unknown[], error: null };

  const runs = (runsQuery.data ?? []) as Array<Record<string, unknown>>;
  const now = Date.now();
  const nextRun = enabled && !paused && envOn ? nextHourlyRunAt().toISOString() : null;
  const onDuty = onDutyWorker();
  const handoff = config.last_handoff && typeof config.last_handoff === "object"
    ? (config.last_handoff as Record<string, unknown>)
    : null;

  const workers: LeadWorkerCard[] = (["will", "bubba"] as LeadWorkerSlug[]).map((slug) => {
    const workerRuns = runs.filter((run) => run.worker_slug === slug);
    const lastOk = workerRuns.find((run) => run.status === "completed");
    const executing = workerRuns.some(
      (run) =>
        run.status === "running" &&
        run.lease_expires_at &&
        new Date(String(run.lease_expires_at)).getTime() > now,
    );
    const leadsAddedTotal = workerRuns.reduce(
      (sum, run) => sum + (Number(run.leads_added) || 0),
      0,
    );
    const lastBlocker =
      workerRuns.find((run) => String(run.blocker ?? "").trim())?.blocker ??
      (slug === onDuty ? config.last_blocker : null);
    return {
      slug,
      displayName: WORKER_META[slug].displayName,
      colorHex: WORKER_META[slug].colorHex,
      duty: isWorkerOnDuty(slug) ? "on" : "off",
      executing,
      lastSuccessfulRunAt: lastOk?.completed_at ? String(lastOk.completed_at) : null,
      nextRunAt: slug === onDuty ? nextRun : null,
      leadsAddedTotal,
      lastBlocker: lastBlocker ? String(lastBlocker) : null,
      shiftLabel: workerShiftLabel(slug),
    };
  });

  const schedulerAvailable = envOn && enabled && !paused;
  let unavailableReason: string | null = null;
  if (!envOn) unavailableReason = "Env GHOST_LEAD_WORKERS_ENABLED is not set.";
  else if (!enabled) unavailableReason = "Scheduler disabled in database config.";
  else if (paused) unavailableReason = "Scheduler paused.";

  return {
    configured: true,
    enabled,
    paused,
    schedulerAvailable,
    unavailableReason,
    companySlug: String(config.company_slug ?? "badger-united"),
    companyId,
    dailyBraveCap: Number(config.daily_brave_cap) || 24,
    braveRequestsToday: Number(config.brave_requests_today) || 0,
    braveQuotaDay: String(config.brave_quota_day ?? ""),
    industries,
    markets,
    services,
    cursor,
    workers,
    lastHandoffSummary: handoff
      ? `${String(handoff.worker ?? "")} handed off after +${String(handoff.leadsAdded ?? 0)} lead(s)`.trim()
      : null,
  };
}
