/**
 * Eligibility gates: founder approval alone cannot queue; documented request can send via fake;
 * later opt-out blocks an already queued message. Live sending stays off.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { checkRecipientEligibility } from "./eligibility";
import { approvalHash, messageIdempotencyKey, newOptOutToken } from "./hash";
import { resetFakeProvider, setFakeProviderMode } from "./provider";
import { runOutreachTick } from "./tick";

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

describe("outreach eligibility workflow", { skip: !enabled }, () => {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let companyId = "";
  let ownerId = "";
  let configId = "";
  const cleanupOppIds: string[] = [];
  const cleanupEmails: string[] = [];

  before(async () => {
    resetFakeProvider();
    setFakeProviderMode("accept");
    const company = await supabase
      .from("companies")
      .select("id, owner_id")
      .eq("slug", "badger-united")
      .maybeSingle();
    assert.ok(company.data);
    companyId = String(company.data.id);
    ownerId = String(company.data.owner_id);
    const config = await supabase
      .from("ceo_outreach_config")
      .select("id")
      .eq("company_slug", "badger-united")
      .maybeSingle();
    assert.ok(config.data);
    configId = String(config.data.id);
    await supabase
      .from("ceo_outreach_config")
      .update({
        company_id: companyId,
        owner_id: ownerId,
        live_enabled: false,
        paused: false,
        daily_send_cap: 5,
        sends_today: 0,
        window_start_hour: 0,
        window_end_hour: 24,
        sender_email: "hello@badgerunited.test",
        reply_to_email: "replies@badgerunited.test",
        postal_address: "100 Test Ave, Atlanta, GA 30301",
        provider: "fake",
        updated_at: new Date().toISOString(),
      })
      .eq("id", configId);
  });

  after(async () => {
    for (const id of cleanupOppIds) {
      await supabase.from("ceo_outreach_messages").delete().eq("opportunity_id", id);
      await supabase.from("ceo_outreach_eligibility").delete().eq("opportunity_id", id);
      await supabase.from("ceo_opportunities").delete().eq("id", id);
    }
    for (const email of cleanupEmails) {
      await supabase.from("ceo_outreach_suppressions").delete().eq("email", email);
    }
    await supabase
      .from("ceo_outreach_config")
      .update({
        live_enabled: false,
        paused: false,
        window_start_hour: 9,
        window_end_hour: 17,
        sender_email: "",
        reply_to_email: "",
        postal_address: "",
        sends_today: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", configId);
    resetFakeProvider();
  });

  async function insertLead(email: string) {
    const inserted = await supabase
      .from("ceo_opportunities")
      .insert({
        owner_id: ownerId,
        company_id: companyId,
        title: "Eligibility Test School",
        value_cents: 0,
        currency: "USD",
        score: 70,
        geography: "Atlanta, GA",
        status: "PROSPECT",
        source: "lead_worker:will",
        fit_reason: "Will found public email only.",
        source_url: `https://eligibility-test.example/${Date.now()}`,
        contact_email: email,
        outreach_stage: "waiting",
        service_interest: "website",
        industry: "driving schools",
        market: "Atlanta, GA",
        is_mock: false,
        evidence_signal: "call for enrollment",
        outreach_draft: "Hello,\n\nShort note about your enrollment path.",
        outreach_subject: "Introduction — Eligibility Test School",
        do_not_contact: false,
        discovered_by_worker: "will",
      })
      .select("id")
      .maybeSingle();
    assert.ok(inserted.data?.id, inserted.error?.message);
    cleanupOppIds.push(String(inserted.data.id));
    cleanupEmails.push(email);
    return String(inserted.data.id);
  }

  it("founder approval alone cannot treat public email as eligible", async () => {
    const email = `no-perm-${Date.now()}@school-sim.test`;
    const oppId = await insertLead(email);
    const check = await checkRecipientEligibility(supabase, {
      companyId,
      opportunityId: oppId,
      recipientEmail: email,
      isFollowUp: false,
      serviceInterest: "website",
    });
    assert.equal(check.ok, false);
    if (check.ok) return;
    assert.equal(check.label, "Needs permission");
    assert.match(check.reason, /public email/i);
  });

  it("documented request can proceed through the fake provider", async () => {
    const email = `doc-req-${Date.now()}@school-sim.test`;
    const oppId = await insertLead(email);
    const eligibility = await supabase
      .from("ceo_outreach_eligibility")
      .insert({
        company_id: companyId,
        opportunity_id: oppId,
        recipient_email: email,
        kind: "documented_request",
        source: "Recipient emailed hello@badgerunited.test asking for website ideas on 2026-11-04",
        scope: "service_website",
        recorded_at: "2026-11-04T15:00:00.000Z",
        recorded_by: ownerId,
        notes: "Covers website service outreach only",
      })
      .select("id")
      .maybeSingle();
    assert.ok(eligibility.data?.id, eligibility.error?.message);

    const gate = await checkRecipientEligibility(supabase, {
      companyId,
      opportunityId: oppId,
      recipientEmail: email,
      isFollowUp: false,
      serviceInterest: "website",
    });
    assert.equal(gate.ok, true);

    const subject = "Introduction — Eligibility Test School";
    const body = "Hello,\n\nShort note about your enrollment path.\n\n--\nBadger United\n100 Test Ave";
    const sender = "hello@badgerunited.test";
    const hash = approvalHash({ sender, recipient: email, subject, body });

    // Live stays off; exercise send path with forceEnvBypass + temporary live_enabled for fake only.
    await supabase
      .from("ceo_outreach_config")
      .update({ live_enabled: true, sends_today: 0 })
      .eq("id", configId);

    const queued = await supabase
      .from("ceo_outreach_messages")
      .insert({
        opportunity_id: oppId,
        company_id: companyId,
        owner_id: ownerId,
        status: "queued",
        sender_email: sender,
        reply_to_email: "replies@badgerunited.test",
        recipient_email: email,
        subject,
        body,
        approval_hash: hash,
        approved_at: new Date().toISOString(),
        approved_by: ownerId,
        approved_sender: sender,
        approved_recipient: email,
        approved_subject: subject,
        approved_body: body,
        idempotency_key: messageIdempotencyKey(oppId, hash, false),
        provider: "fake",
        opt_out_token: newOptOutToken(),
        eligibility_id: eligibility.data.id,
        eligibility_scope: "service_website",
        queued_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    assert.ok(queued.data?.id, queued.error?.message);

    await supabase
      .from("ceo_opportunities")
      .update({ outreach_stage: "queued", outreach_message_id: queued.data.id })
      .eq("id", oppId);

    const tick = await runOutreachTick(supabase, {
      trigger: "manual",
      forceEnvBypass: true,
      at: new Date("2026-11-05T19:00:00.000Z"),
    });
    assert.equal(tick.ok, true);
    assert.equal(tick.status, "completed");
    assert.equal(tick.sent, 1);

    await supabase
      .from("ceo_outreach_config")
      .update({ live_enabled: false })
      .eq("id", configId);
  });

  it("later opt-out blocks an already queued message before send", async () => {
    const email = `opt-out-later-${Date.now()}@school-sim.test`;
    const oppId = await insertLead(email);
    const eligibility = await supabase
      .from("ceo_outreach_eligibility")
      .insert({
        company_id: companyId,
        opportunity_id: oppId,
        recipient_email: email,
        kind: "opt_in",
        source: "Web form opt-in for website tips",
        scope: "service_website",
        recorded_at: "2026-11-03T12:00:00.000Z",
        recorded_by: ownerId,
      })
      .select("id")
      .maybeSingle();
    assert.ok(eligibility.data?.id);

    const subject = "Queued before opt-out";
    const body = "This message was queued before the recipient opted out.";
    const sender = "hello@badgerunited.test";
    const hash = approvalHash({ sender, recipient: email, subject, body });

    await supabase
      .from("ceo_outreach_config")
      .update({ live_enabled: true, sends_today: 0, paused: false })
      .eq("id", configId);

    const queued = await supabase
      .from("ceo_outreach_messages")
      .insert({
        opportunity_id: oppId,
        company_id: companyId,
        owner_id: ownerId,
        status: "queued",
        sender_email: sender,
        reply_to_email: "replies@badgerunited.test",
        recipient_email: email,
        subject,
        body,
        approval_hash: hash,
        approved_at: new Date().toISOString(),
        approved_by: ownerId,
        approved_sender: sender,
        approved_recipient: email,
        approved_subject: subject,
        approved_body: body,
        idempotency_key: messageIdempotencyKey(oppId, hash, false),
        provider: "fake",
        opt_out_token: newOptOutToken(),
        eligibility_id: eligibility.data.id,
        eligibility_scope: "service_website",
        queued_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    assert.ok(queued.data?.id);

    // Opt-out after queue, before send. Isolate this message as the only queued row.
    await supabase
      .from("ceo_outreach_messages")
      .update({
        status: "cancelled",
        last_error: "Cancelled so opt-out test can isolate one queued message.",
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("status", "queued")
      .neq("id", queued.data.id);

    await supabase
      .from("ceo_outreach_messages")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("id", queued.data.id);

    const suppressed = await supabase.from("ceo_outreach_suppressions").upsert(
      {
        company_id: companyId,
        email,
        reason: "opt_out",
        note: "Opted out after queue",
        source_message_id: queued.data.id,
      },
      { onConflict: "company_id,email" },
    );
    assert.equal(suppressed.error, null, suppressed.error?.message);

    const listed = await supabase
      .from("ceo_outreach_suppressions")
      .select("id, email, reason")
      .eq("company_id", companyId)
      .eq("email", email)
      .maybeSingle();
    assert.ok(listed.data?.id, "suppression row must exist before send tick");

    await supabase
      .from("ceo_outreach_config")
      .update({ live_enabled: true, paused: false, sends_today: 0 })
      .eq("id", configId);

    const tick = await runOutreachTick(supabase, {
      trigger: "manual",
      forceEnvBypass: true,
      at: new Date("2026-11-05T19:00:00.000Z"),
    });
    assert.equal(tick.messageId, queued.data.id, `tick message: ${tick.message}`);
    assert.equal(tick.status, "skipped");
    assert.match(tick.message, /suppress/i);
    assert.equal(tick.sent, 0);

    const message = await supabase
      .from("ceo_outreach_messages")
      .select("status")
      .eq("id", queued.data.id)
      .maybeSingle();
    assert.equal(message.data?.status, "suppressed");

    await supabase
      .from("ceo_outreach_config")
      .update({ live_enabled: false })
      .eq("id", configId);
  });
});
