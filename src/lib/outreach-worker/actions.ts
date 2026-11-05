"use server";

import { revalidatePath } from "next/cache";
import { getAccessContext, hasFounderSurface } from "@/lib/access/session-access";
import { getSession } from "@/lib/auth/session";
import { isMockSourceUrl } from "@/lib/command/outreach";
import { loose } from "@/lib/db/loose";
import {
  appendComplianceFooter,
  assertNoInventedClaims,
  isValidBusinessEmail,
  normalizeEmail,
  requireSenderSetup,
} from "./compliance";
import {
  outreachEnvEnabled,
  outreachProviderFromEnv,
  outreachServiceClient,
  outreachSesSandboxToFromEnv,
} from "./db";
import {
  checkRecipientEligibility,
  isEligibilityKind,
  isEligibilityScope,
  scopeLabel,
} from "./eligibility";
import {
  approvalHash,
  messageIdempotencyKey,
  newOptOutToken,
} from "./hash";
import { loadOutreachConfig } from "./load";
import { SES_SANDBOX_SOURCE, gateSesRecipient } from "./sandbox";
import { runOutreachTick } from "./tick";

export type OutreachControlResult = { ok: true; notice: string } | { ok: false; error: string };

async function requireFounderOwnerOfOutreach() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { ok: false as const, error: "Sign in required." };
  }
  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!hasFounderSurface(access)) {
    return { ok: false as const, error: "Founder access required." };
  }
  const config = await loadOutreachConfig(session.supabase);
  if (!config) {
    return {
      ok: false as const,
      error: "Outreach config missing. Apply migration 20261105160000_ceo_outreach_worker.sql.",
    };
  }
  const companyId = config.company_id ?? "";
  if (!companyId || !access.ownedCompanyIds.includes(companyId)) {
    return { ok: false as const, error: "You must own Badger United to control Outreach." };
  }
  return { ok: true as const, session, access, config, companyId };
}

function publicAppOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.GHOST_PUBLIC_APP_URL?.trim() ||
    "http://127.0.0.1:3012"
  );
}

export async function updateOutreachWorkerSettings(
  formData: FormData,
): Promise<OutreachControlResult> {
  const auth = await requireFounderOwnerOfOutreach();
  if (!auth.ok) return { ok: false, error: auth.error };

  const senderEmail = String(formData.get("senderEmail") ?? "").trim().toLowerCase();
  const replyToEmail = String(formData.get("replyToEmail") ?? "").trim().toLowerCase();
  const postalAddress = String(formData.get("postalAddress") ?? "").trim();
  const commercialIdentity = String(formData.get("commercialIdentity") ?? "Badger United").trim();
  const senderDisplayName = String(formData.get("senderDisplayName") ?? "Badger United").trim();
  const dailySendCap = Math.min(
    200,
    Math.max(1, Number(formData.get("dailySendCap") ?? auth.config.daily_send_cap) || 5),
  );
  const windowStartHour = Math.min(
    23,
    Math.max(0, Number(formData.get("windowStartHour") ?? auth.config.window_start_hour) || 9),
  );
  const windowEndHour = Math.min(
    24,
    Math.max(1, Number(formData.get("windowEndHour") ?? auth.config.window_end_hour) || 17),
  );
  const sesSandboxRecipient = String(
    formData.get("sesSandboxRecipient") ?? auth.config.ses_sandbox_recipient ?? "",
  )
    .trim()
    .toLowerCase();

  if (senderEmail && !isValidBusinessEmail(senderEmail)) {
    return { ok: false, error: "Sender email looks invalid." };
  }
  if (replyToEmail && !isValidBusinessEmail(replyToEmail)) {
    return { ok: false, error: "Reply-to email looks invalid." };
  }
  if (sesSandboxRecipient && !isValidBusinessEmail(sesSandboxRecipient)) {
    return { ok: false, error: "SES sandbox recipient looks invalid." };
  }

  const updated = await loose(auth.session.supabase)
    .from("ceo_outreach_config")
    .update({
      sender_email: senderEmail.slice(0, 320),
      reply_to_email: replyToEmail.slice(0, 320),
      postal_address: postalAddress.slice(0, 500),
      commercial_identity: commercialIdentity.slice(0, 120) || "Badger United",
      sender_display_name: senderDisplayName.slice(0, 120) || "Badger United",
      daily_send_cap: dailySendCap,
      window_start_hour: windowStartHour,
      window_end_hour: windowEndHour,
      ses_sandbox_recipient: sesSandboxRecipient.slice(0, 320),
      provider: outreachProviderFromEnv(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.config.id)
    .select("id")
    .maybeSingle();

  if (updated.error) return { ok: false, error: updated.error.message };
  revalidatePath("/command");
  return { ok: true, notice: "Outreach settings saved. Live sending stays off until you enable it." };
}

/**
 * Prepare (do not auto-send) one SES sandbox probe to the founder-owned verified inbox.
 * Keeps live_enabled=false. Never targets a prospect lead.
 */
export async function prepareSesSandboxProbe(
  formData: FormData,
): Promise<OutreachControlResult> {
  const auth = await requireFounderOwnerOfOutreach();
  if (!auth.ok) return { ok: false, error: auth.error };

  const sandboxTo =
    normalizeEmail(String(formData.get("sesSandboxRecipient") ?? "")) ||
    normalizeEmail(auth.config.ses_sandbox_recipient) ||
    outreachSesSandboxToFromEnv();
  if (!isValidBusinessEmail(sandboxTo)) {
    return {
      ok: false,
      error:
        "Set your verified SES sandbox inbox (GHOST_OUTREACH_SES_SANDBOX_TO or the sandbox field). Never a prospect.",
    };
  }

  const gate = gateSesRecipient({
    liveEnabled: false,
    recipientEmail: sandboxTo,
    opportunitySource: SES_SANDBOX_SOURCE,
    sandboxRecipient: sandboxTo,
  });
  if (!gate.ok) return { ok: false, error: gate.reason };

  const setup = requireSenderSetup({
    senderEmail: auth.config.sender_email,
    replyToEmail: auth.config.reply_to_email,
    postalAddress: auth.config.postal_address,
    commercialIdentity: auth.config.commercial_identity,
  });
  if (!setup.ok) return { ok: false, error: setup.reason };

  const now = new Date().toISOString();
  const subject = "Ghost SES sandbox probe (founder inbox only)";
  const bodyRaw =
    "This is a single SES sandbox probe to a verified inbox you own. It is not a prospect send. Live Outreach remains off.";

  // Reuse or create the non-prospect sandbox opportunity.
  let opportunityId = "";
  const existingOpp = await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .select("id")
    .eq("company_id", auth.companyId)
    .eq("source", SES_SANDBOX_SOURCE)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingOpp.data?.id) {
    opportunityId = String(existingOpp.data.id);
    await loose(auth.session.supabase)
      .from("ceo_opportunities")
      .update({
        contact_email: sandboxTo,
        outreach_stage: "waiting",
        outreach_subject: subject,
        outreach_draft: bodyRaw,
        do_not_contact: false,
        is_mock: false,
        updated_at: now,
      })
      .eq("id", opportunityId);
  } else {
    const insertedOpp = await loose(auth.session.supabase)
      .from("ceo_opportunities")
      .insert({
        owner_id: auth.session.user.id,
        company_id: auth.companyId,
        title: "SES Sandbox Probe (founder inbox)",
        value_cents: 0,
        currency: "USD",
        score: 0,
        geography: "sandbox",
        status: "SANDBOX",
        source: SES_SANDBOX_SOURCE,
        fit_reason: "Founder-owned SES sandbox probe — not a prospect.",
        source_url: `https://sandbox.local/ses-probe/${Date.now()}`,
        contact_email: sandboxTo,
        outreach_stage: "waiting",
        service_interest: "",
        industry: "",
        market: "",
        is_mock: false,
        outreach_draft: bodyRaw,
        outreach_subject: subject,
        do_not_contact: false,
      })
      .select("id")
      .maybeSingle();
    if (insertedOpp.error || !insertedOpp.data?.id) {
      return { ok: false, error: insertedOpp.error?.message ?? "Could not create sandbox opportunity." };
    }
    opportunityId = String(insertedOpp.data.id);
  }

  // Eligibility for commercial_introduction scope (no service interest on probe).
  await loose(auth.session.supabase).from("ceo_outreach_eligibility").insert({
    company_id: auth.companyId,
    opportunity_id: opportunityId,
    recipient_email: sandboxTo,
    kind: "opt_in",
    source: "Founder verified SES sandbox inbox (self)",
    scope: "commercial_introduction",
    recorded_at: now,
    recorded_by: auth.session.user.id,
    notes: "Sandbox probe only — not a prospect permission.",
  });

  await loose(auth.session.supabase)
    .from("ceo_outreach_config")
    .update({
      ses_sandbox_recipient: sandboxTo,
      live_enabled: false,
      updated_at: now,
    })
    .eq("id", auth.config.id);

  revalidatePath("/command");
  return {
    ok: true,
    notice: `SES sandbox probe prepared for ${sandboxTo} (live stays off). Approve & queue that lead, set GHOST_OUTREACH_PROVIDER=ses, then Run now. Prospects remain blocked.`,
  };
}

export async function setOutreachLiveEnabled(formData: FormData): Promise<OutreachControlResult> {
  const auth = await requireFounderOwnerOfOutreach();
  if (!auth.ok) return { ok: false, error: auth.error };
  const enabled = String(formData.get("enabled") ?? "") === "1";

  if (enabled) {
    const gate = requireSenderSetup({
      senderEmail: auth.config.sender_email,
      replyToEmail: auth.config.reply_to_email,
      postalAddress: auth.config.postal_address,
      commercialIdentity: auth.config.commercial_identity,
    });
    if (!gate.ok) return { ok: false, error: gate.reason };
  }

  const updated = await loose(auth.session.supabase)
    .from("ceo_outreach_config")
    .update({
      live_enabled: enabled,
      paused: enabled ? false : auth.config.paused,
      last_blocker: enabled ? "" : "Live sending disabled by founder.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.config.id);
  if (updated.error) return { ok: false, error: updated.error.message };
  revalidatePath("/command");
  return {
    ok: true,
    notice: enabled
      ? outreachEnvEnabled()
        ? "Live sending enabled. Keep npm run outreach-workers running inside business hours."
        : "DB live enabled. Also set GHOST_OUTREACH_ENABLED=1 and run outreach-workers."
      : "Live sending disabled.",
  };
}

export async function pauseOutreachWorker(): Promise<OutreachControlResult> {
  const auth = await requireFounderOwnerOfOutreach();
  if (!auth.ok) return { ok: false, error: auth.error };
  const updated = await loose(auth.session.supabase)
    .from("ceo_outreach_config")
    .update({
      paused: true,
      last_blocker: "Outreach paused by founder.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.config.id);
  if (updated.error) return { ok: false, error: updated.error.message };
  revalidatePath("/command");
  return { ok: true, notice: "Outreach paused." };
}

export async function resumeOutreachWorker(): Promise<OutreachControlResult> {
  const auth = await requireFounderOwnerOfOutreach();
  if (!auth.ok) return { ok: false, error: auth.error };
  const updated = await loose(auth.session.supabase)
    .from("ceo_outreach_config")
    .update({
      paused: false,
      last_blocker: "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.config.id);
  if (updated.error) return { ok: false, error: updated.error.message };
  revalidatePath("/command");
  return { ok: true, notice: "Outreach resumed (still respects live_enabled and business hours)." };
}

export async function runOutreachWorkerNow(): Promise<OutreachControlResult> {
  const auth = await requireFounderOwnerOfOutreach();
  if (!auth.ok) return { ok: false, error: auth.error };
  try {
    const admin = outreachServiceClient();
    const result = await runOutreachTick(admin, {
      trigger: "manual",
      forceEnvBypass: true,
      publicBaseUrl: publicAppOrigin(),
    });
    revalidatePath("/command");
    if (result.ok || result.status === "skipped" || result.status === "reconciled") {
      return { ok: true, notice: result.message };
    }
    return { ok: false, error: result.message };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Outreach tick failed.",
    };
  }
}

/**
 * Record opt-in or a documented recipient request for an exact email scope.
 * Public email discovery (Will/Bubba) is not eligibility by itself.
 */
export async function recordOutreachEligibility(
  formData: FormData,
): Promise<OutreachControlResult> {
  const auth = await requireFounderOwnerOfOutreach();
  if (!auth.ok) return { ok: false, error: auth.error };

  const opportunityId = String(formData.get("opportunityId") ?? "").trim();
  const recipientEmail = normalizeEmail(String(formData.get("recipientEmail") ?? ""));
  const kindRaw = String(formData.get("kind") ?? "").trim();
  const scopeRaw = String(formData.get("scope") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const recordedAtRaw = String(formData.get("recordedAt") ?? "").trim();

  if (!opportunityId) return { ok: false, error: "Missing opportunity." };
  if (!isValidBusinessEmail(recipientEmail)) {
    return { ok: false, error: "Recipient email required for eligibility." };
  }
  if (!isEligibilityKind(kindRaw)) {
    return { ok: false, error: "Kind must be opt_in or documented_request." };
  }
  if (!isEligibilityScope(scopeRaw)) {
    return { ok: false, error: "Select the exact email scope this permission covers." };
  }
  if (source.length < 3) {
    return {
      ok: false,
      error: "Record the source (e.g. reply email, voicemail, signed form, meeting note).",
    };
  }

  let recordedAt = new Date().toISOString();
  if (recordedAtRaw) {
    const parsed = new Date(recordedAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Permission date looks invalid." };
    }
    if (parsed.getTime() > Date.now() + 60_000) {
      return { ok: false, error: "Permission date cannot be in the future." };
    }
    recordedAt = parsed.toISOString();
  }

  const existing = await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .select("id, company_id, contact_email, is_mock, source_url, do_not_contact")
    .eq("id", opportunityId)
    .maybeSingle();
  if (existing.error) return { ok: false, error: existing.error.message };
  if (!existing.data) return { ok: false, error: "Lead not found." };
  const row = existing.data as Record<string, unknown>;
  if (String(row.company_id) !== auth.companyId) {
    return { ok: false, error: "Lead is not in Badger United scope." };
  }
  if (Boolean(row.is_mock) || isMockSourceUrl(String(row.source_url ?? ""))) {
    return { ok: false, error: "MOCK leads cannot receive outreach eligibility." };
  }
  if (Boolean(row.do_not_contact)) {
    return { ok: false, error: "Lead is marked do not contact." };
  }

  const inserted = await loose(auth.session.supabase)
    .from("ceo_outreach_eligibility")
    .insert({
      company_id: auth.companyId,
      opportunity_id: opportunityId,
      recipient_email: recipientEmail,
      kind: kindRaw,
      source: source.slice(0, 500),
      scope: scopeRaw,
      recorded_at: recordedAt,
      recorded_by: auth.session.user.id,
      notes: notes.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (inserted.error) return { ok: false, error: inserted.error.message };

  // Keep verified email on the lead when recording permission.
  await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .update({
      contact_email: recipientEmail,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opportunityId)
    .eq("company_id", auth.companyId);

  revalidatePath("/command");
  return {
    ok: true,
    notice: `Recorded ${kindRaw === "opt_in" ? "opt-in" : "documented request"} for ${scopeLabel(scopeRaw)}. Will/Bubba leads stay reviewable; Approve & queue is unlocked for that scope.`,
  };
}

/**
 * Approve exact sender/recipient/subject/body and enqueue for Outreach.
 * Opening a mailto draft must never call this.
 * Founder approval alone cannot queue without recipient eligibility.
 */
export async function approveAndQueueOutreach(
  formData: FormData,
): Promise<OutreachControlResult> {
  const auth = await requireFounderOwnerOfOutreach();
  if (!auth.ok) return { ok: false, error: auth.error };

  const opportunityId = String(formData.get("opportunityId") ?? "").trim();
  const recipientEmail = normalizeEmail(String(formData.get("recipientEmail") ?? ""));
  const subject = String(formData.get("subject") ?? "").trim();
  const bodyRaw = String(formData.get("body") ?? "").replace(/\r\n/g, "\n").trim();
  const isFollowUp = String(formData.get("isFollowUp") ?? "") === "1";

  if (!opportunityId) return { ok: false, error: "Missing opportunity." };
  if (!isValidBusinessEmail(recipientEmail)) {
    return { ok: false, error: "Enter a verified public business email before approving." };
  }
  if (subject.length < 3) return { ok: false, error: "Subject is required." };
  if (bodyRaw.length < 20) return { ok: false, error: "Message body is too short." };

  const claims = assertNoInventedClaims(bodyRaw);
  if (!claims.ok) return { ok: false, error: claims.reason };

  const setup = requireSenderSetup({
    senderEmail: auth.config.sender_email,
    replyToEmail: auth.config.reply_to_email,
    postalAddress: auth.config.postal_address,
    commercialIdentity: auth.config.commercial_identity,
  });
  if (!setup.ok) return { ok: false, error: setup.reason };

  const existing = await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .select(
      "id, company_id, owner_id, title, contact_email, source_url, is_mock, do_not_contact, outreach_stage, outreach_draft, service_interest",
    )
    .eq("id", opportunityId)
    .maybeSingle();

  if (existing.error) return { ok: false, error: existing.error.message };
  if (!existing.data) return { ok: false, error: "Lead not found." };
  const row = existing.data as Record<string, unknown>;
  if (String(row.company_id) !== auth.companyId) {
    return { ok: false, error: "Lead is not in Badger United scope." };
  }
  if (Boolean(row.is_mock) || isMockSourceUrl(String(row.source_url ?? ""))) {
    return { ok: false, error: "MOCK leads are excluded from Outreach." };
  }
  if (Boolean(row.do_not_contact)) {
    return { ok: false, error: "This lead is marked do not contact." };
  }

  const stage = String(row.outreach_stage ?? "waiting");
  const allowedStages = new Set(["waiting", "queued", "needs_attention", "sent", "delivered"]);
  if (!allowedStages.has(stage)) {
    return { ok: false, error: `Cannot approve from stage ${stage}.` };
  }
  if (isFollowUp && stage !== "sent" && stage !== "delivered") {
    return { ok: false, error: "Follow-ups require a prior sent/delivered lead." };
  }
  if (!isFollowUp && stage !== "waiting" && stage !== "queued" && stage !== "needs_attention") {
    return { ok: false, error: "Approve & queue is for Waiting for approval leads." };
  }

  const suppressed = await loose(auth.session.supabase)
    .from("ceo_outreach_suppressions")
    .select("id, reason")
    .eq("company_id", auth.companyId)
    .eq("email", recipientEmail)
    .maybeSingle();
  if (suppressed.data) {
    return {
      ok: false,
      error: `Recipient is suppressed (${String((suppressed.data as { reason?: string }).reason)}).`,
    };
  }

  // Recheck eligibility at queue time — founder approval is not enough.
  const eligibility = await checkRecipientEligibility(auth.session.supabase, {
    companyId: auth.companyId,
    opportunityId,
    recipientEmail,
    isFollowUp,
    serviceInterest: String(row.service_interest ?? ""),
  });
  if (!eligibility.ok) {
    return { ok: false, error: eligibility.reason };
  }

  const optOutToken = newOptOutToken();
  const optOutUrl = `${publicAppOrigin()}/api/outreach/opt-out?token=${optOutToken}`;
  const body = appendComplianceFooter({
    body: bodyRaw,
    commercialIdentity: auth.config.commercial_identity,
    postalAddress: auth.config.postal_address,
    optOutUrl,
  });

  const sender = normalizeEmail(auth.config.sender_email);
  const hash = approvalHash({ sender, recipient: recipientEmail, subject, body });
  const idempotencyKey = messageIdempotencyKey(opportunityId, hash, isFollowUp);
  const now = new Date().toISOString();

  // Cancel any prior queued/awaiting row for this opportunity (non-terminal).
  await loose(auth.session.supabase)
    .from("ceo_outreach_messages")
    .update({
      status: "cancelled",
      last_error: "Superseded by fresh approval.",
      updated_at: now,
      lease_token: null,
      lease_expires_at: null,
    })
    .eq("opportunity_id", opportunityId)
    .in("status", ["awaiting_approval", "queued", "failed"]);

  const inserted = await loose(auth.session.supabase)
    .from("ceo_outreach_messages")
    .insert({
      opportunity_id: opportunityId,
      company_id: auth.companyId,
      owner_id: auth.session.user.id,
      status: "queued",
      sender_email: sender,
      reply_to_email: normalizeEmail(auth.config.reply_to_email),
      recipient_email: recipientEmail,
      subject: subject.slice(0, 300),
      body: body.slice(0, 8000),
      approval_hash: hash,
      approved_at: now,
      approved_by: auth.session.user.id,
      approved_sender: sender,
      approved_recipient: recipientEmail,
      approved_subject: subject.slice(0, 300),
      approved_body: body.slice(0, 8000),
      idempotency_key: idempotencyKey,
      provider: outreachProviderFromEnv(),
      opt_out_token: optOutToken,
      is_follow_up: isFollowUp,
      eligibility_id: eligibility.record.id,
      eligibility_scope: eligibility.requiredScope,
      queued_at: now,
      updated_at: now,
    })
    .select("id")
    .maybeSingle();

  if (inserted.error) {
    if (/duplicate|unique|idempotency/i.test(inserted.error.message)) {
      return {
        ok: false,
        error: "This exact message was already approved/queued (idempotent).",
      };
    }
    return { ok: false, error: inserted.error.message };
  }

  const messageRowId = String((inserted.data as { id?: string } | null)?.id ?? "");
  await loose(auth.session.supabase)
    .from("ceo_opportunities")
    .update({
      contact_email: recipientEmail,
      outreach_subject: subject.slice(0, 300),
      outreach_draft: bodyRaw.slice(0, 4000),
      outreach_stage: "queued",
      outreach_message_id: messageRowId || null,
      updated_at: now,
    })
    .eq("id", opportunityId)
    .eq("company_id", auth.companyId);

  revalidatePath("/command");
  return {
    ok: true,
    notice:
      "Approved & queued for Outreach. Opening a draft does not send. Live worker sends only when enabled, unpaused, under cap, and in business hours.",
  };
}

/** Invalidate queued approval when founder edits recipient/subject/body. */
export async function invalidateOutreachApprovalIfChanged(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  opportunityId: string;
  companyId: string;
  recipientEmail?: string;
  subject?: string;
  body?: string;
}): Promise<void> {
  const latest = await loose(input.supabase)
    .from("ceo_outreach_messages")
    .select(
      "id, status, approved_recipient, approved_subject, approved_body",
    )
    .eq("opportunity_id", input.opportunityId)
    .in("status", ["queued", "awaiting_approval"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest.data) return;
  const row = latest.data as Record<string, unknown>;
  const approvedRecipient = normalizeEmail(String(row.approved_recipient ?? ""));
  const approvedSubject = String(row.approved_subject ?? "").trim();
  const approvedBody = String(row.approved_body ?? "").replace(/\r\n/g, "\n");
  const recipient = normalizeEmail(input.recipientEmail ?? approvedRecipient);
  const subject = (input.subject ?? approvedSubject).trim();
  const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();

  const recipientChanged = recipient !== approvedRecipient;
  const subjectChanged = subject.length > 0 && subject !== approvedSubject;
  // Draft body is stored without compliance footer; approved body includes footer.
  const bodyChanged =
    body.length > 0 &&
    !approvedBody.startsWith(body) &&
    approvedBody.trim() !== body;

  if (!recipientChanged && !subjectChanged && !bodyChanged) return;

  const now = new Date().toISOString();
  await loose(input.supabase)
    .from("ceo_outreach_messages")
    .update({
      status: "awaiting_approval",
      last_error: "Content changed after approval — fresh Approve & queue required.",
      updated_at: now,
      lease_token: null,
      lease_expires_at: null,
    })
    .eq("id", String(row.id));

  await loose(input.supabase)
    .from("ceo_opportunities")
    .update({
      outreach_stage: "waiting",
      updated_at: now,
    })
    .eq("id", input.opportunityId)
    .eq("company_id", input.companyId)
    .in("outreach_stage", ["queued", "waiting"]);
}
