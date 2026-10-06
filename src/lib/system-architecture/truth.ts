import type { SystemArchitecture, SystemArchitectureStatus, SystemEntity } from "./types";

export type SystemTruthAnswer = {
  answer: "YES" | "NO" | "UNKNOWN";
  reason: string;
  kind:
    | "RECORDED_FACT"
    | "APPROVED_DESIGN"
    | "PROPOSED_DESIGN"
    | "PLANNED_CONTROL"
    | "NOT_IMPLEMENTED"
    | "ASSUMPTION"
    | "MODEL_SUGGESTION"
    | "UNKNOWN";
};

const DESIGN_ONLY = "System Architecture is design only. It does not implement, migrate, or deploy anything.";

export function isArchitectureApproved(status: SystemArchitectureStatus | null): SystemTruthAnswer {
  if (!status) {
    return { answer: "UNKNOWN", reason: "No System Architecture is recorded.", kind: "UNKNOWN" };
  }
  if (status === "APPROVED" || status === "ARCHITECTURE_READY") {
    return { answer: "YES", reason: `System Architecture status is ${status}.`, kind: "APPROVED_DESIGN" };
  }
  return {
    answer: "NO",
    reason: `System Architecture status is ${status}. Only APPROVED or ARCHITECTURE_READY counts as approved design.`,
    kind: "PROPOSED_DESIGN",
  };
}

export function isReadyForBuildPlan(status: SystemArchitectureStatus | null, reasons: string[]): SystemTruthAnswer {
  if (!status) {
    return { answer: "UNKNOWN", reason: "No System Architecture is recorded.", kind: "UNKNOWN" };
  }
  if (status === "ARCHITECTURE_READY") {
    return {
      answer: "YES",
      reason: "Status is ARCHITECTURE_READY, so the design may feed a build plan. The product is still not built or deployed.",
      kind: "APPROVED_DESIGN",
    };
  }
  return {
    answer: "NO",
    reason: `Status is ${status}, not ARCHITECTURE_READY. ${reasons[0] ?? "Readiness gaps remain."}`,
    kind: "RECORDED_FACT",
  };
}

export function isArchitectureImplemented(): SystemTruthAnswer {
  return {
    answer: "NO",
    reason: `${DESIGN_ONLY} Implementation needs verified repository, test, and deploy evidence.`,
    kind: "NOT_IMPLEMENTED",
  };
}

export function isDatabaseDeployed(): SystemTruthAnswer {
  return {
    answer: "NO",
    reason: `${DESIGN_ONLY} Designed entities are not a deployed database. Migrations and remote schema must be verified separately.`,
    kind: "NOT_IMPLEMENTED",
  };
}

export function isApiLive(): SystemTruthAnswer {
  return {
    answer: "NO",
    reason: `${DESIGN_ONLY} Designed interfaces are not live endpoints.`,
    kind: "NOT_IMPLEMENTED",
  };
}

export function isProductDeployedFromArchitecture(): SystemTruthAnswer {
  return {
    answer: "NO",
    reason: `${DESIGN_ONLY} Architecture readiness never means the product is deployed.`,
    kind: "NOT_IMPLEMENTED",
  };
}

export function doesRlsProtect(entities: Array<Pick<SystemEntity, "humanId" | "rlsExpectation" | "status">>): SystemTruthAnswer {
  const planned = entities.filter((entity) => entity.status !== "REJECTED" && entity.status !== "RETIRED" && entity.rlsExpectation.trim());
  if (planned.length === 0) {
    return {
      answer: "NO",
      reason: "No RLS expectation is even designed yet, and RLS is not implemented by architecture records.",
      kind: "PLANNED_CONTROL",
    };
  }
  return {
    answer: "NO",
    reason: `RLS is designed/planned for ${planned.map((entity) => entity.humanId).join(", ")} but not implemented. Protection exists only after policies are migrated and verified.`,
    kind: "PLANNED_CONTROL",
  };
}

export function answerSystemTruthQuestion(
  question: string,
  input: {
    architecture: Pick<SystemArchitecture, "status"> | null;
    readinessReasons: string[];
    entities: Array<Pick<SystemEntity, "humanId" | "rlsExpectation" | "status">>;
  },
): SystemTruthAnswer | null {
  const q = question.toLowerCase();
  const status = input.architecture?.status ?? null;

  if (/past (answer|response)|previous ghost|ghost said/.test(q)) {
    return {
      answer: "NO",
      reason: "A past Ghost answer is not authoritative evidence. Use System Architecture records.",
      kind: "MODEL_SUGGESTION",
    };
  }
  if (/\brls\b|row[- ]level|policies protect|protect/.test(q)) {
    return doesRlsProtect(input.entities);
  }
  if (/(database|schema|migrations?|tables?)\b.*(deployed|applied|live|exists?|created|running)/.test(q)) {
    return isDatabaseDeployed();
  }
  if (/\b(apis?|endpoints?|interfaces?)\b.*(live|deployed|running|available|exists?)/.test(q)) {
    return isApiLive();
  }
  if (/implement|built yet|is it built/.test(q)) {
    return isArchitectureImplemented();
  }
  if (/build plan|ready for build/.test(q)) {
    return isReadyForBuildPlan(status, input.readinessReasons);
  }
  if (/(architecture|design).*(approved|signed off)|approved.*(architecture|design)/.test(q)) {
    return isArchitectureApproved(status);
  }
  if (/(product|app|system|it).*(deployed|in production|live)|deployed|in production/.test(q)) {
    return isProductDeployedFromArchitecture();
  }
  return null;
}
