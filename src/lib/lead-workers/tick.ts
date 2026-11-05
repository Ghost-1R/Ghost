import type { SupabaseClient } from "@supabase/supabase-js";
import { searchProspectsWithBrave } from "@/lib/command/brave-search";
import { isMockSourceUrl } from "@/lib/command/outreach";
import { loose } from "@/lib/db/loose";
import { advanceCursor, asStringList, normalizeCursor, pickFromCursor } from "./cursor";
import { leadWorkersEnvEnabled } from "./db";
import {
  buildOutreachDraft,
  fetchPageText,
  qualifyLeadHit,
} from "./qualify";
import {
  etCalendarDay,
  manualIdempotencyKey,
  onDutyWorker,
  scheduledIdempotencyKey,
} from "./schedule";
import {
  DEFAULT_INDUSTRIES,
  DEFAULT_MARKETS,
  DEFAULT_SERVICES,
  type LeadSearchCursor,
  type LeadWorkerSlug,
} from "./types";

export type LeadWorkerTickResult = {
  ok: boolean;
  status: "completed" | "skipped" | "blocked" | "failed" | "already_running" | "duplicate";
  worker: LeadWorkerSlug | null;
  runId: string | null;
  leadsAdded: number;
  message: string;
  braveRequests: number;
};

type ConfigRow = {
  id: string;
  company_id: string | null;
  owner_id: string | null;
  company_slug: string;
  enabled: boolean;
  paused: boolean;
  daily_brave_cap: number;
  brave_requests_today: number;
  brave_quota_day: string;
  industries: unknown;
  markets: unknown;
  services: unknown;
  cursor: unknown;
  last_handoff: unknown;
};

const MAX_HITS_TO_INSPECT = 5;
const MAX_PAGE_FETCHES = 3;

async function loadConfig(supabase: SupabaseClient): Promise<ConfigRow | null> {
  const { data, error } = await loose(supabase)
    .from("ceo_lead_worker_config")
    .select(
      "id, company_id, owner_id, company_slug, enabled, paused, daily_brave_cap, brave_requests_today, brave_quota_day, industries, markets, services, cursor, last_handoff",
    )
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as ConfigRow;
}

async function resolveCompany(
  supabase: SupabaseClient,
  config: ConfigRow,
): Promise<{ companyId: string; ownerId: string } | null> {
  if (config.company_id && config.owner_id) {
    return { companyId: config.company_id, ownerId: config.owner_id };
  }
  const { data } = await loose(supabase)
    .from("companies")
    .select("id, owner_id, slug")
    .eq("slug", config.company_slug || "badger-united")
    .maybeSingle();
  if (!data?.id || !data?.owner_id) return null;
  await loose(supabase)
    .from("ceo_lead_worker_config")
    .update({
      company_id: data.id,
      owner_id: data.owner_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", config.id);
  return { companyId: String(data.id), ownerId: String(data.owner_id) };
}

async function hasActiveRun(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await loose(supabase)
    .from("ceo_lead_worker_runs")
    .select("id")
    .eq("status", "running")
    .gt("lease_expires_at", new Date().toISOString())
    .limit(1);
  return Boolean(data?.length);
}

async function resetDailyQuotaIfNeeded(
  supabase: SupabaseClient,
  config: ConfigRow,
  today: string,
): Promise<ConfigRow> {
  if (config.brave_quota_day === today) return config;
  await loose(supabase)
    .from("ceo_lead_worker_config")
    .update({
      brave_quota_day: today,
      brave_requests_today: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", config.id);
  return { ...config, brave_quota_day: today, brave_requests_today: 0 };
}

async function saveLead(input: {
  supabase: SupabaseClient;
  companyId: string;
  ownerId: string;
  worker: LeadWorkerSlug;
  runId: string;
  industry: string;
  market: string;
  service: string;
  founderName: string;
  qualified: Extract<ReturnType<typeof qualifyLeadHit>, { ok: true }>;
}): Promise<"inserted" | "duplicate" | "skipped"> {
  if (isMockSourceUrl(input.qualified.website)) return "skipped";

  const existing = await loose(input.supabase)
    .from("ceo_opportunities")
    .select("id, outreach_stage, do_not_contact")
    .eq("company_id", input.companyId)
    .eq("source_url", input.qualified.website)
    .maybeSingle();
  if (existing.data?.id) {
    if (existing.data.do_not_contact || existing.data.outreach_stage === "closed") {
      return "skipped";
    }
    return "duplicate";
  }

  const waiting =
    input.qualified.kind === "qualified" && Boolean(input.qualified.contactEmail);
  const draft = waiting
    ? buildOutreachDraft({
        businessName: input.qualified.businessName,
        founderName: input.founderName,
        evidenceSignal: input.qualified.evidenceSignal,
        service: input.service,
      })
    : "";

  const inserted = await loose(input.supabase)
    .from("ceo_opportunities")
    .insert({
      owner_id: input.ownerId,
      company_id: input.companyId,
      title: input.qualified.businessName,
      value_cents: 0,
      currency: "USD",
      score: waiting ? 70 : input.qualified.evidenceSignal ? 55 : 35,
      geography: input.market.slice(0, 120),
      status: "PROSPECT",
      source: `lead_worker:${input.worker}`,
      fit_reason: input.qualified.pitch.slice(0, 2000),
      source_url: input.qualified.website,
      contact_email: input.qualified.contactEmail,
      outreach_stage: waiting ? "waiting" : "new",
      service_interest: ["website", "app", "ads", "wholesale"].includes(input.service)
        ? input.service
        : "",
      industry: input.industry.slice(0, 120),
      market: input.market.slice(0, 120),
      is_mock: false,
      discovered_by_worker: input.worker,
      discovery_run_id: input.runId,
      evidence_signal: input.qualified.evidenceSignal.slice(0, 500),
      outreach_draft: draft.slice(0, 4000),
      do_not_contact: false,
    })
    .select("id")
    .maybeSingle();

  if (inserted.error) {
    if (/duplicate|unique|ceo_opportunities_company_source_url/i.test(inserted.error.message)) {
      return "duplicate";
    }
    throw new Error(inserted.error.message);
  }
  return "inserted";
}

export async function runLeadWorkerTick(
  supabase: SupabaseClient,
  options: {
    trigger?: "schedule" | "manual";
    at?: Date;
    fetchImpl?: typeof fetch;
    founderName?: string;
    forceEnvBypass?: boolean;
  } = {},
): Promise<LeadWorkerTickResult> {
  const at = options.at ?? new Date();
  const trigger = options.trigger ?? "schedule";
  const worker = onDutyWorker(at);
  const today = etCalendarDay(at);

  if (!options.forceEnvBypass && !leadWorkersEnvEnabled()) {
    return {
      ok: false,
      status: "blocked",
      worker,
      runId: null,
      leadsAdded: 0,
      braveRequests: 0,
      message:
        "Lead workers are off. Set GHOST_LEAD_WORKERS_ENABLED=1 and enable the scheduler in Shift Intelligence.",
    };
  }

  const config = await loadConfig(supabase);
  if (!config) {
    return {
      ok: false,
      status: "blocked",
      worker,
      runId: null,
      leadsAdded: 0,
      braveRequests: 0,
      message: "Lead worker config missing. Apply migration 20261105150000_ceo_lead_workers.sql.",
    };
  }

  if (!config.enabled) {
    return {
      ok: false,
      status: "blocked",
      worker,
      runId: null,
      leadsAdded: 0,
      braveRequests: 0,
      message: "Scheduler disabled in config. Enable it from Shift Intelligence after configuring markets.",
    };
  }

  if (config.paused && trigger === "schedule") {
    return {
      ok: false,
      status: "skipped",
      worker,
      runId: null,
      leadsAdded: 0,
      braveRequests: 0,
      message: "Scheduler paused.",
    };
  }

  const company = await resolveCompany(supabase, config);
  if (!company) {
    await loose(supabase)
      .from("ceo_lead_worker_config")
      .update({
        last_blocker: "Badger United company not found for slug badger-united.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);
    return {
      ok: false,
      status: "blocked",
      worker,
      runId: null,
      leadsAdded: 0,
      braveRequests: 0,
      message: "Badger United company not found.",
    };
  }

  if (await hasActiveRun(supabase)) {
    return {
      ok: false,
      status: "already_running",
      worker,
      runId: null,
      leadsAdded: 0,
      braveRequests: 0,
      message: "Another lead-worker run is already active.",
    };
  }

  const quotaConfig = await resetDailyQuotaIfNeeded(supabase, config, today);
  if (quotaConfig.brave_requests_today >= quotaConfig.daily_brave_cap) {
    const msg = `Daily Brave request cap reached (${quotaConfig.brave_requests_today}/${quotaConfig.daily_brave_cap}).`;
    await loose(supabase)
      .from("ceo_lead_worker_config")
      .update({ last_blocker: msg, updated_at: new Date().toISOString() })
      .eq("id", config.id);
    return {
      ok: false,
      status: "blocked",
      worker,
      runId: null,
      leadsAdded: 0,
      braveRequests: 0,
      message: msg,
    };
  }

  const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim() ?? "";
  if (!braveKey) {
    const msg = "BRAVE_SEARCH_API_KEY missing — automated lead runs blocked (no MOCK saves).";
    await loose(supabase)
      .from("ceo_lead_worker_config")
      .update({ last_blocker: msg, updated_at: new Date().toISOString() })
      .eq("id", config.id);
    return {
      ok: false,
      status: "blocked",
      worker,
      runId: null,
      leadsAdded: 0,
      braveRequests: 0,
      message: msg,
    };
  }

  const industries = asStringList(quotaConfig.industries, DEFAULT_INDUSTRIES);
  const markets = asStringList(quotaConfig.markets, DEFAULT_MARKETS);
  const services = asStringList(quotaConfig.services, DEFAULT_SERVICES);
  const cursorBefore = normalizeCursor(quotaConfig.cursor, {
    industries: industries.length,
    markets: markets.length,
    services: services.length,
  });
  const industry = pickFromCursor(industries, cursorBefore.industryIdx) ?? industries[0]!;
  const market = pickFromCursor(markets, cursorBefore.marketIdx) ?? markets[0]!;
  const service = pickFromCursor(services, cursorBefore.serviceIdx) ?? services[0]!;

  const idempotencyKey =
    trigger === "manual" ? manualIdempotencyKey(at) : scheduledIdempotencyKey(at);

  const leaseToken = `lease-${crypto.randomUUID()}`;
  const leaseExpires = new Date(at.getTime() + 15 * 60_000).toISOString();

  const existingRun = await loose(supabase)
    .from("ceo_lead_worker_runs")
    .select("id, status, lease_expires_at, leads_added")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingRun.data?.id) {
    const status = String(existingRun.data.status);
    if (status === "completed") {
      return {
        ok: true,
        status: "duplicate",
        worker,
        runId: String(existingRun.data.id),
        leadsAdded: Number(existingRun.data.leads_added) || 0,
        braveRequests: 0,
        message: "This hour’s run already completed (idempotent skip).",
      };
    }
    if (status === "running") {
      const leaseOk =
        existingRun.data.lease_expires_at &&
        new Date(String(existingRun.data.lease_expires_at)).getTime() > Date.now();
      if (leaseOk) {
        return {
          ok: false,
          status: "already_running",
          worker,
          runId: String(existingRun.data.id),
          leadsAdded: 0,
          braveRequests: 0,
          message: "Another lead-worker run is already active.",
        };
      }
    }
    // Reclaim failed/blocked/expired rows for the same hour key (restart-safe).
    const reclaimed = await loose(supabase)
      .from("ceo_lead_worker_runs")
      .update({
        worker_slug: worker,
        status: "running",
        trigger_kind: trigger === "manual" ? "retry" : trigger,
        industry,
        market,
        service_interest: service,
        query_used: "",
        leads_added: 0,
        candidates_seen: 0,
        brave_requests: 0,
        cursor_before: cursorBefore,
        cursor_after: {},
        result_summary: "",
        blocker: "",
        lease_token: leaseToken,
        lease_expires_at: leaseExpires,
        started_at: at.toISOString(),
        completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingRun.data.id)
      .select("id")
      .maybeSingle();
    if (reclaimed.error || !reclaimed.data?.id) {
      return {
        ok: false,
        status: "failed",
        worker,
        runId: String(existingRun.data.id),
        leadsAdded: 0,
        braveRequests: 0,
        message: reclaimed.error?.message || "Could not reclaim prior run.",
      };
    }
  }

  const created = existingRun.data?.id
    ? { data: { id: existingRun.data.id }, error: null }
    : await loose(supabase)
        .from("ceo_lead_worker_runs")
        .insert({
          worker_slug: worker,
          company_id: company.companyId,
          owner_id: company.ownerId,
          status: "running",
          idempotency_key: idempotencyKey,
          trigger_kind: trigger,
          industry,
          market,
          service_interest: service,
          query_used: "",
          cursor_before: cursorBefore,
          lease_token: leaseToken,
          lease_expires_at: leaseExpires,
          started_at: at.toISOString(),
        })
        .select("id")
        .maybeSingle();

  if (created.error) {
    if (/unique|duplicate|idempotency/i.test(created.error.message)) {
      return {
        ok: true,
        status: "duplicate",
        worker,
        runId: null,
        leadsAdded: 0,
        braveRequests: 0,
        message: "This hour’s run already exists (idempotent skip).",
      };
    }
    return {
      ok: false,
      status: "failed",
      worker,
      runId: null,
      leadsAdded: 0,
      braveRequests: 0,
      message: created.error.message,
    };
  }

  const runId = String(created.data?.id ?? "");
  let leadsAdded = 0;
  let candidatesSeen = 0;
  let braveRequests = 0;
  let summary = "";
  let blocker = "";

  try {
    const query = `${industry} ${market} official website`;
    const search = await searchProspectsWithBrave({
      businessType: industry,
      city: market,
      apiKey: braveKey,
      fetchImpl: options.fetchImpl,
    });
    braveRequests += 1;

    await loose(supabase)
      .from("ceo_lead_worker_config")
      .update({
        brave_requests_today: quotaConfig.brave_requests_today + braveRequests,
        brave_quota_day: today,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    await loose(supabase)
      .from("ceo_lead_worker_runs")
      .update({ query_used: query.slice(0, 400), brave_requests: braveRequests })
      .eq("id", runId)
      .eq("lease_token", leaseToken);

    if (!search.ok || search.mode !== "live") {
      blocker =
        search.setupMessage ||
        "Brave Search did not return live results. Automated runs refuse MOCK saves.";
      throw new Error(blocker);
    }

    const hits = search.results.filter((hit) => !isMockSourceUrl(hit.url)).slice(0, MAX_HITS_TO_INSPECT);
    candidatesSeen = hits.length;
    let fetches = 0;
    const founderName = options.founderName?.trim() || "Ghost";

    for (const hit of hits) {
      let pageText = "";
      if (fetches < MAX_PAGE_FETCHES) {
        pageText = await fetchPageText(hit.url, options.fetchImpl);
        fetches += 1;
      }
      const qualified = qualifyLeadHit({
        title: hit.title,
        url: hit.url,
        description: hit.description,
        pageText,
        service,
        market,
      });
      if (!qualified.ok) continue;
      const saved = await saveLead({
        supabase,
        companyId: company.companyId,
        ownerId: company.ownerId,
        worker,
        runId,
        industry,
        market,
        service,
        founderName,
        qualified,
      });
      if (saved === "inserted") leadsAdded += 1;
    }

    const cursorAfter: LeadSearchCursor = advanceCursor(cursorBefore, {
      industries: industries.length,
      markets: markets.length,
      services: services.length,
    });
    summary =
      leadsAdded === 0
        ? `Zero good leads for ${industry} · ${market} · ${service}.`
        : `Added ${leadsAdded} lead(s) for ${industry} · ${market} · ${service}.`;

    await loose(supabase)
      .from("ceo_lead_worker_config")
      .update({
        cursor: cursorAfter,
        last_handoff: {
          worker,
          runId,
          at: new Date().toISOString(),
          industry,
          market,
          service,
          leadsAdded,
          cursorAfter,
        },
        last_blocker: "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    await loose(supabase)
      .from("ceo_lead_worker_runs")
      .update({
        status: "completed",
        leads_added: leadsAdded,
        candidates_seen: candidatesSeen,
        brave_requests: braveRequests,
        cursor_after: cursorAfter,
        result_summary: summary,
        blocker: "",
        completed_at: new Date().toISOString(),
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("lease_token", leaseToken);

    return {
      ok: true,
      status: "completed",
      worker,
      runId,
      leadsAdded,
      braveRequests,
      message: summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await loose(supabase)
      .from("ceo_lead_worker_config")
      .update({
        last_blocker: message.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);
    await loose(supabase)
      .from("ceo_lead_worker_runs")
      .update({
        status: blocker || /cap|missing|MOCK|disabled|paused/i.test(message) ? "blocked" : "failed",
        leads_added: leadsAdded,
        candidates_seen: candidatesSeen,
        brave_requests: braveRequests,
        result_summary: summary || message.slice(0, 2000),
        blocker: message.slice(0, 2000),
        completed_at: new Date().toISOString(),
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return {
      ok: false,
      status: "failed",
      worker,
      runId,
      leadsAdded,
      braveRequests,
      message,
    };
  }
}
