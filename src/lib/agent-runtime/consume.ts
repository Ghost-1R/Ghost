import type { AuthorizationReusePolicy, AuthorizationStatus } from "@/lib/approvals/types";

/**
 * Pure optimistic-lock consumption decision.
 * Mirrors markAuthorizationConsumed's compare-and-swap semantics for unit testing
 * without a live database.
 */
export type ConsumeAttempt = {
  authorizationId: string;
  observedStatus: AuthorizationStatus;
  observedUseCount: number;
  reusePolicy: AuthorizationReusePolicy;
  maxUses: number | null;
};

export type ConsumeOutcome =
  | {
      ok: true;
      nextUseCount: number;
      nextStatus: "APPROVED" | "CONSUMED";
      consumeFully: boolean;
      /** CAS predicate that must match for the write to succeed. */
      cas: { status: "APPROVED"; useCount: number };
    }
  | {
      ok: false;
      reason: "NOT_APPROVED" | "USES_EXHAUSTED" | "ALREADY_CONSUMED" | "CAS_LOST";
    };

export function planAuthorizationConsumption(attempt: ConsumeAttempt): ConsumeOutcome {
  if (attempt.observedStatus === "CONSUMED") {
    return { ok: false, reason: "ALREADY_CONSUMED" };
  }
  if (attempt.observedStatus !== "APPROVED") {
    return { ok: false, reason: "NOT_APPROVED" };
  }
  if (attempt.reusePolicy === "ONE_TIME" && attempt.observedUseCount >= 1) {
    return { ok: false, reason: "USES_EXHAUSTED" };
  }
  if (
    attempt.reusePolicy === "BOUNDED" &&
    attempt.maxUses != null &&
    attempt.observedUseCount >= attempt.maxUses
  ) {
    return { ok: false, reason: "USES_EXHAUSTED" };
  }

  const nextUseCount = attempt.observedUseCount + 1;
  const consumeFully =
    attempt.reusePolicy === "ONE_TIME" ||
    (attempt.reusePolicy === "BOUNDED" &&
      attempt.maxUses != null &&
      nextUseCount >= attempt.maxUses);

  return {
    ok: true,
    nextUseCount,
    nextStatus: consumeFully ? "CONSUMED" : "APPROVED",
    consumeFully,
    cas: { status: "APPROVED", useCount: attempt.observedUseCount },
  };
}

/**
 * Simulate concurrent consumers racing on the same authorization row.
 * Exactly one winner when starting from APPROVED with useCount 0 (ONE_TIME).
 */
export function simulateConcurrentOneTimeConsumption(
  attempts: number,
  initialUseCount = 0,
): { winners: number; losers: number; finalStatus: "APPROVED" | "CONSUMED"; finalUseCount: number } {
  let useCount = initialUseCount;
  let status: AuthorizationStatus = "APPROVED";
  let winners = 0;
  let losers = 0;

  for (let i = 0; i < attempts; i += 1) {
    const plan = planAuthorizationConsumption({
      authorizationId: "auth",
      observedStatus: status,
      observedUseCount: useCount,
      reusePolicy: "ONE_TIME",
      maxUses: null,
    });
    if (!plan.ok) {
      losers += 1;
      continue;
    }
    // CAS: only apply if row still matches observed snapshot.
    if (status !== plan.cas.status || useCount !== plan.cas.useCount) {
      losers += 1;
      continue;
    }
    useCount = plan.nextUseCount;
    status = plan.nextStatus;
    winners += 1;
  }

  return {
    winners,
    losers,
    finalStatus: status === "CONSUMED" ? "CONSUMED" : "APPROVED",
    finalUseCount: useCount,
  };
}
