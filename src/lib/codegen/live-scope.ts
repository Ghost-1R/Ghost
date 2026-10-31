/**
 * Exact Pilot 03 live authorization scope gates.
 * Live dispatch requires this binding — MOCK scopes are refused.
 */

import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { parseCodegenScopeFragment, type CodegenTaskContract } from "./request-contract";
import { PILOT_03_MAX_TRIAL_CENTS } from "./openai-models";

export const PILOT_03_LIVE_PROVIDER = "openai" as const;
export const PILOT_03_LIVE_MODEL = "gpt-5-mini" as const;
export const PILOT_03_LIVE_CLASSIFICATION = "PUBLIC" as const;
export const PILOT_03_LIVE_ENVIRONMENTS = ["LOCAL_PILOT_03", "LOCAL_PILOT_04", "LOCAL_PILOT_05"] as const;
/** Hard per-request ceiling remains $1; Pilot 04 may authorize ≤ remaining allowance (e.g. 99¢). */
export const PILOT_03_LIVE_MAX_CENTS = PILOT_03_MAX_TRIAL_CENTS;

export type LiveScopeOk = {
  ok: true;
  contract: CodegenTaskContract;
  detail: string;
};

export type LiveScopeFail = {
  ok: false;
  reason: string;
  message: string;
};

/**
 * Verify founder authorization binds the exact first live trial scope.
 * Deployment must remain forbidden. Exactly one job ($1 ceiling).
 */
export function verifyPilot03LiveFounderScope(input: {
  actionScope: string;
  environmentLabel: string;
  authorization: Pick<
    FounderActionAuthorization,
    "status" | "effectiveStatus" | "reusePolicy" | "actionType"
  >;
}): LiveScopeOk | LiveScopeFail {
  if (input.authorization.actionType !== "agent_task.develop") {
    return {
      ok: false,
      reason: "ACTION_TYPE_MISMATCH",
      message: "Live coding requires agent_task.develop authorization.",
    };
  }
  if (input.authorization.reusePolicy !== "ONE_TIME") {
    return {
      ok: false,
      reason: "REUSE_POLICY",
      message: "Live coding requires ONE_TIME founder authorization.",
    };
  }
  // After durable queue the auth is CONSUMED (exactly one job). Pending/Approved alone cannot dispatch.
  const status = input.authorization.effectiveStatus ?? input.authorization.status;
  if (status !== "CONSUMED" && input.authorization.status !== "CONSUMED") {
    return {
      ok: false,
      reason: "AUTH_NOT_CONSUMED",
      message: `ONE_TIME authorization must be consumed at queue before live dispatch (status=${status}).`,
    };
  }
  if (!PILOT_03_LIVE_ENVIRONMENTS.includes(input.environmentLabel as (typeof PILOT_03_LIVE_ENVIRONMENTS)[number])) {
    return {
      ok: false,
      reason: "ENVIRONMENT_MISMATCH",
      message: `Live coding requires disposable local pilot environment (${PILOT_03_LIVE_ENVIRONMENTS.join("|")}).`,
    };
  }

  const contract = parseCodegenScopeFragment(input.actionScope);
  if (!contract) {
    return {
      ok: false,
      reason: "NOT_CODEGEN_SCOPE",
      message: "Authorization scope is not a Pilot 03 codegen contract.",
    };
  }
  if (contract.providerId !== PILOT_03_LIVE_PROVIDER) {
    return {
      ok: false,
      reason: "PROVIDER_MISMATCH",
      message: `Live entrypoint requires provider ${PILOT_03_LIVE_PROVIDER}; got ${contract.providerId}.`,
    };
  }
  if (contract.model !== PILOT_03_LIVE_MODEL) {
    return {
      ok: false,
      reason: "MODEL_MISMATCH",
      message: `Live entrypoint requires model ${PILOT_03_LIVE_MODEL}; got ${contract.model}.`,
    };
  }
  if (contract.classification !== PILOT_03_LIVE_CLASSIFICATION) {
    return {
      ok: false,
      reason: "CLASSIFICATION_MISMATCH",
      message: "Live entrypoint requires PUBLIC classification only.",
    };
  }
  if (
    !Number.isFinite(contract.maxSpendCents) ||
    contract.maxSpendCents < 1 ||
    contract.maxSpendCents > PILOT_03_LIVE_MAX_CENTS
  ) {
    return {
      ok: false,
      reason: "MAX_SPEND_MISMATCH",
      message: `Live entrypoint requires max authorized usage between $0.01 and $${(PILOT_03_LIVE_MAX_CENTS / 100).toFixed(2)} (got $${(contract.maxSpendCents / 100).toFixed(2)}).`,
    };
  }
  if (!input.actionScope.includes("deploy=false")) {
    return {
      ok: false,
      reason: "DEPLOYMENT_NOT_FORBIDDEN",
      message: "Live scope must explicitly forbid deployment (deploy=false).",
    };
  }
  if (contract.dispatch !== "LIVE") {
    return {
      ok: false,
      reason: "DISPATCH_DISABLED",
      message: `Paid live execution requires dispatch=LIVE in the approved fingerprint (got dispatch=${contract.dispatch}). The process LIVE flag cannot override this.`,
    };
  }

  return {
    ok: true,
    contract,
    detail: `${PILOT_03_LIVE_PROVIDER}:${PILOT_03_LIVE_MODEL}|PUBLIC|dispatch=LIVE|max$${(contract.maxSpendCents / 100).toFixed(2)}|deploy=false|ONE_TIME|${input.environmentLabel}`,
  };
}

/** Reasons that mean a provider request may have been billed — do not release or auto-retry. */
export const UNCERTAIN_BILLING_REASONS = new Set([
  "UNCERTAIN_BILLING",
  "TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "CANCELLED",
  /** HTTP 200 with empty visible content — may still bill reasoning/output tokens. */
  "EMPTY_PROVIDER_CONTENT",
  /** finish_reason=length — may have billed before complete payload. */
  "TRUNCATED_OUTPUT",
]);

export function isUncertainBillingReason(reason: string): boolean {
  return UNCERTAIN_BILLING_REASONS.has(reason);
}
