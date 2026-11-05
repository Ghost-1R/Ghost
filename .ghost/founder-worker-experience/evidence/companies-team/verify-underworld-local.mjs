/**
 * Local Underworld + schema-readiness smoke against ghost99f (LIVE must be 0).
 * Run: node .ghost/founder-worker-experience/evidence/companies-team/verify-underworld-local.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
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
  console.error("REFUSE LIVE=1");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name} — ${detail}`);
}

async function main() {
  // Schema probes
  for (const [table, cols] of [
    ["companies", "id,kind,is_catalog"],
    ["work_assignments", "id"],
    ["underworld_goals", "id"],
    ["underworld_plans", "id"],
    ["underworld_steps", "id"],
  ]) {
    const { error } = await admin.from(table).select(cols).limit(1);
    if (error) fail(`schema:${table}`, error.message);
    else pass(`schema:${table}`);
  }

  const { data: companies } = await admin.from("companies").select("id,owner_id").limit(1);
  const company = companies?.[0];
  if (!company) {
    fail("seed-company", "no company");
  } else {
    const { data: projects } = await admin
      .from("projects")
      .select("id,name")
      .eq("company_id", company.id)
      .limit(1);
    const project = projects?.[0];
    if (!project) fail("seed-project", "no project");
    else {
      const title = `Underworld local ${Date.now()}`;
      const objective = "Demonstrate planner → executor → reviewer with LIVE=0.";
      const fingerprint = createHash("sha256").update(title + objective).digest("hex").slice(0, 32);

      const { data: goal, error: gErr } = await admin
        .from("underworld_goals")
        .insert({
          company_id: company.id,
          project_id: project.id,
          owner_id: company.owner_id,
          title,
          objective,
          classification: "INTERNAL",
          budget_cents: 0,
          status: "DRAFT",
        })
        .select("id")
        .single();
      if (gErr) fail("goal", gErr.message);
      else {
        const { data: plan, error: pErr } = await admin
          .from("underworld_plans")
          .insert({
            goal_id: goal.id,
            version: 1,
            status: "PREVIEWED",
            scope_summary: "MOCK plan",
            scope_fingerprint: fingerprint,
            previewed_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (pErr) fail("plan", pErr.message);
        else {
          const { error: sErr } = await admin.from("underworld_steps").insert([
            {
              plan_id: plan.id,
              seq: 1,
              title: "Plan",
              role: "PLANNER",
              assignee_kind: "AI",
              status: "READY",
            },
            {
              plan_id: plan.id,
              seq: 2,
              title: "Execute MOCK",
              role: "EXECUTOR",
              assignee_kind: "AI",
              status: "PENDING",
            },
            {
              plan_id: plan.id,
              seq: 3,
              title: "Independent review",
              role: "REVIEWER",
              assignee_kind: "HUMAN",
              status: "PENDING",
            },
          ]);
          if (sErr) fail("steps", sErr.message);
          else {
            const { data: claimed, error: cErr } = await admin.rpc("claim_underworld_step", {
              p_step_id: (
                await admin.from("underworld_steps").select("id").eq("plan_id", plan.id).eq("seq", 1).single()
              ).data.id,
              p_lease_owner: "verify-script",
              p_lease_seconds: 60,
            });
            if (cErr || !claimed) fail("claim", cErr?.message ?? "null claim");
            else pass("claim", String(claimed).slice(0, 8));

            // Second claim should fail / return null while lease held
            const { data: claimed2 } = await admin.rpc("claim_underworld_step", {
              p_step_id: claimed,
              p_lease_owner: "other-worker",
              p_lease_seconds: 60,
            });
            if (claimed2) fail("double-claim", "second worker claimed same step");
            else pass("double-claim-blocked");
          }
        }
      }
    }
  }

  // Paid dispatch blocked shape: LIVE must not be 1 in env
  if (env.GHOST_CODEGEN_LIVE_ENABLED !== "1") pass("live-off");
  else fail("live-off", "LIVE is 1");

  const failed = results.filter((r) => !r.ok).length;
  console.log(JSON.stringify({ failed, results }, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
