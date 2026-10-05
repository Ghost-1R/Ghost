export const LIFECYCLE_STAGES = [
  "IDEA",
  "STRATEGY",
  "DESIGN",
  "BUILD",
  "TEST",
  "DEPLOY",
  "LEARN",
  "COMPLETED",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const LIFECYCLE_ACTORS = ["FOUNDER", "DETERMINISTIC_RULE", "SYSTEM_SEED"] as const;
export type LifecycleActor = (typeof LIFECYCLE_ACTORS)[number];

/** Adjacent moves only. Ghost recommendations still go through this graph. */
export const LEGAL_LIFECYCLE_TRANSITIONS: Record<LifecycleStage, readonly LifecycleStage[]> = {
  IDEA: ["STRATEGY", "COMPLETED"],
  STRATEGY: ["IDEA", "DESIGN", "COMPLETED"],
  DESIGN: ["STRATEGY", "BUILD", "COMPLETED"],
  BUILD: ["DESIGN", "TEST", "COMPLETED"],
  TEST: ["BUILD", "DEPLOY", "COMPLETED"],
  DEPLOY: ["TEST", "LEARN", "COMPLETED"],
  LEARN: ["DEPLOY", "IDEA", "STRATEGY", "COMPLETED"],
  COMPLETED: ["LEARN", "IDEA"],
};

export function isLifecycleStage(value: string): value is LifecycleStage {
  return (LIFECYCLE_STAGES as readonly string[]).includes(value);
}

export function canTransitionLifecycle(from: LifecycleStage, to: LifecycleStage): boolean {
  if (from === to) return false;
  return LEGAL_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export type LifecycleRecommendation = {
  to: LifecycleStage;
  reason: string;
  ruleId: string;
};

/**
 * Deterministic recommendations from recorded evidence only.
 * These never auto-apply. A founder (or an explicit DETERMINISTIC_RULE call with
 * the same evidence id) must record the transition through the RPC.
 *
 * Documented safe rules:
 * - build-to-test-when-application-verified: BUILD + verified APPLICATION evidence + no OPEN blockers
 * - test-to-deploy-when-production-verified: TEST + verified PRODUCTION evidence + no OPEN blockers
 * No rule promotes to COMPLETED automatically.
 */
export function recommendLifecycleTransition(input: {
  stage: LifecycleStage;
  openBlockers: number;
  verifiedCategories: readonly string[];
}): LifecycleRecommendation | null {
  if (input.openBlockers > 0) return null;
  const verified = new Set(input.verifiedCategories.map((value) => value.toUpperCase()));
  if (input.stage === "BUILD" && verified.has("APPLICATION")) {
    return {
      to: "TEST",
      reason: "Application verification is recorded and no blockers are open, so TEST is the next safe stage.",
      ruleId: "build-to-test-when-application-verified",
    };
  }
  if (input.stage === "TEST" && verified.has("PRODUCTION")) {
    return {
      to: "DEPLOY",
      reason: "Production verification is recorded and no blockers are open, so DEPLOY is the next safe stage.",
      ruleId: "test-to-deploy-when-production-verified",
    };
  }
  return null;
}

/** Cutover mapping used by the migration seed. Kept here so tests lock the meaning. */
export function seedLifecycleFromProjectStatus(status: string): LifecycleStage {
  switch (status) {
    case "IDEA":
      return "IDEA";
    case "PLANNING":
      return "STRATEGY";
    case "READY":
      return "DESIGN";
    case "BUILDING":
    case "BLOCKED":
    case "NEEDS_DECISION":
    case "ON_HOLD":
      return "BUILD";
    case "READY_FOR_INSPECTION":
    case "VERIFIED":
      return "TEST";
    case "DEPLOYED":
      return "DEPLOY";
    case "COMPLETED":
      return "COMPLETED";
    default:
      return "IDEA";
  }
}
