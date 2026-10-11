/**
 * Pilot 01 end-to-end path definition — documentation + static verification only.
 * Distinguishes Cursor-prepared source from Ghost-executed work.
 * Does not activate workers or dispatch live providers.
 */

export type Pilot01PathStage =
  | "FOUNDER_OBJECTIVE"
  | "DEVELOPMENT_TASK"
  | "AUTHORIZATION"
  | "VALIDATION"
  | "EXECUTION"
  | "BUILD_TEST"
  | "INDEPENDENT_EVIDENCE"
  | "FOUNDER_REVIEW";

export type Pilot01StageRecord = {
  stage: Pilot01PathStage;
  status: "READY" | "PREPARED" | "VERIFIED" | "NOT_IMPLEMENTED" | "NOT_RUN" | "BLOCKED";
  actor: "FOUNDER" | "CURSOR_PREP" | "GHOST_CONTRACT" | "GHOST_RUNTIME" | "NONE";
  detail: string;
};

/**
 * Honest status of the supervised coding demonstration path.
 * Autonomous code generation by Ghost is NOT IMPLEMENTED — sample source is Cursor-prepared.
 */
export function describePilot01ExecutionPath(input?: {
  securitySqlVerified?: boolean;
  dockerPilotRan?: boolean;
  durableWorkflowDispatched?: boolean;
}): Pilot01StageRecord[] {
  return [
    {
      stage: "FOUNDER_OBJECTIVE",
      status: "READY",
      actor: "FOUNDER",
      detail: "Car rental landing page objective defined in Pilot 01 task spec.",
    },
    {
      stage: "DEVELOPMENT_TASK",
      status: "PREPARED",
      actor: "GHOST_CONTRACT",
      detail: "Remote-development / agent-task contracts exist; durable task not live-dispatched in this overnight run.",
    },
    {
      stage: "AUTHORIZATION",
      status: input?.securitySqlVerified ? "VERIFIED" : "PREPARED",
      actor: "GHOST_CONTRACT",
      detail: "ONE_TIME DEVELOPMENT authorization + revoked/expired INSERT gate.",
    },
    {
      stage: "VALIDATION",
      status: "VERIFIED",
      actor: "CURSOR_PREP",
      detail: "Static review + unit harness validate sample workspace content and local form rules.",
    },
    {
      stage: "EXECUTION",
      status: input?.dockerPilotRan
        ? "VERIFIED"
        : input?.durableWorkflowDispatched
          ? "VERIFIED"
          : "NOT_IMPLEMENTED",
      actor: input?.dockerPilotRan ? "GHOST_RUNTIME" : "NONE",
      detail: input?.dockerPilotRan
        ? "Isolated Docker pilot executed predefined fixture (not car-rental codegen)."
        : "Ghost autonomous code generation NOT IMPLEMENTED; car-rental source is Cursor-prepared. Docker fixture pilot may run separately.",
    },
    {
      stage: "BUILD_TEST",
      status: "VERIFIED",
      actor: "CURSOR_PREP",
      detail: "Typecheck/lint/build and focused harness tests run in preparation environment.",
    },
    {
      stage: "INDEPENDENT_EVIDENCE",
      status: "PREPARED",
      actor: "GHOST_CONTRACT",
      detail: "Evidence packs + review artifacts prepared; founder independent verification still required for VERIFIED.",
    },
    {
      stage: "FOUNDER_REVIEW",
      status: "READY",
      actor: "FOUNDER",
      detail: "Awaiting founder Accept / Reject / Request changes — no automatic merge or deploy.",
    },
  ];
}

export function summarizePilot01Attribution(path: Pilot01StageRecord[]): {
  cursorPreparedWork: string[];
  ghostActualExecution: string[];
  notImplemented: string[];
} {
  return {
    cursorPreparedWork: path
      .filter((s) => s.actor === "CURSOR_PREP")
      .map((s) => `${s.stage}: ${s.detail}`),
    ghostActualExecution: path
      .filter((s) => s.actor === "GHOST_RUNTIME" && s.status === "VERIFIED")
      .map((s) => `${s.stage}: ${s.detail}`),
    notImplemented: path
      .filter((s) => s.status === "NOT_IMPLEMENTED")
      .map((s) => `${s.stage}: ${s.detail}`),
  };
}
