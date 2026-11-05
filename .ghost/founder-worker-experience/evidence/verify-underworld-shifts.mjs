/**
 * Disposable local verification for Underworld shifts.
 * - Finishes with no browser involved (service-role runner ticks)
 * - Survives a "worker restart" without duplicating the COMPLETE result
 * - Respects shift boundary (no new claims outside window; checkpoints unfinished work)
 * LIVE stays 0. Production untouched.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);

if (env.GHOST_CODEGEN_LIVE_ENABLED === "1") {
  throw new Error("Refusing verification while LIVE=1");
}

const { runUnderworldShiftTick } = await import("../../../src/lib/underworld-shifts/runner.ts");
const { scopeFingerprint } = await import("../../../src/lib/approvals/workflow.ts");
const { buildPlanReviewIdempotencyKey, buildPlanReviewScope } = await import(
  "../../../src/lib/underworld-shifts/workflow.ts"
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const seed = JSON.parse(
  readFileSync(".ghost/founder-worker-experience/evidence/pr9-seed-migrated.json", "utf8"),
);
const projectId = seed.projectId;
const companyId = seed.companyId;

// Resolve current owner of the PR9 company (founder remap after resets).
const company = await admin.from("companies").select("id, owner_id").eq("id", companyId).maybeSingle();
if (!company.data) throw new Error("PR9 company missing on disposable DB");
const ownerId = company.data.owner_id;

const plan = await admin.from("build_plans").select("id, status, summary").eq("project_id", projectId).maybeSingle();
const buildPlanId = plan.data?.id ?? "none";
const idempotencyKey = `${buildPlanReviewIdempotencyKey(projectId, buildPlanId)}-verify-${Date.now()}`;
const actionScope = buildPlanReviewScope(projectId);
const fingerprint = scopeFingerprint({
  projectId,
  actionType: "agent_task.inspect",
  actionScope,
  environmentLabel: "LOCAL",
});

// Park leftover incomplete jobs so this run's claim order is deterministic.
await admin
  .from("underworld_shift_jobs")
  .update({
    status: "CANCELLED",
    lease_holder_id: null,
    lease_token: null,
    lease_expires_at: null,
    block_reason: "Superseded by verify-underworld-shifts run.",
  })
  .eq("owner_id", ownerId)
  .in("status", ["QUEUED", "WORKING", "BLOCKED", "AWAITING_APPROVAL"]);

const authInsert = await admin
  .from("founder_action_authorizations")
  .insert({
    owner_id: ownerId,
    project_id: projectId,
    environment_label: "LOCAL",
    action_type: "agent_task.inspect",
    action_scope: actionScope,
    scope_fingerprint: fingerprint,
    reason: "Local Underworld shift verification — read-only build plan review.",
    evidence: [{ source: "verify-underworld-shifts", reference: `/projects/${projectId}/build-plan`, at: new Date().toISOString() }],
    side_effects: "Read-only review artifact only.",
    estimated_cost: "UNKNOWN",
    status: "APPROVED",
    reuse_policy: "BOUNDED",
    max_uses: 8,
    use_count: 0,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    decided_at: new Date().toISOString(),
    decided_by: ownerId,
    idempotency_key: `auth-${idempotencyKey}`,
  })
  .select("id")
  .single();
if (authInsert.error) throw authInsert.error;

const jobInsert = await admin
  .from("underworld_shift_jobs")
  .insert({
    owner_id: ownerId,
    company_id: companyId,
    project_id: projectId,
    workflow: "BUILD_PLAN_REVIEW",
    status: "QUEUED",
    idempotency_key: idempotencyKey,
    authorization_id: authInsert.data.id,
    build_plan_id: plan.data?.id ?? null,
    timezone: "America/New_York",
  })
  .select("id")
  .single();
if (jobInsert.error) throw jobInsert.error;
const jobId = jobInsert.data.id;

const holderA = `verify-worker-a-${randomUUID().slice(0, 8)}`;
let completed = null;
for (let i = 0; i < 8; i += 1) {
  const tick = await runUnderworldShiftTick(admin, {
    forceWithinShift: true,
    holderId: holderA,
    at: new Date().toISOString(),
    maxClaims: 1,
  });
  const job = await admin.from("underworld_shift_jobs").select("*").eq("id", jobId).single();
  if (job.data?.status === "COMPLETE") {
    completed = job.data;
    break;
  }
  if (job.data?.status === "BLOCKED" || job.data?.status === "FAILED") {
    throw new Error(`Job stopped early: ${job.data.status} ${job.data.block_reason}`);
  }
  void tick;
}
if (!completed) throw new Error("Job did not complete under forced shift ticks (browser closed).");

// Restart simulation: new holder, same job already COMPLETE — must not duplicate result.
const holderB = `verify-worker-b-${randomUUID().slice(0, 8)}`;
const restartTick = await runUnderworldShiftTick(admin, {
  forceWithinShift: true,
  holderId: holderB,
});
const afterRestart = await admin.from("underworld_shift_jobs").select("*").eq("id", jobId).single();
const completeCount = await admin
  .from("underworld_shift_jobs")
  .select("id", { count: "exact", head: true })
  .eq("owner_id", ownerId)
  .eq("result_fingerprint", completed.result_fingerprint)
  .eq("status", "COMPLETE");

// Shift boundary: queue another job, claim one step in-shift, then tick outside shift.
const boundaryKey = `${idempotencyKey}-boundary`;
const auth2 = await admin
  .from("founder_action_authorizations")
  .insert({
    owner_id: ownerId,
    project_id: projectId,
    environment_label: "LOCAL",
    action_type: "agent_task.inspect",
    action_scope: actionScope,
    scope_fingerprint: fingerprint,
    reason: "Boundary verification job.",
    evidence: [{ source: "verify-underworld-shifts", reference: "boundary", at: new Date().toISOString() }],
    side_effects: "Read-only.",
    estimated_cost: "UNKNOWN",
    status: "APPROVED",
    reuse_policy: "BOUNDED",
    max_uses: 8,
    use_count: 0,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    decided_at: new Date().toISOString(),
    decided_by: ownerId,
    idempotency_key: `auth-${boundaryKey}`,
  })
  .select("id")
  .single();
const boundaryJob = await admin
  .from("underworld_shift_jobs")
  .insert({
    owner_id: ownerId,
    company_id: companyId,
    project_id: projectId,
    workflow: "BUILD_PLAN_REVIEW",
    status: "QUEUED",
    idempotency_key: boundaryKey,
    authorization_id: auth2.data.id,
    build_plan_id: plan.data?.id ?? null,
  })
  .select("id")
  .single();

// Cancel any other queued jobs so maxClaims:1 hits the boundary job.
await admin
  .from("underworld_shift_jobs")
  .update({ status: "CANCELLED", block_reason: "Not the boundary subject." })
  .eq("owner_id", ownerId)
  .eq("status", "QUEUED")
  .neq("id", boundaryJob.data.id);

const holderC = `verify-worker-c-${randomUUID().slice(0, 8)}`;
// Claim and advance one step only, leaving unfinished work for the shift-end park.
await runUnderworldShiftTick(admin, {
  forceWithinShift: true,
  holderId: holderC,
  maxClaims: 1,
  stopAfterStep: true,
});
const mid = await admin.from("underworld_shift_jobs").select("*").eq("id", boundaryJob.data.id).single();
if (mid.data?.status === "COMPLETE") {
  throw new Error(
    "Boundary subject completed after one-step tick; expected unfinished WORKING/QUEUED work.",
  );
}

// Outside shift (Sunday morning ET): should not claim NEW queued work; should checkpoint WORKING.
const outsideAt = "2026-11-08T15:00:00.000Z"; // Sunday 10:00 ET
const outsideTick = await runUnderworldShiftTick(admin, {
  forceWithinShift: false,
  holderId: holderC,
  at: outsideAt,
});
const afterBoundary = await admin.from("underworld_shift_jobs").select("*").eq("id", boundaryJob.data.id).single();

const out = {
  ok: true,
  live: env.GHOST_CODEGEN_LIVE_ENABLED ?? "0",
  supabaseUrl: url,
  jobId,
  completedStatus: completed.status,
  reviewSummary: completed.review_summary,
  evidence: completed.evidence,
  resultFingerprint: completed.result_fingerprint,
  duplicateCompleteRows: completeCount.count ?? 0,
  restartClaimed: restartTick.claimed,
  midStatus: mid.data?.status,
  midCheckpoint: mid.data?.checkpoint_step,
  afterBoundaryStatus: afterBoundary.data?.status,
  afterBoundaryCheckpoint: afterBoundary.data?.checkpoint_step,
  outsideClaimed: outsideTick.claimed,
  outsideCheckpointed: outsideTick.checkpointed,
  outsideDetail: outsideTick.detail,
  anonConfigured: Boolean(anon),
  hash: createHash("sha256").update(String(completed.result_fingerprint)).digest("hex").slice(0, 12),
};

writeFileSync(
  ".ghost/founder-worker-experience/evidence/verify-underworld-shifts.json",
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));

if (out.duplicateCompleteRows !== 1) throw new Error("Expected exactly one COMPLETE row for the result fingerprint");
if (out.restartClaimed !== 0) throw new Error("Restart claimed new work unexpectedly");
if (out.outsideClaimed !== 0) throw new Error("Outside shift claimed new work");
if (out.afterBoundaryStatus !== "QUEUED") {
  throw new Error(`Expected boundary park to QUEUED, got ${out.afterBoundaryStatus}`);
}
if (!(out.outsideCheckpointed >= 1)) throw new Error("Expected a shift-boundary checkpoint");
