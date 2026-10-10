import type { GhostClient } from "@/lib/auth/session";
import type { QueryResult } from "@/lib/result";
import { loadAuthorizationById, markAuthorizationConsumed } from "./queries";
import type { ExecutionRevalidationRequest, FounderActionAuthorization } from "./types";
import { revalidateAuthorizationForExecution, type RevalidationResult } from "./workflow";

export type ExecutionGateDenial = Extract<RevalidationResult, { ok: false }>["reason"] | "LOAD_FAILED";

export type ExecutionGateResult =
  | {
      ok: true;
      authorization: FounderActionAuthorization;
      shouldConsume: boolean;
      /** Present only when the gate recorded consumption after a successful revalidation. */
      consumed: FounderActionAuthorization | null;
    }
  | {
      ok: false;
      reason: ExecutionGateDenial;
      message: string;
    };

const DENIAL_MESSAGES: Record<ExecutionGateDenial, string> = {
  MISSING_AUTHORIZATION: "No authorization record is available for this action.",
  OWNER_MISMATCH: "Caller is not the owning founder for this authorization.",
  PROJECT_MISMATCH: "Authorization project does not match the execution target.",
  ENVIRONMENT_MISMATCH: "Authorization environment does not match the execution target.",
  SCOPE_MISMATCH: "Action type or scope does not match the approved fingerprint.",
  EXPIRED: "Authorization has expired.",
  REVOKED: "Authorization was revoked.",
  REJECTED: "Authorization was rejected.",
  PENDING: "Authorization is still pending founder approval.",
  CONSUMED: "Authorization was already consumed.",
  USES_EXHAUSTED: "Authorization reuse budget is exhausted.",
  MISSING_EVIDENCE: "Authorization is missing required reason or evidence.",
  NOT_APPROVED: "Authorization is not in an APPROVED state.",
  LOAD_FAILED: "Authorization could not be loaded.",
};

/**
 * Reusable local execution gate.
 * Approving a request never calls this. Synthetic executors must invoke it
 * at start and after recovery before any side effect.
 */
export function assertExecutionAuthorized(
  auth: FounderActionAuthorization | null,
  request: ExecutionRevalidationRequest,
): ExecutionGateResult {
  const result = revalidateAuthorizationForExecution(auth, request);
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      message: DENIAL_MESSAGES[result.reason],
    };
  }
  if (!auth) {
    return { ok: false, reason: "MISSING_AUTHORIZATION", message: DENIAL_MESSAGES.MISSING_AUTHORIZATION };
  }
  return {
    ok: true,
    authorization: auth,
    shouldConsume: result.shouldConsume,
    consumed: null,
  };
}

/**
 * Load + revalidate + optionally record consumption in one durable path.
 * Consumption is recorded only after successful revalidation — never on approve.
 */
export async function authorizeLocalExecution(
  supabase: GhostClient,
  request: ExecutionRevalidationRequest & { recordConsumption?: boolean },
): Promise<ExecutionGateResult> {
  const loaded = await loadAuthorizationById(supabase, request.ownerId, request.authorizationId);
  if (loaded.status === "error") {
    return { ok: false, reason: "LOAD_FAILED", message: loaded.message };
  }

  const gate = assertExecutionAuthorized(loaded.data, request);
  if (!gate.ok) return gate;

  if (!request.recordConsumption) {
    return gate;
  }

  const consumed = await markAuthorizationConsumed(supabase, request.ownerId, request.authorizationId);
  if (consumed.status === "error") {
    if (/Concurrent consumption/i.test(consumed.message)) {
      return {
        ok: false,
        reason: "USES_EXHAUSTED",
        message: DENIAL_MESSAGES.USES_EXHAUSTED,
      };
    }
    return { ok: false, reason: "LOAD_FAILED", message: consumed.message };
  }

  return {
    ok: true,
    authorization: gate.authorization,
    shouldConsume: gate.shouldConsume,
    consumed: consumed.data,
  };
}

/** Concurrent-safe consume helper used by synthetic executor tests. */
export async function tryConsumeAuthorizationOnce(
  supabase: GhostClient,
  request: ExecutionRevalidationRequest,
): Promise<QueryResult<{ winner: boolean; authorization: FounderActionAuthorization }>> {
  const first = await authorizeLocalExecution(supabase, { ...request, recordConsumption: true });
  if (!first.ok) {
    return { status: "error", message: `${first.reason}: ${first.message}` };
  }
  if (!first.consumed) {
    return { status: "error", message: "Consumption was not recorded." };
  }
  return { status: "ok", data: { winner: true, authorization: first.consumed } };
}
