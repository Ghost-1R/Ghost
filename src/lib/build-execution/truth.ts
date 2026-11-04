import type { BuildExecution, BuildExecutionStatus, WorkPackageExecution, ImplementationEvidence } from "./types";

export type ExecutionTruthAnswer = {
  answer: "YES" | "NO" | "UNKNOWN";
  reason: string;
  kind:
    | "RECORDED_FACT"
    | "IMPLEMENTATION_EVIDENCE"
    | "NOT_VERIFIED"
    | "NOT_DEPLOYED"
    | "ASSUMPTION"
    | "MODEL_SUGGESTION"
    | "UNKNOWN";
};

const BOUNDARY =
  "Build Execution records implementation evidence only. IMPLEMENTED ≠ VERIFIED ≠ DEPLOYED.";

export function isExecutionImplemented(status: BuildExecutionStatus | null): ExecutionTruthAnswer {
  if (!status) {
    return { answer: "UNKNOWN", reason: "No Build Execution is recorded.", kind: "UNKNOWN" };
  }
  if (status === "IMPLEMENTED") {
    return {
      answer: "YES",
      reason: `Status is IMPLEMENTED with evidence-backed package work. ${BOUNDARY}`,
      kind: "IMPLEMENTATION_EVIDENCE",
    };
  }
  return {
    answer: "NO",
    reason: `Status is ${status}, not IMPLEMENTED.`,
    kind: "RECORDED_FACT",
  };
}

/** V9 is not verification. */
export function isVerified(): ExecutionTruthAnswer {
  return {
    answer: "NO",
    reason: `${BOUNDARY} Verification is a later stage.`,
    kind: "NOT_VERIFIED",
  };
}

/** V9 is not deployment. */
export function isDeployed(): ExecutionTruthAnswer {
  return {
    answer: "NO",
    reason: `${BOUNDARY} Deployment is a later stage.`,
    kind: "NOT_DEPLOYED",
  };
}

export function doesImplementedMeanProduction(): ExecutionTruthAnswer {
  return {
    answer: "NO",
    reason: `${BOUNDARY} IMPLEMENTED never means production.`,
    kind: "NOT_DEPLOYED",
  };
}

export function hasEvidenceForPackage(
  packageExecutionId: string,
  evidence: Array<Pick<ImplementationEvidence, "packageExecutionId">>,
): boolean {
  return evidence.some((row) => row.packageExecutionId === packageExecutionId);
}

export function answerBuildExecutionTruthQuestion(
  question: string,
  input: {
    execution: Pick<BuildExecution, "status"> | null;
    packageExecutions?: Array<Pick<WorkPackageExecution, "status" | "id">>;
    evidence?: Array<Pick<ImplementationEvidence, "packageExecutionId">>;
    openBlockerCount?: number;
  },
): ExecutionTruthAnswer | null {
  const q = question.toLowerCase();
  const status = input.execution?.status ?? null;
  const packages = input.packageExecutions ?? [];
  const evidence = input.evidence ?? [];
  const openBlockers = input.openBlockerCount ?? 0;

  if (/past (answer|response)|previous ghost|ghost said/.test(q)) {
    return {
      answer: "NO",
      reason: "A past Ghost answer is not authoritative evidence. Use Build Execution records.",
      kind: "MODEL_SUGGESTION",
    };
  }

  if (/is (it |this |the (feature|app|product) )?(verified|verification)/.test(q) || /\bverified\b/.test(q)) {
    return isVerified();
  }
  if (/(deployed|in production|live|production ready)/.test(q)) {
    if (/implemented.*(mean|production)|mean.*(production|deployed)/.test(q)) {
      return doesImplementedMeanProduction();
    }
    return isDeployed();
  }
  if (/implemented.*(mean|production)|mean.*(production|deployed)/.test(q)) {
    return doesImplementedMeanProduction();
  }

  if (/building now|in progress|currently (building|implementing)|what.*(building|working on)/.test(q)) {
    const active = packages.filter((row) => row.status === "IN_PROGRESS");
    if (active.length === 0) {
      return {
        answer: "NO",
        reason: "No package execution is IN_PROGRESS.",
        kind: "RECORDED_FACT",
      };
    }
    return {
      answer: "YES",
      reason: `${active.length} package${active.length === 1 ? " is" : "s are"} IN_PROGRESS.`,
      kind: "RECORDED_FACT",
    };
  }

  if (/what('s| is) next|next (package|work)|ready to (start|begin)/.test(q)) {
    const ready = packages.filter((row) => row.status === "READY");
    if (ready.length === 0) {
      return {
        answer: "NO",
        reason: "No package execution is READY.",
        kind: "RECORDED_FACT",
      };
    }
    return {
      answer: "YES",
      reason: `${ready.length} package${ready.length === 1 ? " is" : "s are"} READY.`,
      kind: "RECORDED_FACT",
    };
  }

  if (/why (is it |are we |am i )?blocked|what.*(block|blocker)/.test(q) || /\bblocked\b/.test(q)) {
    const blocked = packages.filter((row) => row.status === "BLOCKED").length;
    if (blocked === 0 && openBlockers === 0) {
      return {
        answer: "NO",
        reason: "No package executions are BLOCKED and no open execution blockers are recorded.",
        kind: "RECORDED_FACT",
      };
    }
    return {
      answer: "YES",
      reason: `${blocked} package${blocked === 1 ? "" : "s"} BLOCKED; ${openBlockers} open blocker record${openBlockers === 1 ? "" : "s"}.`,
      kind: "RECORDED_FACT",
    };
  }

  if (/how much.*(implemented|done|complete)|progress|coverage/.test(q)) {
    if (packages.length === 0) {
      return { answer: "UNKNOWN", reason: "No package executions are recorded.", kind: "UNKNOWN" };
    }
    const done = packages.filter((row) => row.status === "IMPLEMENTED").length;
    return {
      answer: done === packages.length ? "YES" : "NO",
      reason: `${done} of ${packages.length} package executions are IMPLEMENTED. ${BOUNDARY}`,
      kind: "RECORDED_FACT",
    };
  }

  if (/proves? (the )?feature|evidence.*(feature|prove)|does evidence prove/.test(q)) {
    if (evidence.length === 0) {
      return {
        answer: "NO",
        reason: `No implementation evidence is recorded. ${BOUNDARY}`,
        kind: "NOT_VERIFIED",
      };
    }
    return {
      answer: "NO",
      reason: `Implementation evidence references exist, but they do not prove verification or that a feature works in production. ${BOUNDARY}`,
      kind: "NOT_VERIFIED",
    };
  }

  if (
    /is (it |this |the (execution|build|project|product|app) )?(fully )?implemented|is execution implemented|project implemented/.test(
      q,
    )
  ) {
    return isExecutionImplemented(status);
  }

  return null;
}
