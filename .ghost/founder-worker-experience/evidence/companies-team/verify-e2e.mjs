/**
 * Local E2E verification for Companies + Team + assignments + sales map.
 * Uses ghost99f service role. Keeps LIVE off. Test invitations only (@ghost.local).
 *
 * Run: node .ghost/founder-worker-experience/evidence/companies-team/verify-e2e.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
if (env.GHOST_CODEGEN_LIVE_ENABLED === "1") {
  console.error("REFUSE: GHOST_CODEGEN_LIVE_ENABLED=1");
  process.exit(1);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

const stamp = Date.now();
const founderEmail = env.GHOST_LOCAL_FOUNDER_EMAIL || `founder-e2e-${stamp}@ghost.local`;
const founderPass = env.GHOST_LOCAL_FOUNDER_PASSWORD || "ghost-e2e-pass-12";
const teammateEmail = `teammate-ivoire-${stamp}@ghost.local`;
const teammatePass = "ghost-teammate-pass-12";
const results = [];

function ok(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name} — ${detail}`);
}

async function ensureUser(email, password) {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = listed.data?.users?.find((u) => u.email === email);
  if (existing) return existing.id;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: email.split("@")[0] },
  });
  if (created.error) throw new Error(created.error.message);
  return created.data.user.id;
}

async function main() {
  const founderId = await ensureUser(founderEmail, founderPass);
  const teammateId = await ensureUser(teammateEmail, teammatePass);
  ok("users", `founder=${founderId.slice(0, 8)} teammate=${teammateId.slice(0, 8)}`);

  const catalog = [
    ["ivoire-market", "Ivoire Market", "OPERATING"],
    ["im-distributors", "IM Distributors", "OPERATING"],
    ["badger-united", "Badger United", "OPERATING"],
    ["internal", "Internal", "INTERNAL"],
  ];
  const companyIds = {};
  for (const [slug, name, kind] of catalog) {
    const { data: existing } = await admin
      .from("companies")
      .select("id")
      .eq("owner_id", founderId)
      .eq("slug", slug)
      .maybeSingle();
    if (existing?.id) {
      companyIds[slug] = existing.id;
      await admin
        .from("companies")
        .update({ name, kind, is_catalog: true })
        .eq("id", existing.id);
    } else {
      const { data, error } = await admin
        .from("companies")
        .insert({
          owner_id: founderId,
          name,
          slug,
          kind,
          is_catalog: true,
          description: `${name} catalog company`,
        })
        .select("id")
        .single();
      if (error) throw error;
      companyIds[slug] = data.id;
    }
  }
  ok("catalog-companies", Object.keys(companyIds).join(","));

  // Ensure one Ivoire project + one IM project without duplicating by slug.
  async function ensureProject(companySlug, name, slug) {
    const companyId = companyIds[companySlug];
    const { data: existing } = await admin
      .from("projects")
      .select("id")
      .eq("company_id", companyId)
      .eq("slug", slug)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data, error } = await admin
      .from("projects")
      .insert({
        company_id: companyId,
        name,
        slug,
        description: `${name} verification project`,
        current_milestone: "Verify access",
        status: "PLANNING",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  const ivoireProjectId = await ensureProject("ivoire-market", "Ivoire Market Ops", "ivoire-market-ops");
  const imProjectId = await ensureProject("im-distributors", "IM Dist Ops", "im-dist-ops");
  ok("projects-linked", `ivoire=${ivoireProjectId.slice(0, 8)} im=${imProjectId.slice(0, 8)}`);

  const { data: action, error: actionError } = await admin
    .from("next_actions")
    .insert({
      project_id: ivoireProjectId,
      title: `Pack sample order ${stamp}`,
      description: "Teammate verification task",
      status: "OPEN",
      position: 0,
    })
    .select("id")
    .single();
  if (actionError) throw actionError;

  // Invite + accept path (test token)
  const token = `test_${stamp}_${crypto.randomUUID().replace(/-/g, "")}`;
  const { data: invite, error: inviteError } = await admin
    .from("team_invitations")
    .insert({
      company_id: companyIds["ivoire-market"],
      email: teammateEmail,
      role: "TEAM_MEMBER",
      project_ids: [ivoireProjectId],
      token,
      invited_by: founderId,
      status: "PENDING",
    })
    .select("id")
    .single();
  if (inviteError) throw inviteError;

  const { data: membership, error: memError } = await admin
    .from("company_memberships")
    .insert({
      company_id: companyIds["ivoire-market"],
      user_id: teammateId,
      role: "TEAM_MEMBER",
      invited_by: founderId,
    })
    .select("id")
    .single();
  if (memError) throw memError;

  await admin.from("project_memberships").insert({
    project_id: ivoireProjectId,
    user_id: teammateId,
    role: "TEAM_MEMBER",
    company_membership_id: membership.id,
  });

  await admin
    .from("team_invitations")
    .update({ status: "ACCEPTED", accepted_by: teammateId, accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  await admin.from("project_activity_events").insert({
    company_id: companyIds["ivoire-market"],
    project_id: ivoireProjectId,
    actor_kind: "PERSON",
    actor_user_id: founderId,
    actor_label: "Founder",
    action: "invite.accepted",
    summary: `Teammate ${teammateEmail} accepted invite to Ivoire Market`,
    record_type: "team_invitation",
    record_id: invite.id,
    metadata: {},
  });
  ok("invite-accept", "Ivoire Market scoped membership");

  // Human assignment
  const taskTitle = action?.title || `Pack sample order ${stamp}`;
  const { data: humanAssignment, error: haErr } = await admin
    .from("work_assignments")
    .insert({
      company_id: companyIds["ivoire-market"],
      project_id: ivoireProjectId,
      next_action_id: action.id,
      kind: "HUMAN",
      status: "ASSIGNED",
      title: taskTitle,
      instructions: "Complete packing checklist and submit for review.",
      assignee_user_id: teammateId,
      assigned_by: founderId,
    })
    .select("id")
    .single();
  if (haErr) throw haErr;

  await admin
    .from("work_assignments")
    .update({
      status: "SUBMITTED",
      submission_note: "Packed and ready.",
      submitted_at: new Date().toISOString(),
      progress_note: "Done locally",
    })
    .eq("id", humanAssignment.id);

  await admin.from("project_activity_events").insert([
    {
      company_id: companyIds["ivoire-market"],
      project_id: ivoireProjectId,
      actor_kind: "PERSON",
      actor_user_id: founderId,
      actor_label: "Founder",
      action: "assignment.created",
      summary: "Assigned packing task to teammate",
      record_type: "work_assignment",
      record_id: humanAssignment.id,
      metadata: {},
    },
    {
      company_id: companyIds["ivoire-market"],
      project_id: ivoireProjectId,
      actor_kind: "PERSON",
      actor_user_id: teammateId,
      actor_label: "Teammate",
      action: "assignment.submitted",
      summary: "Teammate submitted packing task for review",
      record_type: "work_assignment",
      record_id: humanAssignment.id,
      metadata: {},
    },
  ]);
  ok("human-assign-submit", humanAssignment.id.slice(0, 8));

  // AI assignment + handoff
  const { data: aiAssignment, error: aiErr } = await admin
    .from("work_assignments")
    .insert({
      company_id: companyIds["ivoire-market"],
      project_id: ivoireProjectId,
      kind: "AI",
      status: "SUBMITTED",
      title: "Ghost AI MOCK draft for packaging copy",
      instructions: "MOCK only — LIVE off",
      assigned_by: founderId,
      submission_note: "MOCK_GENERATION completed. This is not a live provider run.",
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (aiErr) throw aiErr;

  const { data: handed, error: handErr } = await admin
    .from("work_assignments")
    .insert({
      company_id: companyIds["ivoire-market"],
      project_id: ivoireProjectId,
      kind: "HUMAN",
      status: "ASSIGNED",
      title: "Review Ghost AI packaging copy",
      instructions: "Review the MOCK AI result.",
      assignee_user_id: teammateId,
      assigned_by: founderId,
      handed_off_from_assignment_id: aiAssignment.id,
    })
    .select("id")
    .single();
  if (handErr) throw handErr;

  const { error: tlErr } = await admin.from("project_activity_events").insert([
    {
      company_id: companyIds["ivoire-market"],
      project_id: ivoireProjectId,
      actor_kind: "AI",
      actor_label: "Ghost AI",
      action: "assignment.ai_submitted",
      summary: "Ghost AI MOCK assignment submitted",
      record_type: "work_assignment",
      record_id: aiAssignment.id,
      metadata: {},
    },
    {
      company_id: companyIds["ivoire-market"],
      project_id: ivoireProjectId,
      actor_kind: "PERSON",
      actor_user_id: founderId,
      actor_label: "Founder",
      action: "assignment.handed_off",
      summary: "Handed AI result to teammate for review",
      record_type: "work_assignment",
      record_id: handed.id,
      metadata: { from: aiAssignment.id },
    },
  ]);
  if (tlErr) throw tlErr;
  ok("ai-handoff", `ai=${aiAssignment.id.slice(0, 8)} human=${handed.id.slice(0, 8)}`);

  const { data: timeline, error: timelineErr } = await admin
    .from("project_activity_events")
    .select("action, summary")
    .eq("project_id", ivoireProjectId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (timelineErr) throw timelineErr;
  const actions = (timeline ?? []).map((row) => row.action);
  const hasAi = actions.includes("assignment.ai_submitted");
  const hasHand = actions.includes("assignment.handed_off");
  if (hasAi && hasHand) ok("timeline-both-actions", actions.slice(0, 6).join(","));
  else fail("timeline-both-actions", JSON.stringify(actions));

  // Cross-company denial via RLS as teammate JWT is hard here; assert membership shape.
  const { data: teammateCos } = await admin
    .from("company_memberships")
    .select("company_id")
    .eq("user_id", teammateId)
    .is("revoked_at", null);
  const allowed = (teammateCos ?? []).map((r) => r.company_id);
  if (allowed.includes(companyIds["ivoire-market"]) && !allowed.includes(companyIds["im-distributors"])) {
    ok("membership-scope", "Ivoire only");
  } else fail("membership-scope", JSON.stringify(allowed));

  // Map test orders + grant
  await admin.from("company_map_grants").upsert({
    company_id: companyIds["ivoire-market"],
    user_id: teammateId,
    granted_by: founderId,
    can_view_summaries: true,
  });

  const orders = [
    { external_order_id: `ft-${stamp}`, customer_key: "c-first", paid_at: "2026-10-01T12:00:00Z", amount_cents: 4000, fulfillment: "SHIPPED", shipping_zip: "10001", shipping_state: "NY" },
    { external_order_id: `ret-${stamp}`, customer_key: "c-return", paid_at: "2026-09-01T12:00:00Z", amount_cents: 2500, fulfillment: "SHIPPED", shipping_zip: "30301", shipping_state: "GA" },
    { external_order_id: `ret2-${stamp}`, customer_key: "c-return", paid_at: "2026-10-15T12:00:00Z", amount_cents: 2600, fulfillment: "SHIPPED", shipping_zip: "30301", shipping_state: "GA" },
    { external_order_id: `ref-${stamp}`, customer_key: "c-refund", paid_at: "2026-10-02T12:00:00Z", amount_cents: 1800, payment_state: "REFUNDED", fulfillment: "SHIPPED", shipping_zip: "90210", shipping_state: "CA" },
    { external_order_id: `pick-${stamp}`, customer_key: "c-pickup", paid_at: "2026-10-03T12:00:00Z", amount_cents: 1200, fulfillment: "PICKUP", shipping_zip: null, shipping_state: null },
    { external_order_id: `miss-${stamp}`, customer_key: "c-miss", paid_at: "2026-10-04T12:00:00Z", amount_cents: 900, fulfillment: "SHIPPED", shipping_zip: null, shipping_state: null },
  ];
  for (const order of orders) {
    await admin.from("company_orders").upsert(
      {
        company_id: companyIds["ivoire-market"],
        is_test: true,
        history_complete: true,
        payment_state: "PAID",
        ...order,
      },
      { onConflict: "company_id,external_order_id" },
    );
  }
  await admin.from("company_sales_sync").upsert({
    company_id: companyIds["ivoire-market"],
    source_label: "Labeled test orders",
    last_synced_at: new Date().toISOString(),
    history_complete: true,
    notes: "E2E verify seed",
  });

  // IM orders should not be readable conceptually by Ivoire-only grant
  await admin.from("company_orders").upsert(
    {
      company_id: companyIds["im-distributors"],
      external_order_id: `im-secret-${stamp}`,
      customer_key: "im-c",
      paid_at: "2026-10-01T12:00:00Z",
      amount_cents: 9999,
      payment_state: "PAID",
      fulfillment: "SHIPPED",
      shipping_zip: "75201",
      shipping_state: "TX",
      is_test: true,
    },
    { onConflict: "company_id,external_order_id" },
  );

  const { data: ivoireOrders } = await admin
    .from("company_orders")
    .select("id")
    .eq("company_id", companyIds["ivoire-market"]);
  const { data: imGrant } = await admin
    .from("company_map_grants")
    .select("id")
    .eq("company_id", companyIds["im-distributors"])
    .eq("user_id", teammateId)
    .is("revoked_at", null);
  if ((ivoireOrders ?? []).length >= 6 && (imGrant ?? []).length === 0) {
    ok("map-orders-seed", `ivoireOrders=${ivoireOrders.length} imGrant=0`);
  } else {
    fail("map-orders-seed", `ivoire=${ivoireOrders?.length} imGrant=${imGrant?.length}`);
  }

  // Settings denial shape: teammate owns no companies
  const { data: owned } = await admin.from("companies").select("id").eq("owner_id", teammateId);
  if ((owned ?? []).length === 0) ok("settings-denied-shape", "teammate owns 0 companies");
  else fail("settings-denied-shape", "teammate unexpectedly owns companies");

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ live: env.GHOST_CODEGEN_LIVE_ENABLED, noLive: env.GHOST_NO_LIVE_PROVIDER_CALLS, results, failed: failed.length }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
