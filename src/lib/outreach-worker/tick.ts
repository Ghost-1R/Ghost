import type { SupabaseClient } from "@supabase/supabase-js";
import { isMockSourceUrl } from "@/lib/command/outreach";
import { loose } from "@/lib/db/loose";
import { hashesMatch } from "./hash";
import { outreachEnvEnabled, outreachProviderFromEnv } from "./db";
import { checkRecipientEligibility } from "./eligibility";
import { loadOutreachConfig } from "./load";
import { getOutreachProvider } from "./provider";
import { gateSesRecipient } from "./sandbox";
import { canSendInWindow, etCalendarDay } from "./schedule";
import { newLeaseToken } from "./hash";
import { normalizeEmail } from "./compliance";
import type { OutreachConfigRow, OutreachProviderId } from "./types";

const LEASE_MS = 10 * 60 * 1000;

export type OutreachTickResult = {
  ok: boolean;
  status:
    | "completed"
    | "skipped"
    | "blocked"
    | "failed"
    | "already_running"
    | "duplicate"
    | "reconciled";
  messageId: string | null;
  opportunityId: string | null;
  message: string;
  sent: number;
};

async function resetDailyCapIfNeeded(
  supabase: SupabaseClient,
  config: OutreachConfigRow,
  today: string,
): Promise<OutreachConfigRow> {
  if (config.send_quota_day === today) return config;
  await loose(supabase)
    .from("ceo_outreach_config")
    .update({
      sends_today: 0,
      fake_sends_today: 0,
      send_quota_day: today,
      updated_at: new Date().toISOString(),
    })
    .eq("id", config.id);
  return { ...config, sends_today: 0, fake_sends_today: 0, send_quota_day: today };
}

function providerCapUsed(config: OutreachConfigRow, provider: OutreachProviderId): number {
  return provider === "fake" ? config.fake_sends_today : config.sends_today;
}

async function isSuppressed(
  supabase: SupabaseClient,
  companyId: string,
  email: string,
): Promise<boolean> {
  const row = await loose(supabase)
    .from("ceo_outreach_suppressions")
    .select("id")
    .eq("company_id", companyId)
    .eq("email", normalizeEmail(email))
    .maybeSingle();
  return Boolean(row.data?.id);
}

async function addSuppression(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    email: string;
    reason: "opt_out" | "bounce" | "manual";
    messageId?: string | null;
    note?: string;
  },
): Promise<void> {
  await loose(supabase).from("ceo_outreach_suppressions").upsert(
    {
      company_id: input.companyId,
      email: normalizeEmail(input.email),
      reason: input.reason,
      source_message_id: input.messageId ?? null,
      note: (input.note ?? "").slice(0, 500),
    },
    { onConflict: "company_id,email" },
  );
}

async function markOpportunityStage(
  supabase: SupabaseClient,
  opportunityId: string,
  stage: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await loose(supabase)
    .from("ceo_opportunities")
    .update({
      outreach_stage: stage,
      updated_at: new Date().toISOString(),
      ...extra,
    })
    .eq("id", opportunityId);
}

function resolveProvider(config: OutreachConfigRow): OutreachProviderId {
  if (config.provider === "ses") return "ses";
  return outreachProviderFromEnv();
}

async function reconcileStuck(
  supabase: SupabaseClient,
  config: OutreachConfigRow,
): Promise<OutreachTickResult | null> {
  const stuck = await loose(supabase)
    .from("ceo_outreach_messages")
    .select(
      "id, opportunity_id, company_id, recipient_email, provider, provider_message_id, lease_token, lease_expires_at, needs_reconcile, status, approval_hash, sender_email, subject, body, approved_sender, approved_recipient, approved_subject, approved_body",
    )
    .eq("company_id", config.company_id)
    .eq("status", "sending")
    .eq("needs_reconcile", true)
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!stuck.data) return null;
  const row = stuck.data as Record<string, unknown>;
  const messageId = String(row.id);
  const providerId = (String(row.provider) === "ses" ? "ses" : "fake") as OutreachProviderId;
  const provider = getOutreachProvider(providerId);
  const providerMessageId = String(row.provider_message_id ?? "");
  if (!providerMessageId) {
    // Uncertain without id — release back to queued only if approval still matches.
    const stillValid = hashesMatch(String(row.approval_hash), {
      sender: String(row.approved_sender || row.sender_email),
      recipient: String(row.approved_recipient || row.recipient_email),
      subject: String(row.approved_subject || row.subject),
      body: String(row.approved_body || row.body),
    });
    if (!stillValid) {
      await loose(supabase)
        .from("ceo_outreach_messages")
        .update({
          status: "awaiting_approval",
          needs_reconcile: false,
          last_error: "Approval no longer matches after uncertain send.",
          lease_token: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", messageId);
      await markOpportunityStage(supabase, String(row.opportunity_id), "waiting");
      return {
        ok: true,
        status: "reconciled",
        messageId,
        opportunityId: String(row.opportunity_id),
        message: "Uncertain send invalidated — fresh approval required.",
        sent: 0,
      };
    }
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "failed",
        needs_reconcile: false,
        last_error: "Provider response uncertain and no message id — manual reconcile required.",
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId);
    await markOpportunityStage(supabase, String(row.opportunity_id), "needs_attention");
    return {
      ok: false,
      status: "failed",
      messageId,
      opportunityId: String(row.opportunity_id),
      message: "Uncertain provider response — parked in Needs attention (no retry to avoid duplicates).",
      sent: 0,
    };
  }

  const result = await provider.reconcile(providerMessageId);
  if (!result.ok) {
    return {
      ok: false,
      status: "failed",
      messageId,
      opportunityId: String(row.opportunity_id),
      message: result.message,
      sent: 0,
    };
  }

  if (result.state === "unknown") {
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "failed",
        needs_reconcile: false,
        provider_raw_status: result.rawStatus,
        last_error: "Could not confirm provider outcome — will not auto-retry.",
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId);
    await markOpportunityStage(supabase, String(row.opportunity_id), "needs_attention");
    return {
      ok: true,
      status: "reconciled",
      messageId,
      opportunityId: String(row.opportunity_id),
      message: "Provider outcome unknown — Needs attention (no duplicate send).",
      sent: 0,
    };
  }

  if (result.state === "bounced" || result.state === "failed") {
    await addSuppression(supabase, {
      companyId: String(row.company_id),
      email: String(row.recipient_email),
      reason: result.state === "bounced" ? "bounce" : "manual",
      messageId,
      note: result.rawStatus,
    });
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: result.state === "bounced" ? "bounced" : "failed",
        needs_reconcile: false,
        bounced_at: result.state === "bounced" ? new Date().toISOString() : null,
        provider_raw_status: result.rawStatus,
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId);
    await markOpportunityStage(
      supabase,
      String(row.opportunity_id),
      result.state === "bounced" ? "bounced" : "needs_attention",
    );
    return {
      ok: true,
      status: "reconciled",
      messageId,
      opportunityId: String(row.opportunity_id),
      message: `Reconciled as ${result.state}.`,
      sent: 0,
    };
  }

  // sent or delivered
  const now = new Date().toISOString();
  await loose(supabase)
    .from("ceo_outreach_messages")
    .update({
      status: result.state === "delivered" ? "delivered" : "sent",
      needs_reconcile: false,
      sent_at: now,
      delivered_at: result.state === "delivered" ? now : null,
      provider_raw_status: result.rawStatus,
      lease_token: null,
      lease_expires_at: null,
      updated_at: now,
    })
    .eq("id", messageId);
  await markOpportunityStage(supabase, String(row.opportunity_id), result.state === "delivered" ? "delivered" : "sent", {
    sent_at: now,
    outreach_message_id: messageId,
  });
  return {
    ok: true,
    status: "reconciled",
    messageId,
    opportunityId: String(row.opportunity_id),
    message: `Reconciled as ${result.state}.`,
    sent: result.state === "sent" || result.state === "delivered" ? 1 : 0,
  };
}

async function claimNextQueued(
  supabase: SupabaseClient,
  config: OutreachConfigRow,
): Promise<Record<string, unknown> | null> {
  const now = Date.now();
  const candidates = await loose(supabase)
    .from("ceo_outreach_messages")
    .select(
      "id, opportunity_id, company_id, owner_id, status, sender_email, reply_to_email, recipient_email, subject, body, approval_hash, approved_sender, approved_recipient, approved_subject, approved_body, approved_at, idempotency_key, lease_token, lease_expires_at, provider, provider_message_id, attempt_count, is_follow_up, opt_out_token, eligibility_id, eligibility_scope",
    )
    .eq("company_id", config.company_id)
    .eq("status", "queued")
    .order("queued_at", { ascending: true })
    .limit(5);

  for (const raw of candidates.data ?? []) {
    const row = raw as Record<string, unknown>;
    const leaseExpiry = row.lease_expires_at
      ? new Date(String(row.lease_expires_at)).getTime()
      : 0;
    if (row.lease_token && leaseExpiry > now) continue;

    const lease = newLeaseToken();
    const expires = new Date(now + LEASE_MS).toISOString();
    const claimed = await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "sending",
        lease_token: lease,
        lease_expires_at: expires,
        attempt_count: (Number(row.attempt_count) || 0) + 1,
        updated_at: new Date().toISOString(),
        last_error: "",
      })
      .eq("id", String(row.id))
      .eq("status", "queued")
      .select(
        "id, opportunity_id, company_id, owner_id, status, sender_email, reply_to_email, recipient_email, subject, body, approval_hash, approved_sender, approved_recipient, approved_subject, approved_body, approved_at, idempotency_key, lease_token, provider, attempt_count, is_follow_up, opt_out_token, eligibility_id, eligibility_scope",
      )
      .maybeSingle();

    if (claimed.data) {
      await markOpportunityStage(supabase, String(row.opportunity_id), "sending");
      return claimed.data as Record<string, unknown>;
    }
  }
  return null;
}

export async function runOutreachTick(
  supabase: SupabaseClient,
  options: {
    trigger?: "schedule" | "manual";
    at?: Date;
    forceEnvBypass?: boolean;
    publicBaseUrl?: string;
  } = {},
): Promise<OutreachTickResult> {
  const at = options.at ?? new Date();
  const trigger = options.trigger ?? "schedule";

  if (!options.forceEnvBypass && !outreachEnvEnabled()) {
    return {
      ok: false,
      status: "blocked",
      messageId: null,
      opportunityId: null,
      message: "Outreach worker off. Set GHOST_OUTREACH_ENABLED=1.",
      sent: 0,
    };
  }

  const config = await loadOutreachConfig(supabase);
  if (!config?.company_id) {
    return {
      ok: false,
      status: "blocked",
      messageId: null,
      opportunityId: null,
      message: "Outreach config missing. Apply migration 20261105160000_ceo_outreach_worker.sql.",
      sent: 0,
    };
  }

  // Live off is OK for fake ticks and for SES sandbox probes to the verified founder inbox.
  // Prospect SES sends remain blocked by gateSesRecipient when live_enabled is false.

  if (config.paused && trigger === "schedule") {
    return {
      ok: true,
      status: "skipped",
      messageId: null,
      opportunityId: null,
      message: "Outreach paused.",
      sent: 0,
    };
  }

  const today = etCalendarDay(at);
  const capped = await resetDailyCapIfNeeded(supabase, config, today);

  const reconciled = await reconcileStuck(supabase, capped);
  if (reconciled) return reconciled;

  if (!canSendInWindow(at, capped.window_start_hour, capped.window_end_hour) && trigger === "schedule") {
    return {
      ok: true,
      status: "skipped",
      messageId: null,
      opportunityId: null,
      message: "Outside U.S. Eastern business-hours send window.",
      sent: 0,
    };
  }

  // Cap is per provider: fake local history must not block SES quota (and vice versa).
  const peekProvider = resolveProvider(capped);
  if (providerCapUsed(capped, peekProvider) >= capped.daily_send_cap) {
    const used = providerCapUsed(capped, peekProvider);
    await loose(supabase)
      .from("ceo_outreach_config")
      .update({
        last_blocker: `${peekProvider} daily send cap reached (${used}/${capped.daily_send_cap}).`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", capped.id);
    return {
      ok: true,
      status: "skipped",
      messageId: null,
      opportunityId: null,
      message: `${peekProvider} daily send cap reached (${used}/${capped.daily_send_cap}).`,
      sent: 0,
    };
  }

  const claimed = await claimNextQueued(supabase, capped);
  if (!claimed) {
    return {
      ok: true,
      status: "skipped",
      messageId: null,
      opportunityId: null,
      message: "No queued Outreach messages.",
      sent: 0,
    };
  }

  const messageId = String(claimed.id);
  const opportunityId = String(claimed.opportunity_id);
  const leaseToken = String(claimed.lease_token ?? "");

  const opportunity = await loose(supabase)
    .from("ceo_opportunities")
    .select(
      "id, company_id, contact_email, source_url, is_mock, do_not_contact, outreach_stage, outreach_draft, outreach_subject, service_interest, source",
    )
    .eq("id", opportunityId)
    .maybeSingle();

  const opp = (opportunity.data ?? null) as Record<string, unknown> | null;
  if (!opp) {
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "failed",
        last_error: "Opportunity missing.",
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    return {
      ok: false,
      status: "failed",
      messageId,
      opportunityId,
      message: "Opportunity missing.",
      sent: 0,
    };
  }

  if (Boolean(opp.is_mock) || isMockSourceUrl(String(opp.source_url ?? ""))) {
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "cancelled",
        last_error: "MOCK leads are excluded.",
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    await markOpportunityStage(supabase, opportunityId, "closed");
    return {
      ok: false,
      status: "failed",
      messageId,
      opportunityId,
      message: "MOCK lead excluded from send.",
      sent: 0,
    };
  }

  if (Boolean(opp.do_not_contact)) {
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "suppressed",
        last_error: "Lead marked do_not_contact.",
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    return {
      ok: true,
      status: "skipped",
      messageId,
      opportunityId,
      message: "Suppressed — do_not_contact.",
      sent: 0,
    };
  }

  const sender = String(claimed.approved_sender || claimed.sender_email);
  const recipient = String(claimed.approved_recipient || claimed.recipient_email);
  const subject = String(claimed.approved_subject || claimed.subject);
  const body = String(claimed.approved_body || claimed.body);
  const hash = String(claimed.approval_hash);

  if (!claimed.approved_at || !hashesMatch(hash, { sender, recipient, subject, body })) {
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "awaiting_approval",
        last_error: "Approval fingerprint mismatch — fresh approval required.",
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    await markOpportunityStage(supabase, opportunityId, "waiting");
    return {
      ok: false,
      status: "failed",
      messageId,
      opportunityId,
      message: "Approval invalidated before send.",
      sent: 0,
    };
  }

  const liveRecipient = normalizeEmail(String(opp.contact_email ?? ""));
  if (!liveRecipient || liveRecipient !== normalizeEmail(recipient)) {
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "awaiting_approval",
        last_error: "Recipient email changed on the lead — re-approve.",
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    await markOpportunityStage(supabase, opportunityId, "waiting");
    return {
      ok: false,
      status: "failed",
      messageId,
      opportunityId,
      message: "Recipient changed — re-approve required.",
      sent: 0,
    };
  }

  if (await isSuppressed(supabase, String(capped.company_id), recipient)) {
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "suppressed",
        last_error: "Recipient on suppression list.",
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    await markOpportunityStage(supabase, opportunityId, "closed");
    await loose(supabase)
      .from("ceo_opportunities")
      .update({ do_not_contact: true, updated_at: new Date().toISOString() })
      .eq("id", opportunityId);
    return {
      ok: true,
      status: "skipped",
      messageId,
      opportunityId,
      message: "Recipient suppressed (opt-out or bounce).",
      sent: 0,
    };
  }

  // Recheck eligibility immediately before send (and before any SES/fake provider call).
  const eligibility = await checkRecipientEligibility(supabase, {
    companyId: String(capped.company_id),
    opportunityId,
    recipientEmail: recipient,
    isFollowUp: Boolean(claimed.is_follow_up),
    serviceInterest: String(opp.service_interest ?? ""),
  });
  if (!eligibility.ok) {
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "awaiting_approval",
        last_error: eligibility.reason.slice(0, 2000),
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    await markOpportunityStage(supabase, opportunityId, "waiting");
    return {
      ok: false,
      status: "failed",
      messageId,
      opportunityId,
      message: eligibility.reason,
      sent: 0,
    };
  }

  const providerId = resolveProvider(capped);

  // Re-check the provider-specific daily cap under lease (fake ≠ SES).
  const freshConfig = await loadOutreachConfig(supabase);
  if (
    !freshConfig ||
    providerCapUsed(freshConfig, providerId) >= freshConfig.daily_send_cap
  ) {
    const used = freshConfig ? providerCapUsed(freshConfig, providerId) : capped.sends_today;
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "queued",
        last_error: `${providerId} daily cap hit during claim — requeued.`,
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    await markOpportunityStage(supabase, opportunityId, "queued");
    return {
      ok: true,
      status: "skipped",
      messageId,
      opportunityId,
      message: `${providerId} daily cap reached (${used}/${freshConfig?.daily_send_cap ?? capped.daily_send_cap}).`,
      sent: 0,
    };
  }

  if (providerId === "ses") {
    const sesGate = gateSesRecipient({
      liveEnabled: Boolean(freshConfig?.live_enabled ?? capped.live_enabled),
      recipientEmail: recipient,
      opportunitySource: String(opp.source ?? ""),
      sandboxRecipient:
        freshConfig?.ses_sandbox_recipient || capped.ses_sandbox_recipient || undefined,
    });
    if (!sesGate.ok) {
      await loose(supabase)
        .from("ceo_outreach_messages")
        .update({
          status: "awaiting_approval",
          last_error: sesGate.reason.slice(0, 2000),
          lease_token: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", messageId)
        .eq("lease_token", leaseToken);
      await markOpportunityStage(supabase, opportunityId, "waiting");
      return {
        ok: false,
        status: "failed",
        messageId,
        opportunityId,
        message: sesGate.reason,
        sent: 0,
      };
    }
  } else if (!(freshConfig?.live_enabled ?? capped.live_enabled) && trigger === "schedule") {
    // Fake schedule ticks are allowed while live is off (local only).
  }

  const provider = getOutreachProvider(providerId);
  const sendResult = await provider.send({
    senderEmail: sender,
    senderDisplayName: capped.sender_display_name || "Badger United",
    replyToEmail: String(claimed.reply_to_email || capped.reply_to_email),
    recipientEmail: recipient,
    subject,
    bodyText: body,
    idempotencyKey: String(claimed.idempotency_key),
  });

  if (!sendResult.ok) {
    const terminal = !sendResult.retryable;
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: terminal ? "failed" : "queued",
        last_error: sendResult.message.slice(0, 2000),
        provider: providerId,
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    await markOpportunityStage(
      supabase,
      opportunityId,
      terminal ? "needs_attention" : "queued",
    );
    return {
      ok: false,
      status: "failed",
      messageId,
      opportunityId,
      message: sendResult.message,
      sent: 0,
    };
  }

  if (sendResult.certainty === "uncertain") {
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "sending",
        needs_reconcile: true,
        provider: providerId,
        provider_message_id: sendResult.messageId,
        provider_raw_status: sendResult.rawStatus,
        last_error: "Provider response uncertain — reconciling before any retry.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    return {
      ok: true,
      status: "reconciled",
      messageId,
      opportunityId,
      message: "Provider uncertain — held for reconcile (no duplicate send).",
      sent: 0,
    };
  }

  const nowIso = new Date().toISOString();
  const bouncedImmediate = sendResult.rawStatus === "bounced_immediate";

  if (bouncedImmediate) {
    await addSuppression(supabase, {
      companyId: String(capped.company_id),
      email: recipient,
      reason: "bounce",
      messageId,
      note: sendResult.rawStatus,
    });
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "bounced",
        provider: providerId,
        provider_message_id: sendResult.messageId,
        provider_raw_status: sendResult.rawStatus,
        bounced_at: nowIso,
        lease_token: null,
        lease_expires_at: null,
        updated_at: nowIso,
      })
      .eq("id", messageId)
      .eq("lease_token", leaseToken);
    await markOpportunityStage(supabase, opportunityId, "bounced", {
      outreach_message_id: messageId,
    });
    return {
      ok: true,
      status: "completed",
      messageId,
      opportunityId,
      message: "Provider reported bounce — suppressed.",
      sent: 0,
    };
  }

  await loose(supabase)
    .from("ceo_outreach_messages")
    .update({
      status: "sent",
      provider: providerId,
      provider_message_id: sendResult.messageId,
      provider_raw_status: sendResult.rawStatus,
      sent_at: nowIso,
      needs_reconcile: false,
      lease_token: null,
      lease_expires_at: null,
      updated_at: nowIso,
      last_error: "",
    })
    .eq("id", messageId)
    .eq("lease_token", leaseToken);

  await markOpportunityStage(supabase, opportunityId, "sent", {
    sent_at: nowIso,
    outreach_message_id: messageId,
  });

  const quotaPatch =
    providerId === "fake"
      ? {
          fake_sends_today: (freshConfig?.fake_sends_today ?? capped.fake_sends_today) + 1,
          send_quota_day: today,
          last_blocker: "",
          updated_at: nowIso,
        }
      : {
          sends_today: (freshConfig?.sends_today ?? capped.sends_today) + 1,
          send_quota_day: today,
          last_blocker: "",
          updated_at: nowIso,
        };

  await loose(supabase)
    .from("ceo_outreach_config")
    .update(quotaPatch)
    .eq("id", capped.id);

  return {
    ok: true,
    status: "completed",
    messageId,
    opportunityId,
    message: `Sent via ${providerId}; provider message id recorded.`,
    sent: 1,
  };
}

/** Apply a verified provider delivery/bounce event (webhook or fake test). */
export async function applyProviderEvent(
  supabase: SupabaseClient,
  input: {
    providerMessageId: string;
    event: "delivered" | "bounced";
  },
): Promise<{ ok: boolean; message: string }> {
  const rowQuery = await loose(supabase)
    .from("ceo_outreach_messages")
    .select("id, opportunity_id, company_id, recipient_email, status")
    .eq("provider_message_id", input.providerMessageId)
    .maybeSingle();
  if (!rowQuery.data) return { ok: false, message: "Message not found for provider id." };
  const row = rowQuery.data as Record<string, unknown>;
  const now = new Date().toISOString();

  if (input.event === "delivered") {
    if (String(row.status) !== "sent" && String(row.status) !== "delivered") {
      return { ok: false, message: `Cannot mark delivered from status ${row.status}.` };
    }
    await loose(supabase)
      .from("ceo_outreach_messages")
      .update({
        status: "delivered",
        delivered_at: now,
        provider_raw_status: "delivered_event",
        updated_at: now,
      })
      .eq("id", String(row.id));
    await markOpportunityStage(supabase, String(row.opportunity_id), "delivered");
    return { ok: true, message: "Marked delivered from verified provider event." };
  }

  await addSuppression(supabase, {
    companyId: String(row.company_id),
    email: String(row.recipient_email),
    reason: "bounce",
    messageId: String(row.id),
  });
  await loose(supabase)
    .from("ceo_outreach_messages")
    .update({
      status: "bounced",
      bounced_at: now,
      provider_raw_status: "bounce_event",
      updated_at: now,
    })
    .eq("id", String(row.id));
  await markOpportunityStage(supabase, String(row.opportunity_id), "bounced");
  await loose(supabase)
    .from("ceo_opportunities")
    .update({ do_not_contact: true, updated_at: now })
    .eq("id", String(row.opportunity_id));
  return { ok: true, message: "Bounce recorded and recipient suppressed." };
}
