"use server";

import { revalidatePath } from "next/cache";
import { canAdminProject } from "@/lib/access/permissions";
import { getAccessContext } from "@/lib/access/session-access";
import { createFounderAuthorization } from "@/lib/approvals/queries";
import { getSession } from "@/lib/auth/session";
import { loadBuildPlan } from "@/lib/build-plan/queries";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { insertShiftJob } from "./queries";
import {
  BUILD_PLAN_REVIEW_ACTION_TYPE,
  DEFAULT_SHIFT_TIMEZONE,
} from "./types";
import { buildPlanReviewIdempotencyKey, buildPlanReviewScope } from "./workflow";

export type QueueShiftJobResult =
  | { ok: true; jobId: string; notice: string }
  | { ok: false; error: string };

/**
 * Queue a read-only build-plan review for the Underworld shift runner.
 * Creates a PENDING founder authorization — approval does not execute.
 */
export async function queueBuildPlanReviewShiftJob(input: {
  companyId: string;
  projectId: string;
}): Promise<QueueShiftJobResult> {
  if (isCodegenLiveEnabled()) {
    return { ok: false, error: "Underworld shifts refuse to queue while LIVE is enabled." };
  }

  const session = await getSession();
  if (session.status !== "authenticated") {
    return { ok: false, error: "Sign in required." };
  }

  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!canAdminProject(access, input.projectId, input.companyId)) {
    return { ok: false, error: "Only a founder or project admin can queue shift work." };
  }

  const plan = await loadBuildPlan(session.supabase, input.projectId);
  if (plan.status === "error") return { ok: false, error: plan.message };
  const buildPlanId = plan.data?.id ?? "none";
  const idempotencyKey = buildPlanReviewIdempotencyKey(input.projectId, buildPlanId);
  const actionScope = buildPlanReviewScope(input.projectId);

  const auth = await createFounderAuthorization(session.supabase, session.user.id, {
    projectId: input.projectId,
    environmentLabel: "LOCAL",
    decisionId: null,
    actionType: BUILD_PLAN_REVIEW_ACTION_TYPE,
    actionScope,
    reason:
      "Underworld shift: read-only review of the saved build plan against recorded risks and verification.",
    evidence: [
      {
        source: "underworld_shift",
        reference: `/projects/${input.projectId}/build-plan`,
        at: new Date().toISOString(),
      },
    ],
    sideEffects:
      "Read-only review artifact. Does not mutate build plan, risks, or verification. Consequential follow-ups need separate approval.",
    estimatedCost: "UNKNOWN",
    reusePolicy: "ONE_TIME",
    maxUses: null,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    idempotencyKey: `auth-${idempotencyKey}`,
  });

  if (auth.status === "error") {
    return { ok: false, error: auth.message };
  }

  const job = await insertShiftJob(session.supabase, {
    ownerId: session.user.id,
    companyId: input.companyId,
    projectId: input.projectId,
    status: "AWAITING_APPROVAL",
    idempotencyKey,
    authorizationId: auth.data.id,
    buildPlanId: plan.data?.id ?? null,
    timezone: DEFAULT_SHIFT_TIMEZONE,
  });

  if (job.status === "error") {
    return { ok: false, error: job.message };
  }

  revalidatePath("/underworld");
  revalidatePath("/underworld/watch");
  revalidatePath("/dashboard");
  revalidatePath("/approvals");
  revalidatePath(`/projects/${input.projectId}`);

  return {
    ok: true,
    jobId: job.data.id,
    notice:
      "Shift job queued as awaiting founder approval. Approval does not run the review — the shift worker claims it during Mon–Fri 9–5 America/New_York.",
  };
}
