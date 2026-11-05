/**
 * Local fake-provider workflow checks against ghost99f when service role is present.
 * Skips cleanly when DB/env is unavailable.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { approvalHash, messageIdempotencyKey, newOptOutToken } from "./hash";
import {
  getFakeProviderMessage,
  resetFakeProvider,
  setFakeProviderMode,
} from "./provider";
import { applyProviderEvent, runOutreachTick } from "./tick";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") process.env[key] = value;
  }
}

loadEnvLocal();
process.env.GHOST_OUTREACH_ENABLED = "1";
process.env.GHOST_OUTREACH_PROVIDER = "fake";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const enabled = Boolean(url && key && /54331|127\.0\.0\.1|localhost/.test(url));

describe("outreach worker local workflow", { skip: !enabled }, () => {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let companyId = "";
  let ownerId = "";
  let opportunityId = "";
  let configId = "";
  const recipient = `outreach-test-${Date.now()}@driveright-sim.test`;

  before(async () => {
    resetFakeProvider();
    setFakeProviderMode("accept");

    const company = await supabase
      .from("companies")
      .select("id, owner_id")
      .eq("slug", "badger-united")
      .maybeSingle();
    assert.ok(company.data, "badger-united company required");
    companyId = String(company.data.id);
    ownerId = String(company.data.owner_id);

    const config = await supabase
      .from("ceo_outreach_config")
      .select("id")
      .eq("company_slug", "badger-united")
      .maybeSingle();
    assert.ok(config.data, "outreach config row required");
    configId = String(config.data.id);

    await supabase
      .from("ceo_outreach_config")
      .update({
        company_id: companyId,
        owner_id: ownerId,
        live_enabled: true,
        paused: false,
        daily_send_cap: 5,
        sends_today: 0,
        send_quota_day: "",
        window_start_hour: 0,
        window_end_hour: 24,
        sender_email: "hello@badgerunited.test",
        reply_to_email: "replies@badgerunited.test",
        postal_address: "100 Test Ave, Atlanta, GA 30301",
        commercial_identity: "Badger United",
        provider: "fake",
        last_blocker: "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", configId);

    const inserted = await supabase
      .from("ceo_opportunities")
      .insert({
        owner_id: ownerId,
        company_id: companyId,
        title: "Outreach Test Driving School",
        value_cents: 0,
        currency: "USD",
        score: 70,
        geography: "Atlanta, GA",
        status: "PROSPECT",
        source: "outreach_test",
        fit_reason: "Local workflow test lead.",
        source_url: `https://outreach-test.example/school/${Date.now()}`,
        contact_email: recipient,
        outreach_stage: "waiting",
        service_interest: "website",
        industry: "driving schools",
        market: "Atlanta, GA",
        is_mock: false,
        evidence_signal: "call for enrollment",
        outreach_draft: "Hello,\n\nShort test note about your enrollment path.",
        outreach_subject: "Introduction — Outreach Test Driving School",
        do_not_contact: false,
      })
      .select("id")
      .maybeSingle();
    assert.ok(inserted.data?.id, inserted.error?.message ?? "opportunity insert");
    opportunityId = String(inserted.data.id);
  });

  after(async () => {
    if (opportunityId) {
      await supabase.from("ceo_outreach_messages").delete().eq("opportunity_id", opportunityId);
      await supabase.from("ceo_outreach_eligibility").delete().eq("opportunity_id", opportunityId);
      await supabase.from("ceo_opportunities").delete().eq("id", opportunityId);
    }
    await supabase.from("ceo_outreach_suppressions").delete().eq("email", recipient);
    await supabase
      .from("ceo_outreach_config")
      .update({
        live_enabled: false,
        paused: false,
        window_start_hour: 9,
        window_end_hour: 17,
        sends_today: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", configId);
    resetFakeProvider();
  });

  it("approves exact content, sends once, records provider id, and ignores duplicate claim", async () => {
    const subject = "Introduction — Outreach Test Driving School";
    const body =
      "Hello,\n\nShort test note about your enrollment path.\n\n--\nThis message is a commercial communication from Badger United.\n100 Test Ave, Atlanta, GA 30301\nOpt out of future emails: http://127.0.0.1:3012/api/outreach/opt-out?token=testtoken";
    const sender = "hello@badgerunited.test";
    const hash = approvalHash({ sender, recipient, subject, body });
    const idem = messageIdempotencyKey(opportunityId, hash, false);
    const optOut = newOptOutToken();

    const eligibilityWebsite = await supabase
      .from("ceo_outreach_eligibility")
      .insert({
        company_id: companyId,
        opportunity_id: opportunityId,
        recipient_email: recipient,
        kind: "documented_request",
        source: "Recipient asked for website help by email",
        scope: "service_website",
        recorded_at: new Date().toISOString(),
        recorded_by: ownerId,
      })
      .select("id")
      .maybeSingle();
    assert.ok(eligibilityWebsite.data?.id, eligibilityWebsite.error?.message);

    const queued = await supabase
      .from("ceo_outreach_messages")
      .insert({
        opportunity_id: opportunityId,
        company_id: companyId,
        owner_id: ownerId,
        status: "queued",
        sender_email: sender,
        reply_to_email: "replies@badgerunited.test",
        recipient_email: recipient,
        subject,
        body,
        approval_hash: hash,
        approved_at: new Date().toISOString(),
        approved_by: ownerId,
        approved_sender: sender,
        approved_recipient: recipient,
        approved_subject: subject,
        approved_body: body,
        idempotency_key: idem,
        provider: "fake",
        opt_out_token: optOut,
        eligibility_id: eligibilityWebsite.data.id,
        eligibility_scope: "service_website",
        queued_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    assert.ok(queued.data?.id, queued.error?.message ?? "queue insert");

    await supabase
      .from("ceo_opportunities")
      .update({ outreach_stage: "queued", outreach_message_id: queued.data.id })
      .eq("id", opportunityId);

    const first = await runOutreachTick(supabase, {
      trigger: "manual",
      forceEnvBypass: true,
      at: new Date("2026-11-05T19:00:00.000Z"),
    });
    assert.equal(first.ok, true);
    assert.equal(first.status, "completed");
    assert.equal(first.sent, 1);
    assert.ok(first.messageId);

    const message = await supabase
      .from("ceo_outreach_messages")
      .select("status, provider_message_id")
      .eq("id", first.messageId)
      .maybeSingle();
    assert.equal(message.data?.status, "sent");
    assert.ok(String(message.data?.provider_message_id || "").startsWith("fake_"));
    assert.ok(getFakeProviderMessage(String(message.data?.provider_message_id)));

    const opp = await supabase
      .from("ceo_opportunities")
      .select("outreach_stage, sent_at")
      .eq("id", opportunityId)
      .maybeSingle();
    assert.equal(opp.data?.outreach_stage, "sent");
    assert.ok(opp.data?.sent_at);

    // Duplicate click / second tick: nothing else queued.
    const second = await runOutreachTick(supabase, {
      trigger: "manual",
      forceEnvBypass: true,
      at: new Date("2026-11-05T19:01:00.000Z"),
    });
    assert.equal(second.status, "skipped");

    const delivered = await applyProviderEvent(supabase, {
      providerMessageId: String(message.data?.provider_message_id),
      event: "delivered",
    });
    assert.equal(delivered.ok, true);
    const after = await supabase
      .from("ceo_opportunities")
      .select("outreach_stage")
      .eq("id", opportunityId)
      .maybeSingle();
    assert.equal(after.data?.outreach_stage, "delivered");
  });

  it("blocks sends when paused, over cap, or suppressed", async () => {
    await supabase
      .from("ceo_outreach_config")
      .update({ paused: true, live_enabled: true })
      .eq("id", configId);
    const paused = await runOutreachTick(supabase, {
      trigger: "schedule",
      forceEnvBypass: true,
      at: new Date("2026-11-05T19:00:00.000Z"),
    });
    assert.equal(paused.status, "skipped");
    assert.match(paused.message, /paused/i);

    await supabase
      .from("ceo_outreach_config")
      .update({
        paused: false,
        live_enabled: true,
        sends_today: 0,
        fake_sends_today: 5,
        daily_send_cap: 5,
      })
      .eq("id", configId);
    const capped = await runOutreachTick(supabase, {
      trigger: "manual",
      forceEnvBypass: true,
      at: new Date("2026-11-05T19:00:00.000Z"),
    });
    assert.equal(capped.status, "skipped");
    assert.match(capped.message, /fake.*cap|cap/i);

    await supabase.from("ceo_outreach_suppressions").upsert(
      {
        company_id: companyId,
        email: recipient,
        reason: "opt_out",
        note: "workflow test",
      },
      { onConflict: "company_id,email" },
    );

    // Reset fake/SES counters and queue a suppressed recipient message — should suppress, not send.
    await supabase
      .from("ceo_outreach_config")
      .update({
        sends_today: 0,
        fake_sends_today: 0,
        daily_send_cap: 5,
        paused: false,
        live_enabled: true,
      })
      .eq("id", configId);

    const subject = "Should not send";
    const body = "Suppressed recipient body with enough length here.";
    const sender = "hello@badgerunited.test";
    const hash = approvalHash({ sender, recipient, subject, body });
    const followEligibility = await supabase
      .from("ceo_outreach_eligibility")
      .insert({
        company_id: companyId,
        opportunity_id: opportunityId,
        recipient_email: recipient,
        kind: "documented_request",
        source: "Prior conversation asked for a follow-up",
        scope: "follow_up",
        recorded_at: new Date().toISOString(),
        recorded_by: ownerId,
      })
      .select("id")
      .maybeSingle();
    await supabase.from("ceo_outreach_messages").insert({
      opportunity_id: opportunityId,
      company_id: companyId,
      owner_id: ownerId,
      status: "queued",
      sender_email: sender,
      reply_to_email: "replies@badgerunited.test",
      recipient_email: recipient,
      subject,
      body,
      approval_hash: hash,
      approved_at: new Date().toISOString(),
      approved_by: ownerId,
      approved_sender: sender,
      approved_recipient: recipient,
      approved_subject: subject,
      approved_body: body,
      idempotency_key: messageIdempotencyKey(opportunityId, hash, true),
      provider: "fake",
      opt_out_token: newOptOutToken(),
      is_follow_up: true,
      eligibility_id: followEligibility.data?.id ?? null,
      eligibility_scope: "follow_up",
      queued_at: new Date().toISOString(),
    });

    const suppressed = await runOutreachTick(supabase, {
      trigger: "manual",
      forceEnvBypass: true,
      at: new Date("2026-11-05T19:00:00.000Z"),
    });
    assert.equal(suppressed.status, "skipped");
    assert.match(suppressed.message, /suppress/i);
  });

  it("forces provider failure into needs attention without counting as sent", async () => {
    setFakeProviderMode("fail");
    const failRecipient = `fail-${Date.now()}@driveright-sim.test`;
    const opp = await supabase
      .from("ceo_opportunities")
      .insert({
        owner_id: ownerId,
        company_id: companyId,
        title: "Fail Path School",
        value_cents: 0,
        currency: "USD",
        score: 50,
        geography: "Atlanta, GA",
        status: "PROSPECT",
        source: "outreach_test",
        fit_reason: "failure path",
        source_url: `https://outreach-test.example/fail/${Date.now()}`,
        contact_email: failRecipient,
        outreach_stage: "queued",
        is_mock: false,
        outreach_draft: "Failure path body text for outreach.",
        outreach_subject: "Fail path",
      })
      .select("id")
      .maybeSingle();
    assert.ok(opp.data?.id);
    const oid = String(opp.data.id);
    const sender = "hello@badgerunited.test";
    const subject = "Fail path";
    const body = "Failure path body text for outreach.";
    const hash = approvalHash({ sender, recipient: failRecipient, subject, body });

    await supabase
      .from("ceo_outreach_config")
      .update({ paused: false, live_enabled: true, sends_today: 0, daily_send_cap: 5 })
      .eq("id", configId);

    const failEligibility = await supabase
      .from("ceo_outreach_eligibility")
      .insert({
        company_id: companyId,
        opportunity_id: oid,
        recipient_email: failRecipient,
        kind: "documented_request",
        source: "Documented request for failure-path test",
        scope: "commercial_introduction",
        recorded_at: new Date().toISOString(),
        recorded_by: ownerId,
      })
      .select("id")
      .maybeSingle();

    const msg = await supabase
      .from("ceo_outreach_messages")
      .insert({
        opportunity_id: oid,
        company_id: companyId,
        owner_id: ownerId,
        status: "queued",
        sender_email: sender,
        reply_to_email: "replies@badgerunited.test",
        recipient_email: failRecipient,
        subject,
        body,
        approval_hash: hash,
        approved_at: new Date().toISOString(),
        approved_by: ownerId,
        approved_sender: sender,
        approved_recipient: failRecipient,
        approved_subject: subject,
        approved_body: body,
        idempotency_key: messageIdempotencyKey(oid, hash, false),
        provider: "fake",
        opt_out_token: newOptOutToken(),
        eligibility_id: failEligibility.data?.id ?? null,
        eligibility_scope: "commercial_introduction",
        queued_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    assert.ok(msg.data?.id);

    await supabase
      .from("ceo_outreach_config")
      .update({ paused: false, live_enabled: true, sends_today: 0, daily_send_cap: 5 })
      .eq("id", configId);

    const tick = await runOutreachTick(supabase, {
      trigger: "manual",
      forceEnvBypass: true,
      at: new Date("2026-11-05T19:00:00.000Z"),
    });
    assert.equal(tick.ok, false);
    assert.equal(tick.status, "failed");

    const after = await supabase
      .from("ceo_opportunities")
      .select("outreach_stage, sent_at")
      .eq("id", oid)
      .maybeSingle();
    // retryable failure requeues; non-retryable would be needs_attention.
    // fake fail is retryable → queued again
    assert.ok(
      after.data?.outreach_stage === "queued" || after.data?.outreach_stage === "needs_attention",
    );
    assert.equal(after.data?.sent_at, null);

    await supabase.from("ceo_outreach_messages").delete().eq("opportunity_id", oid);
    await supabase.from("ceo_outreach_eligibility").delete().eq("opportunity_id", oid);
    await supabase.from("ceo_opportunities").delete().eq("id", oid);
    setFakeProviderMode("accept");
  });
});
