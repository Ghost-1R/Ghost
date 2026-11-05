import type { SupabaseClient } from "@supabase/supabase-js";
import { loose } from "@/lib/db/loose";
import { outreachEnvEnabled, outreachProviderFromEnv, outreachSesSandboxToFromEnv } from "./db";
import { businessWindowLabel } from "./schedule";
import type { OutreachBoardState, OutreachConfigRow, OutreachProviderId } from "./types";

function asConfig(row: Record<string, unknown> | null): OutreachConfigRow | null {
  if (!row) return null;
  const providerRaw = String(row.provider ?? "fake");
  const provider: OutreachProviderId = providerRaw === "ses" ? "ses" : "fake";
  const sandboxFromRow = String(row.ses_sandbox_recipient ?? "");
  return {
    id: String(row.id),
    company_id: row.company_id ? String(row.company_id) : null,
    owner_id: row.owner_id ? String(row.owner_id) : null,
    company_slug: String(row.company_slug ?? "badger-united"),
    live_enabled: Boolean(row.live_enabled),
    paused: Boolean(row.paused),
    daily_send_cap: Number(row.daily_send_cap) || 5,
    sends_today: Number(row.sends_today) || 0,
    fake_sends_today: Number(row.fake_sends_today) || 0,
    send_quota_day: String(row.send_quota_day ?? ""),
    ses_sandbox_recipient: sandboxFromRow || outreachSesSandboxToFromEnv(),
    window_start_hour: Number(row.window_start_hour) || 9,
    window_end_hour: Number(row.window_end_hour) || 17,
    timezone: String(row.timezone ?? "America/New_York"),
    sender_email: String(row.sender_email ?? ""),
    sender_display_name: String(row.sender_display_name ?? "Badger United"),
    reply_to_email: String(row.reply_to_email ?? ""),
    postal_address: String(row.postal_address ?? ""),
    commercial_identity: String(row.commercial_identity ?? "Badger United"),
    provider: provider === "fake" ? outreachProviderFromEnv() : provider,
    last_blocker: String(row.last_blocker ?? ""),
  };
}

export async function loadOutreachConfig(
  supabase: SupabaseClient,
): Promise<OutreachConfigRow | null> {
  const query = await loose(supabase)
    .from("ceo_outreach_config")
    .select(
      "id, company_id, owner_id, company_slug, live_enabled, paused, daily_send_cap, sends_today, fake_sends_today, send_quota_day, ses_sandbox_recipient, window_start_hour, window_end_hour, timezone, sender_email, sender_display_name, reply_to_email, postal_address, commercial_identity, provider, last_blocker",
    )
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (query.error || !query.data) return null;
  return asConfig(query.data as Record<string, unknown>);
}

export async function loadOutreachBoard(
  supabase: SupabaseClient,
): Promise<OutreachBoardState> {
  const envOn = outreachEnvEnabled();
  const config = await loadOutreachConfig(supabase);
  if (!config) {
    return {
      configured: false,
      liveEnabled: false,
      paused: false,
      schedulerAvailable: false,
      unavailableReason:
        "Outreach tables missing — apply migration 20261105160000_ceo_outreach_worker.sql.",
      companySlug: "badger-united",
      companyId: null,
      dailySendCap: 5,
      sendsToday: 0,
      fakeSendsToday: 0,
      sendQuotaDay: "",
      sesSandboxRecipient: outreachSesSandboxToFromEnv(),
      windowLabel: businessWindowLabel(9, 17),
      senderEmail: "",
      replyToEmail: "",
      postalAddress: "",
      commercialIdentity: "Badger United",
      provider: "fake",
      queuedCount: 0,
      sendingCount: 0,
      needsAttentionCount: 0,
      lastBlocker: null,
    };
  }

  const companyId = config.company_id;
  let queuedCount = 0;
  let sendingCount = 0;
  let needsAttentionCount = 0;
  if (companyId) {
    const counts = await loose(supabase)
      .from("ceo_outreach_messages")
      .select("status")
      .eq("company_id", companyId)
      .in("status", ["queued", "sending", "failed"]);
    for (const row of counts.data ?? []) {
      const status = String((row as { status?: string }).status ?? "");
      if (status === "queued") queuedCount += 1;
      if (status === "sending") sendingCount += 1;
      if (status === "failed") needsAttentionCount += 1;
    }
    const oppAttention = await loose(supabase)
      .from("ceo_opportunities")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("outreach_stage", "needs_attention");
    needsAttentionCount += oppAttention.count ?? 0;
  }

  let unavailableReason: string | null = null;
  if (!envOn) unavailableReason = "Env GHOST_OUTREACH_ENABLED is not set.";
  else if (!config.live_enabled) {
    unavailableReason = config.ses_sandbox_recipient
      ? "Live sending off. SES sandbox may only target the verified founder inbox."
      : "Live sending disabled in Outreach config.";
  } else if (config.paused) unavailableReason = "Outreach paused.";
  else if (!config.sender_email || !config.reply_to_email || !config.postal_address) {
    unavailableReason = "Sender, reply-to, and postal address required before live sends.";
  }

  const schedulerAvailable =
    envOn && config.live_enabled && !config.paused && Boolean(config.sender_email);

  return {
    configured: true,
    liveEnabled: config.live_enabled,
    paused: config.paused,
    schedulerAvailable,
    unavailableReason,
    companySlug: config.company_slug,
    companyId,
    dailySendCap: config.daily_send_cap,
    sendsToday: config.sends_today,
    fakeSendsToday: config.fake_sends_today,
    sendQuotaDay: config.send_quota_day,
    sesSandboxRecipient: config.ses_sandbox_recipient,
    windowLabel: businessWindowLabel(config.window_start_hour, config.window_end_hour),
    senderEmail: config.sender_email,
    replyToEmail: config.reply_to_email,
    postalAddress: config.postal_address,
    commercialIdentity: config.commercial_identity,
    provider: config.provider,
    queuedCount,
    sendingCount,
    needsAttentionCount,
    lastBlocker: config.last_blocker || null,
  };
}
