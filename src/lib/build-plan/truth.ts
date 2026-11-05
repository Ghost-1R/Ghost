import type { BuildPlan, BuildPlanStatus, WorkPackageStatus } from "./types";

export type BuildTruthAnswer = {
  answer: "YES" | "NO" | "UNKNOWN";
  reason: string;
  kind:
    | "RECORDED_FACT"
    | "APPROVED_PLAN"
    | "PROPOSED_PLAN"
    | "PLANNED_WORK"
    | "NOT_IMPLEMENTED"
    | "ASSUMPTION"
    | "MODEL_SUGGESTION"
    | "UNKNOWN";
};

const PLAN_ONLY = "Build Plan is planning only. It does not implement, migrate, verify, or deploy anything.";

export function isPackageImplemented(status: WorkPackageStatus | null): BuildTruthAnswer {
  if (!status) {
    return { answer: "UNKNOWN", reason: "No work package status is recorded.", kind: "UNKNOWN" };
  }
  if (status === "PLANNED" || status === "READY" || status === "BLOCKED") {
    return {
      answer: "NO",
      reason: `Work package status is ${status}. Planned or ready packages are not implemented.`,
      kind: "PLANNED_WORK",
    };
  }
  return {
    answer: "NO",
    reason: `${PLAN_ONLY} Status ${status} is not verified implementation evidence in V8.`,
    kind: "NOT_IMPLEMENTED",
  };
}

export function isMigrationApplied(): BuildTruthAnswer {
  return {
    answer: "NO",
    reason: `${PLAN_ONLY} A planned database impact is not an applied migration.`,
    kind: "NOT_IMPLEMENTED",
  };
}

export function isFeatureBuilt(): BuildTruthAnswer {
  return {
    answer: "NO",
    reason: `${PLAN_ONLY} A linked feature is not built without repository, test, and deploy evidence.`,
    kind: "NOT_IMPLEMENTED",
  };
}

export function didTestsPass(): BuildTruthAnswer {
  return {
    answer: "NO",
    reason: `${PLAN_ONLY} Planned verification is not a passing test result.`,
    kind: "PLANNED_WORK",
  };
}

export function isDeployed(): BuildTruthAnswer {
  return {
    answer: "NO",
    reason: `${PLAN_ONLY} A deployment sequence is a plan, not a deployment.`,
    kind: "NOT_IMPLEMENTED",
  };
}

export function isReadyToCode(status: BuildPlanStatus | null): BuildTruthAnswer {
  if (!status) {
    return { answer: "UNKNOWN", reason: "No Build Plan is recorded.", kind: "UNKNOWN" };
  }
  if (status === "BUILD_PLAN_READY") {
    return {
      answer: "YES",
      reason: "Status is BUILD_PLAN_READY, so coding may begin against the plan. Nothing is implemented or deployed yet.",
      kind: "APPROVED_PLAN",
    };
  }
  return {
    answer: "NO",
    reason: `Status is ${status}, not BUILD_PLAN_READY.`,
    kind: "RECORDED_FACT",
  };
}

export function doesBuildPlanReadyMeanProduction(): BuildTruthAnswer {
  return {
    answer: "NO",
    reason: `${PLAN_ONLY} BUILD_PLAN_READY never means the product is in production.`,
    kind: "NOT_IMPLEMENTED",
  };
}

export function answerBuildPlanTruthQuestion(
  question: string,
  input: {
    plan: Pick<BuildPlan, "status"> | null;
    packageStatuses?: WorkPackageStatus[];
  },
): BuildTruthAnswer | null {
  const q = question.toLowerCase();
  const status = input.plan?.status ?? null;

  if (/past (answer|response)|previous ghost|ghost said/.test(q)) {
    return {
      answer: "NO",
      reason: "A past Ghost answer is not authoritative evidence. Use Build Plan records.",
      kind: "MODEL_SUGGESTION",
    };
  }
  if (/(migration|schema|database).*(applied|deployed|live|ran|running)/.test(q) || /applied.*(migration|schema)/.test(q)) {
    return isMigrationApplied();
  }
  if (/(tests?|verification).*(pass|passed|green|succeed)/.test(q) || /did (the )?tests? pass/.test(q)) {
    return didTestsPass();
  }
  if (/(feature|product|app).*(built|implemented|done|complete)/.test(q) || /is (it|the feature) built/.test(q)) {
    return isFeatureBuilt();
  }
  if (/(package|work package|wp-).*(implemented|built|done)/.test(q) || /implemented/.test(q)) {
    const statuses = input.packageStatuses ?? [];
    if (statuses.length === 0) return isPackageImplemented(null);
    return isPackageImplemented(statuses[0]);
  }
  if (/(deployed|in production|live|production ready)/.test(q)) {
    if (/build.?plan.?ready|ready mean/.test(q)) return doesBuildPlanReadyMeanProduction();
    return isDeployed();
  }
  if (/build.?plan.?ready.*(production|deployed|live)|mean.*(production|deployed)/.test(q)) {
    return doesBuildPlanReadyMeanProduction();
  }
  if (/ready to (start |begin )?cod|can (we|i) (start|begin) cod|is (this|the plan) build.?plan.?ready/.test(q)) {
    return isReadyToCode(status);
  }
  return null;
}
