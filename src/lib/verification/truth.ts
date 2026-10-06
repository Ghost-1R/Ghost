import type { BuildExecutionStatus } from "@/lib/build-execution/types";
import type {
  VerificationCase,
  VerificationDefect,
  VerificationEvidence,
  VerificationProgram,
  VerificationProgramStatus,
} from "./types";
import { isBlockingDefect } from "./workflow";

export type VerificationTruthAnswer = {
  answer: "YES" | "NO" | "UNKNOWN";
  reason: string;
  kind:
    | "RECORDED_FACT"
    | "VERIFICATION_EVIDENCE"
    | "NOT_VERIFIED"
    | "NOT_DEPLOYED"
    | "ASSUMPTION"
    | "MODEL_SUGGESTION"
    | "UNKNOWN";
};

const BOUNDARY =
  "Verification records authoritative test results for an IMPLEMENTED Build Execution. VERIFIED ≠ DEPLOYED. IMPLEMENTED ≠ VERIFIED.";

export function isProgramVerified(status: VerificationProgramStatus | null): VerificationTruthAnswer {
  if (!status) {
    return { answer: "UNKNOWN", reason: "No Verification program is recorded.", kind: "UNKNOWN" };
  }
  if (status === "VERIFIED") {
    return {
      answer: "YES",
      reason: `Program status is VERIFIED with the verification gate passed. ${BOUNDARY}`,
      kind: "VERIFICATION_EVIDENCE",
    };
  }
  return {
    answer: "NO",
    reason: `Program status is ${status}, not VERIFIED.`,
    kind: "RECORDED_FACT",
  };
}

/** V10 is not deployment. */
export function isDeployed(): VerificationTruthAnswer {
  return {
    answer: "NO",
    reason: `${BOUNDARY} Deployment is a later stage.`,
    kind: "NOT_DEPLOYED",
  };
}

export function doesVerifiedMeanDeployed(): VerificationTruthAnswer {
  return {
    answer: "NO",
    reason: `${BOUNDARY} VERIFIED never means deployed.`,
    kind: "NOT_DEPLOYED",
  };
}

export function isImplemented(executionStatus: BuildExecutionStatus | null): VerificationTruthAnswer {
  if (!executionStatus) {
    return { answer: "UNKNOWN", reason: "No Build Execution status is recorded.", kind: "UNKNOWN" };
  }
  if (executionStatus === "IMPLEMENTED") {
    return {
      answer: "YES",
      reason: `Build Execution is IMPLEMENTED. That is not verification or deployment. ${BOUNDARY}`,
      kind: "RECORDED_FACT",
    };
  }
  return {
    answer: "NO",
    reason: `Build Execution is ${executionStatus}, not IMPLEMENTED.`,
    kind: "RECORDED_FACT",
  };
}

export function answerVerificationTruthQuestion(
  question: string,
  input: {
    program: Pick<VerificationProgram, "status"> | null;
    executionStatus?: BuildExecutionStatus | null;
    cases?: Array<
      Pick<VerificationCase, "id" | "humanId" | "title" | "status" | "isRequired" | "requirementId" | "actualResult">
    >;
    evidence?: Array<Pick<VerificationEvidence, "caseId">>;
    defects?: Array<Pick<VerificationDefect, "humanId" | "title" | "status" | "severity" | "blocking">>;
    requirements?: Array<{ id: string; humanId: string; title: string }>;
  },
): VerificationTruthAnswer | null {
  const q = question.toLowerCase();
  const status = input.program?.status ?? null;
  const cases = input.cases ?? [];
  const defects = input.defects ?? [];
  const evidence = input.evidence ?? [];
  const requirements = input.requirements ?? [];
  const executionStatus = input.executionStatus ?? null;

  if (/past (answer|response)|previous ghost|ghost said/.test(q)) {
    return {
      answer: "NO",
      reason: "A past Ghost answer is not authoritative evidence. Use Verification records.",
      kind: "MODEL_SUGGESTION",
    };
  }

  if (/(deployed|in production|live|production ready)/.test(q)) {
    if (/verified.*(mean|deploy)|mean.*(deployed|production)/.test(q)) {
      return doesVerifiedMeanDeployed();
    }
    return isDeployed();
  }
  if (/verified.*(mean|deploy)|mean.*(deployed|production)/.test(q)) {
    return doesVerifiedMeanDeployed();
  }

  if (/is (it |this |the (feature|app|product|program) )?(fully )?verified|is verification (complete|done)|program verified/.test(q)) {
    return isProgramVerified(status);
  }

  if (/is (implementation|execution|build) (complete|implemented)|implementation complete|is (it |this )?implemented/.test(q)) {
    return isImplemented(executionStatus);
  }

  if (/still needs? (testing|test)|needs? (more )?testing|what (still )?needs (to be )?test/.test(q)) {
    const pending = cases.filter(
      (row) =>
        row.isRequired &&
        (row.status === "PLANNED" || row.status === "READY" || row.status === "RUNNING" || row.status === "BLOCKED"),
    );
    if (pending.length === 0) {
      return {
        answer: "NO",
        reason: "No required cases remain in PLANNED, READY, RUNNING, or BLOCKED.",
        kind: "RECORDED_FACT",
      };
    }
    return {
      answer: "YES",
      reason: `${pending.length} required case${pending.length === 1 ? "" : "s"} still need testing (${pending
        .slice(0, 5)
        .map((row) => row.humanId)
        .join(", ")}).`,
      kind: "RECORDED_FACT",
    };
  }

  if (/what failed|which (cases? )?failed|failures?/.test(q)) {
    const failed = cases.filter((row) => row.status === "FAILED");
    if (failed.length === 0) {
      return { answer: "NO", reason: "No verification cases are FAILED.", kind: "RECORDED_FACT" };
    }
    return {
      answer: "YES",
      reason: `Failed: ${failed.map((row) => `${row.humanId}${row.actualResult ? ` (${row.actualResult.slice(0, 80)})` : ""}`).join("; ")}`,
      kind: "RECORDED_FACT",
    };
  }

  if (/why (not|isn't|isnt|aren't|arent).*(verified)|why.*(not verified|verification incomplete)/.test(q)) {
    if (status === "VERIFIED") {
      return {
        answer: "NO",
        reason: "Program is VERIFIED. Gaps for the gate are closed.",
        kind: "VERIFICATION_EVIDENCE",
      };
    }
    const pending = cases.filter(
      (row) =>
        row.isRequired &&
        row.status !== "PASSED" &&
        row.status !== "NOT_APPLICABLE",
    );
    const openBlocking = defects.filter(
      (row) =>
        (row.status === "OPEN" || row.status === "IN_PROGRESS" || row.status === "RETEST_REQUIRED") &&
        isBlockingDefect(row.severity, row.blocking),
    );
    const parts = [
      status ? `program is ${status}` : "program missing",
      pending.length ? `${pending.length} required case(s) incomplete` : null,
      openBlocking.length ? `${openBlocking.length} open blocking defect(s)` : null,
      executionStatus !== "IMPLEMENTED" ? `execution is ${executionStatus ?? "missing"}` : null,
    ].filter(Boolean);
    return {
      answer: "YES",
      reason: `Not VERIFIED because ${parts.join("; ")}. ${BOUNDARY}`,
      kind: "NOT_VERIFIED",
    };
  }

  if (/which requirements?( are)? verified|requirements? verified|verified requirements?/.test(q)) {
    const byReq = new Map<string, typeof cases>();
    for (const row of cases) {
      if (!row.requirementId) continue;
      const list = byReq.get(row.requirementId) ?? [];
      list.push(row);
      byReq.set(row.requirementId, list);
    }
    const verifiedReqs = requirements.filter((req) => {
      const linked = byReq.get(req.id) ?? [];
      return linked.length > 0 && linked.every((row) => row.status === "PASSED" || row.status === "NOT_APPLICABLE");
    });
    if (verifiedReqs.length === 0) {
      return {
        answer: "NO",
        reason: "No requirements have all linked cases PASSED or NOT_APPLICABLE.",
        kind: "RECORDED_FACT",
      };
    }
    return {
      answer: "YES",
      reason: `Verified via cases: ${verifiedReqs.map((row) => row.humanId).join(", ")}.`,
      kind: "VERIFICATION_EVIDENCE",
    };
  }

  if (/prove[sd]? (the )?requirement|does (this|evidence|case) prove/.test(q)) {
    if (evidence.length === 0) {
      return {
        answer: "NO",
        reason: `No verification evidence is recorded. ${BOUNDARY}`,
        kind: "NOT_VERIFIED",
      };
    }
    const passedWithEvidence = cases.filter(
      (row) => row.status === "PASSED" && evidence.some((item) => item.caseId === row.id),
    );
    if (passedWithEvidence.length === 0) {
      return {
        answer: "NO",
        reason: "Evidence exists but no PASSED case is linked to it for a requirement proof.",
        kind: "NOT_VERIFIED",
      };
    }
    return {
      answer: "YES",
      reason: `${passedWithEvidence.length} PASSED case${passedWithEvidence.length === 1 ? "" : "s"} have evidence. That proves recorded verification for those cases only — not deployment.`,
      kind: "VERIFICATION_EVIDENCE",
    };
  }

  if (/blocking defects?|open defects?|what.*(block|defect)/.test(q)) {
    const openBlocking = defects.filter(
      (row) =>
        (row.status === "OPEN" || row.status === "IN_PROGRESS" || row.status === "RETEST_REQUIRED") &&
        isBlockingDefect(row.severity, row.blocking),
    );
    if (openBlocking.length === 0) {
      return {
        answer: "NO",
        reason: "No open blocking defects are recorded.",
        kind: "RECORDED_FACT",
      };
    }
    return {
      answer: "YES",
      reason: openBlocking.map((row) => `${row.humanId}: ${row.title} (${row.status})`).join("; "),
      kind: "RECORDED_FACT",
    };
  }

  if (/retest|needs? retest/.test(q)) {
    const retest = defects.filter((row) => row.status === "RETEST_REQUIRED");
    if (retest.length === 0) {
      return { answer: "NO", reason: "No defects are in RETEST_REQUIRED.", kind: "RECORDED_FACT" };
    }
    return {
      answer: "YES",
      reason: `${retest.map((row) => row.humanId).join(", ")} require retest.`,
      kind: "RECORDED_FACT",
    };
  }

  if (/what (to|should i) test next|next (case|test)|ready to (test|run)/.test(q)) {
    const next = cases.find(
      (row) => row.isRequired && (row.status === "READY" || row.status === "PLANNED" || row.status === "RUNNING"),
    );
    if (!next) {
      return {
        answer: "NO",
        reason: "No required case is READY, PLANNED, or RUNNING.",
        kind: "RECORDED_FACT",
      };
    }
    return {
      answer: "YES",
      reason: `Next: ${next.humanId} — ${next.title} (${next.status}).`,
      kind: "RECORDED_FACT",
    };
  }

  return null;
}
