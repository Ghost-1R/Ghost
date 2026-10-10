import { randomUUID } from "node:crypto";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import {
  decideApprove,
  decideRevoke,
  effectiveAuthorizationStatus,
  scopeFingerprint,
} from "@/lib/approvals/workflow";
import { createRemoteDevTask, transitionRemoteDevTask } from "./contract";
import {
  elapsedMsSinceTaskCreated,
  gateRemoteDevQueue,
  gateRemoteDevStep,
} from "./authorization-gate";
import { FakeRemoteExecutionProvider } from "./fake-provider";
import { independentlyVerifyEvidence } from "./github-evidence";
import {
  MEMORY_PERSISTENCE_MODE,
  memoryAppendEvent,
  memoryConsumeAuthorizationCas,
  memoryHaltExecution,
  memoryIsAuthConsumed,
  memoryIsExecutionHalted,
  memoryLoadAuthorization,
  memoryLoadTask,
  memorySaveAuthorization,
  memorySaveTask,
  type PersistenceMode,
} from "./memory-store";
import {
  assertSimulatedCannotVerifyProjectTruth,
  reportSimulatedOutcomeForProjectTruth,
} from "./project-truth-boundary";
import { applyFounderReviewAction } from "./review";
import { runSimulatedHappyPath, simulateProviderStep, SIMULATION_LABEL } from "./simulate";
import type { RemoteDevTask } from "./types";

export const WORKFLOW_STAGES = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "APPROVED",
  "QUEUED",
  "RUNNING",
  "FAILED",
  "BLOCKED",
  "AWAITING_REVIEW",
  "REVIEWED",
] as const;

export type DevelopmentWorkflowStage = (typeof WORKFLOW_STAGES)[number];

export type DevelopmentWorkflowSession = {
  task: RemoteDevTask;
  authorization: FounderActionAuthorization;
  authorizationConsumed: boolean;
  stage: DevelopmentWorkflowStage;
  persistenceMode: PersistenceMode;
  simulationLabel: typeof SIMULATION_LABEL | "NONE";
  provider: FakeRemoteExecutionProvider | null;
  nextAction: string;
};

export type DevelopmentRequestInput = {
  ownerId: string;
  projectId: string;
  projectName: string;
  objective: string;
  repository: string;
  approvedBaseBranch: string;
  environmentLabel?: string;
  maxEstimatedCostUsd: number;
  maxDurationMs: number;
  requirements?: string;
  evidenceSource?: string;
  evidenceReference?: string;
  idempotencyKey?: string;
  expiresInHours?: number;
  at?: string;
};

export function deriveWorkflowStage(
  task: RemoteDevTask,
  auth: FounderActionAuthorization,
): DevelopmentWorkflowStage {
  const effective = effectiveAuthorizationStatus(auth.status, auth.expiresAt);
  if (task.status === "VERIFIED") return "REVIEWED";
  if (task.status === "AWAITING_FOUNDER_REVIEW") return "AWAITING_REVIEW";
  if (task.status === "FAILED") return "FAILED";
  if (task.status === "BLOCKED") return "BLOCKED";
  if (task.status === "RUNNING") return "RUNNING";
  if (task.status === "QUEUED") return "QUEUED";
  if (task.status === "CANCELLED") return "FAILED";
  if (task.status === "AWAITING_APPROVAL") {
    if (effective === "APPROVED") return "APPROVED";
    if (effective === "PENDING") return "AWAITING_APPROVAL";
    return "DRAFT";
  }
  return "DRAFT";
}

function nextActionFor(stage: DevelopmentWorkflowStage): string {
  switch (stage) {
    case "DRAFT":
    case "AWAITING_APPROVAL":
      return "Approve the exact DEVELOPMENT authorization in Founder Approval Center.";
    case "APPROVED":
      return "Queue the task (authorization revalidated at the execution boundary).";
    case "QUEUED":
      return "Run SIMULATED fake-provider execution (no external dispatch).";
    case "RUNNING":
      return "Wait for SIMULATED provider progress or cancel.";
    case "FAILED":
    case "BLOCKED":
      return "Inspect errors/blockers; retry only with valid authorization.";
    case "AWAITING_REVIEW":
      return "Independently verify SIMULATED evidence (separate step), then accept or reject.";
    case "REVIEWED":
      return "No Project Truth verification claimed — decide next real development step.";
    default:
      return "Inspect workflow state.";
  }
}

function sessionOf(
  task: RemoteDevTask,
  auth: FounderActionAuthorization,
  extras?: Partial<DevelopmentWorkflowSession>,
): DevelopmentWorkflowSession {
  const stage = deriveWorkflowStage(task, auth);
  return {
    task,
    authorization: auth,
    authorizationConsumed: extras?.authorizationConsumed ?? false,
    stage,
    persistenceMode: extras?.persistenceMode ?? MEMORY_PERSISTENCE_MODE,
    simulationLabel: extras?.simulationLabel ?? "NONE",
    provider: extras?.provider ?? null,
    nextAction: nextActionFor(stage),
  };
}

/**
 * Create a founder development request: PENDING authorization + remote-dev task.
 * Persists to in-memory test adapter (durable DB is optional and separate).
 */
export function createDevelopmentRequest(
  input: DevelopmentRequestInput,
): { ok: true; session: DevelopmentWorkflowSession } | { ok: false; reason: string; message: string } {
  if (!input.ownerId.trim() || !input.projectId.trim()) {
    return { ok: false, reason: "MISSING_IDENTITY", message: "Owner and project are required." };
  }
  if (!input.objective.trim() || input.objective.trim().length < 8) {
    return { ok: false, reason: "MISSING_OBJECTIVE", message: "A concrete objective is required." };
  }
  if (!input.repository.includes("/")) {
    return { ok: false, reason: "MISSING_REPOSITORY", message: "Repository owner/name is required." };
  }
  if (!input.approvedBaseBranch.trim()) {
    return { ok: false, reason: "MISSING_BASE_BRANCH", message: "Approved base branch is required." };
  }
  if (!Number.isFinite(input.maxEstimatedCostUsd) || input.maxEstimatedCostUsd < 0 || input.maxEstimatedCostUsd > 500) {
    return { ok: false, reason: "INVALID_BUDGET", message: "Spending budget must be between 0 and 500 USD." };
  }
  if (!Number.isFinite(input.maxDurationMs) || input.maxDurationMs < 60_000 || input.maxDurationMs > 86_400_000) {
    return { ok: false, reason: "INVALID_DURATION", message: "Duration must be between 1 minute and 24 hours." };
  }

  const at = input.at ?? new Date().toISOString();
  const environmentLabel = (input.environmentLabel ?? "REMOTE_DEV").trim() || "REMOTE_DEV";
  const actionType = "agent_task.develop";
  const actionScope = `repo:${input.repository.trim()}@${input.approvedBaseBranch.trim()}|obj:${input.objective.trim().slice(0, 200)}`;
  const fingerprint = scopeFingerprint({
    projectId: input.projectId,
    actionType,
    actionScope,
    environmentLabel,
  });
  const hours = input.expiresInHours ?? 24;
  const expiresAt = new Date(Date.parse(at) + hours * 60 * 60 * 1000).toISOString();
  const authId = randomUUID();
  const idempotencyKey = input.idempotencyKey?.trim() || `devreq-${randomUUID()}`;

  const authorization: FounderActionAuthorization = {
    id: authId,
    ownerId: input.ownerId.trim(),
    projectId: input.projectId.trim(),
    projectName: input.projectName.trim() || "Project",
    environmentLabel,
    decisionId: null,
    actionType,
    actionScope,
    scopeFingerprint: fingerprint,
    reason: input.requirements?.trim() || input.objective.trim(),
    evidence:
      input.evidenceSource && input.evidenceReference
        ? [{ source: input.evidenceSource, reference: input.evidenceReference, at }]
        : [{ source: "founder_request", reference: idempotencyKey, at }],
    sideEffects: "SIMULATED remote development only — no deployment permission.",
    estimatedCost: `USD ${input.maxEstimatedCostUsd}`,
    status: "PENDING",
    effectiveStatus: "PENDING",
    reusePolicy: "ONE_TIME",
    maxUses: null,
    useCount: 0,
    expiresAt,
    requestedAt: at,
    decidedAt: null,
    decidedBy: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: "",
    consumedAt: null,
    idempotencyKey,
  };

  const created = createRemoteDevTask({
    ownerId: input.ownerId,
    projectId: input.projectId,
    projectName: input.projectName,
    objective: input.objective,
    authorizationId: authId,
    authorizationKind: "DEVELOPMENT",
    actionType,
    actionScope,
    environmentLabel,
    scopeFingerprint: fingerprint,
    repository: input.repository,
    approvedBaseBranch: input.approvedBaseBranch,
    maxEstimatedCostUsd: input.maxEstimatedCostUsd,
    maxDurationMs: input.maxDurationMs,
    idempotencyKey,
    at,
  });
  if (!created.ok) {
    return { ok: false, reason: created.reason, message: created.message };
  }

  memorySaveAuthorization(authorization);
  memorySaveTask(created.task);
  memoryAppendEvent({
    taskId: created.task.id,
    eventType: "REQUEST_CREATED",
    detail: "Development request created; authorization PENDING. Persistence: MEMORY_TEST_ONLY.",
    at,
    simulationLabel: "NONE",
  });

  return {
    ok: true,
    session: sessionOf(created.task, authorization, {
      persistenceMode: MEMORY_PERSISTENCE_MODE,
      simulationLabel: "NONE",
    }),
  };
}

export function approveDevelopmentRequest(
  session: DevelopmentWorkflowSession,
  actorId: string,
  at?: string,
): { ok: true; session: DevelopmentWorkflowSession } | { ok: false; reason: string; message: string } {
  const decision = decideApprove(session.authorization, actorId, at);
  if (!decision.ok) {
    return { ok: false, reason: "APPROVAL_DENIED", message: decision.reason };
  }
  const authorization: FounderActionAuthorization = {
    ...session.authorization,
    status: "APPROVED",
    effectiveStatus: "APPROVED",
    decidedAt: at ?? new Date().toISOString(),
    decidedBy: actorId,
  };
  memorySaveAuthorization(authorization);
  memoryAppendEvent({
    taskId: session.task.id,
    eventType: "AUTHORIZATION_APPROVED",
    detail: "Founder approved DEVELOPMENT authorization. Approval does not execute.",
    at: authorization.decidedAt!,
    simulationLabel: "NONE",
  });
  return {
    ok: true,
    session: sessionOf(session.task, authorization, {
      persistenceMode: session.persistenceMode,
      authorizationConsumed: session.authorizationConsumed,
      provider: session.provider,
      simulationLabel: session.simulationLabel,
    }),
  };
}

/**
 * Queue only after authorization gate revalidation. Consumes ONE_TIME via CAS on success.
 */
export function queueDevelopmentTask(
  session: DevelopmentWorkflowSession,
  options?: { at?: string; estimatedCostUsd?: number | null },
): { ok: true; session: DevelopmentWorkflowSession } | { ok: false; reason: string; message: string } {
  const auth = memoryLoadAuthorization(session.authorization.id) ?? session.authorization;
  const at = options?.at ?? new Date().toISOString();
  const plannedCost =
    options?.estimatedCostUsd !== undefined
      ? options.estimatedCostUsd
      : session.task.spending.maxEstimatedCostUsd;
  const gate = gateRemoteDevQueue(auth, session.task, {
    at,
    estimatedCostUsd: plannedCost,
    elapsedMs: elapsedMsSinceTaskCreated(session.task, at),
  });
  if (!gate.ok) {
    return { ok: false, reason: gate.reason, message: gate.message };
  }

  const queued = transitionRemoteDevTask(session.task, "QUEUED", {
    ownerId: session.task.ownerId,
    at,
  });
  if (!queued.ok) {
    return { ok: false, reason: "ILLEGAL_TRANSITION", message: queued.reason };
  }

  let authorization = auth;
  let authorizationConsumed = session.authorizationConsumed;
  if (gate.shouldConsume) {
    const consumed = memoryConsumeAuthorizationCas(auth.id, at);
    if (!consumed.ok) {
      return {
        ok: false,
        reason: consumed.reason,
        message: `Authorization consumption failed closed: ${consumed.reason}`,
      };
    }
    authorization = consumed.authorization;
    authorizationConsumed = consumed.consumedFully || authorizationConsumed;
  } else {
    authorization = { ...auth, useCount: auth.useCount + 1 };
    memorySaveAuthorization(authorization);
  }
  memorySaveTask(queued.task);
  memoryAppendEvent({
    taskId: queued.task.id,
    eventType: "QUEUED",
    detail: "Task queued after authorization revalidation at execution boundary.",
    at: queued.task.queuedAt ?? queued.task.updatedAt,
    simulationLabel: "NONE",
  });

  return {
    ok: true,
    session: sessionOf(queued.task, authorization, {
      persistenceMode: session.persistenceMode,
      authorizationConsumed,
      provider: session.provider,
      simulationLabel: session.simulationLabel,
    }),
  };
}

export function runSimulatedExecution(
  session: DevelopmentWorkflowSession,
): { ok: true; session: DevelopmentWorkflowSession } | { ok: false; reason: string; message: string } {
  if (session.task.status !== "QUEUED") {
    return { ok: false, reason: "INVALID_STATUS", message: "SIMULATED execution requires QUEUED." };
  }
  const auth = memoryLoadAuthorization(session.authorization.id) ?? session.authorization;
  const at = new Date().toISOString();
  const stepGate = gateRemoteDevStep(auth, session.task, {
    authorizationConsumed: session.authorizationConsumed || memoryIsAuthConsumed(auth.id),
    at,
    estimatedCostUsd: session.task.spending.maxEstimatedCostUsd,
    elapsedMs: elapsedMsSinceTaskCreated(session.task, at),
  });
  if (!stepGate.ok) {
    return { ok: false, reason: stepGate.reason, message: stepGate.message };
  }

  const sim = runSimulatedHappyPath({
    task: session.task,
    ownerId: session.task.ownerId,
    provider: session.provider ?? new FakeRemoteExecutionProvider(),
  });
  if (!sim.ok) {
    return { ok: false, reason: sim.reason, message: sim.message };
  }

  memorySaveTask(sim.task);
  memoryAppendEvent({
    taskId: sim.task.id,
    eventType: "SIMULATED_EXECUTION",
    detail: sim.detail,
    at: sim.task.updatedAt,
    simulationLabel: SIMULATION_LABEL,
  });

  const truth = reportSimulatedOutcomeForProjectTruth(sim.task);
  const prevented = assertSimulatedCannotVerifyProjectTruth({
    simulationLabel: SIMULATION_LABEL,
    requestedOperationalState: "VERIFIED_LOCALLY",
  });
  // Guard must deny VERIFIED_LOCALLY for SIMULATED outcomes (fail closed if broken).
  if (prevented.ok || truth.mapsToVerifiedLocally || truth.mapsToVerifiedInProduction) {
    return {
      ok: false,
      reason: "FALSE_SUCCESS_GUARD_BROKEN",
      message: "SIMULATED false-success prevention failed open.",
    };
  }

  return {
    ok: true,
    session: sessionOf(sim.task, auth, {
      persistenceMode: session.persistenceMode,
      authorizationConsumed: session.authorizationConsumed || memoryIsAuthConsumed(auth.id),
      provider: sim.provider,
      simulationLabel: SIMULATION_LABEL,
    }),
  };
}

export function cancelSimulatedExecution(
  session: DevelopmentWorkflowSession,
): { ok: true; session: DevelopmentWorkflowSession } | { ok: false; reason: string; message: string } {
  const provider = session.provider ?? new FakeRemoteExecutionProvider();
  if (!session.task.externalJobId) {
    // Not yet submitted — cancel task locally
    const cancelled = transitionRemoteDevTask(session.task, "CANCELLED", {
      ownerId: session.task.ownerId,
    });
    if (!cancelled.ok) return { ok: false, reason: "ILLEGAL_TRANSITION", message: cancelled.reason };
    memorySaveTask(cancelled.task);
    return {
      ok: true,
      session: sessionOf(cancelled.task, session.authorization, {
        persistenceMode: session.persistenceMode,
        authorizationConsumed: session.authorizationConsumed,
        provider,
        simulationLabel: session.simulationLabel,
      }),
    };
  }
  const result = simulateProviderStep({
    task: session.task,
    provider,
    step: "CANCEL",
    ownerId: session.task.ownerId,
  });
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  memorySaveTask(result.task);
  return {
    ok: true,
    session: sessionOf(result.task, session.authorization, {
      persistenceMode: session.persistenceMode,
      authorizationConsumed: session.authorizationConsumed,
      provider,
      simulationLabel: SIMULATION_LABEL,
    }),
  };
}

/**
 * Separate founder independent evidence check — must not be collapsed into Accept.
 * Still does not grant Project Truth verification.
 */
export function verifySimulatedEvidence(
  session: DevelopmentWorkflowSession,
  actorId: string,
  options?: { at?: string; accept?: boolean },
): { ok: true; session: DevelopmentWorkflowSession } | { ok: false; reason: string; message: string } {
  if (actorId !== session.task.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: "Only the owning founder can verify evidence." };
  }
  if (session.task.status !== "AWAITING_FOUNDER_REVIEW") {
    return {
      ok: false,
      reason: "INVALID_STATUS",
      message: "Independent evidence verification requires AWAITING_FOUNDER_REVIEW.",
    };
  }
  if (!session.task.evidence) {
    return { ok: false, reason: "MISSING_EVIDENCE", message: "No evidence is available to verify." };
  }
  if (session.task.evidence.verificationState !== "UNVERIFIED") {
    return {
      ok: false,
      reason: "ALREADY_CHECKED",
      message: "Evidence has already been independently checked.",
    };
  }
  const evidence = independentlyVerifyEvidence(session.task.evidence, {
    at: options?.at,
    accept: options?.accept,
  });
  const task = { ...session.task, evidence, updatedAt: evidence.independentlyCheckedAt ?? session.task.updatedAt };
  memorySaveTask(task);
  memoryAppendEvent({
    taskId: task.id,
    eventType: "EVIDENCE_INDEPENDENTLY_CHECKED",
    detail: `${SIMULATION_LABEL}: founder independently checked evidence → ${evidence.verificationState}. Not Project Truth.`,
    at: task.updatedAt,
    simulationLabel: SIMULATION_LABEL,
  });
  return {
    ok: true,
    session: sessionOf(task, session.authorization, {
      persistenceMode: session.persistenceMode,
      authorizationConsumed: session.authorizationConsumed,
      provider: session.provider,
      simulationLabel: SIMULATION_LABEL,
    }),
  };
}

export function reviewSimulatedOutcome(
  session: DevelopmentWorkflowSession,
  action: "ACCEPT" | "REJECT",
  actorId: string,
): { ok: true; session: DevelopmentWorkflowSession } | { ok: false; reason: string; message: string } {
  if (actorId !== session.task.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: "Only the owning founder can review." };
  }
  let task = session.task;
  if (action === "ACCEPT") {
    // Fail closed: Accept must not auto-flip UNVERIFIED → VERIFIED.
    const reviewed = applyFounderReviewAction(task, "MARK_VERIFIED", { ownerId: actorId });
    if (!reviewed.ok) return { ok: false, reason: reviewed.reason, message: reviewed.message };
    task = reviewed.task;
  } else {
    const rejected = applyFounderReviewAction(task, "REJECT", { ownerId: actorId });
    if (!rejected.ok) return { ok: false, reason: rejected.reason, message: rejected.message };
    task = rejected.task;
  }

  const truth = reportSimulatedOutcomeForProjectTruth(task);
  if (truth.mapsToVerifiedLocally || truth.mapsToVerifiedInProduction) {
    return {
      ok: false,
      reason: "FALSE_SUCCESS_PREVENTED",
      message: "Review must not map SIMULATED work to Project Truth verified states.",
    };
  }

  memorySaveTask(task);
  memoryAppendEvent({
    taskId: task.id,
    eventType: action === "ACCEPT" ? "REVIEW_ACCEPTED" : "REVIEW_REJECTED",
    detail: `${SIMULATION_LABEL}: founder ${action.toLowerCase()}. ${truth.summary}`,
    at: task.updatedAt,
    simulationLabel: SIMULATION_LABEL,
  });

  return {
    ok: true,
    session: sessionOf(task, session.authorization, {
      persistenceMode: session.persistenceMode,
      authorizationConsumed: session.authorizationConsumed,
      provider: session.provider,
      simulationLabel: SIMULATION_LABEL,
    }),
  };
}

/**
 * Revoke APPROVED auth, or halt in-flight execution after ONE_TIME consumption.
 * CONSUMED → REVOKED is not rewritten (durable auth identity forbids it); task is cancelled instead.
 */
export function revokeDevelopmentAuthorization(
  session: DevelopmentWorkflowSession,
  actorId: string,
  reason: string,
): { ok: true; session: DevelopmentWorkflowSession } | { ok: false; reason: string; message: string } {
  if (actorId !== session.task.ownerId) {
    return { ok: false, reason: "REVOKE_DENIED", message: "Only the owning founder can revoke." };
  }
  if (!reason.trim()) {
    return { ok: false, reason: "REVOKE_DENIED", message: "A revoke reason is required." };
  }

  const auth = memoryLoadAuthorization(session.authorization.id) ?? session.authorization;
  const inFlight =
    session.task.status === "QUEUED" ||
    session.task.status === "RUNNING" ||
    session.task.status === "BLOCKED";

  // Post-consume kill switch: halt execution without rewriting CONSUMED → REVOKED.
  if (auth.status === "CONSUMED" || session.authorizationConsumed || memoryIsAuthConsumed(auth.id)) {
    if (!inFlight && session.task.status !== "AWAITING_FOUNDER_REVIEW") {
      return {
        ok: false,
        reason: "REVOKE_DENIED",
        message: "Consumed authorization cannot be revoked; no in-flight execution to halt.",
      };
    }
    memoryHaltExecution(auth.id);
    let task = session.task;
    if (inFlight || session.task.status === "AWAITING_FOUNDER_REVIEW") {
      const cancelled = transitionRemoteDevTask(session.task, "CANCELLED", {
        ownerId: session.task.ownerId,
      });
      if (!cancelled.ok) {
        return { ok: false, reason: "ILLEGAL_TRANSITION", message: cancelled.reason };
      }
      task = cancelled.task;
      memorySaveTask(task);
    }
    memoryAppendEvent({
      taskId: task.id,
      eventType: "EXECUTION_HALTED",
      detail: `Post-consume execution halt: ${reason.trim().slice(0, 500)}`,
      at: task.updatedAt,
      simulationLabel: session.simulationLabel === "SIMULATED" ? "SIMULATED" : "NONE",
    });
    return {
      ok: true,
      session: sessionOf(task, auth, {
        persistenceMode: session.persistenceMode,
        authorizationConsumed: true,
        provider: session.provider,
        simulationLabel: session.simulationLabel,
      }),
    };
  }

  const decision = decideRevoke(auth, actorId, reason);
  if (!decision.ok) {
    return { ok: false, reason: "REVOKE_DENIED", message: decision.reason };
  }
  const authorization: FounderActionAuthorization = {
    ...auth,
    status: "REVOKED",
    effectiveStatus: "REVOKED",
    revokedAt: new Date().toISOString(),
    revokedBy: actorId,
    revokeReason: reason,
  };
  memoryHaltExecution(authorization.id);
  memorySaveAuthorization(authorization);

  let task = session.task;
  if (inFlight) {
    const cancelled = transitionRemoteDevTask(session.task, "CANCELLED", {
      ownerId: session.task.ownerId,
    });
    if (cancelled.ok) {
      task = cancelled.task;
      memorySaveTask(task);
    }
  }

  return {
    ok: true,
    session: sessionOf(task, authorization, {
      persistenceMode: session.persistenceMode,
      authorizationConsumed: session.authorizationConsumed,
      provider: session.provider,
      simulationLabel: session.simulationLabel,
    }),
  };
}

/** Reload session from memory adapter (test/demo path). */
export function loadMemoryWorkflowSession(
  taskId: string,
): DevelopmentWorkflowSession | null {
  const task = memoryLoadTask(taskId);
  if (!task) return null;
  const auth = memoryLoadAuthorization(task.binding.authorizationId);
  if (!auth) return null;
  return sessionOf(task, auth, {
    persistenceMode: MEMORY_PERSISTENCE_MODE,
    authorizationConsumed: memoryIsAuthConsumed(auth.id) || memoryIsExecutionHalted(auth.id),
    simulationLabel: task.providerKind === "FAKE" && task.externalJobId ? SIMULATION_LABEL : "NONE",
  });
}

/**
 * Full happy-path for unit tests: request → approve → queue → simulate → verify evidence → review.
 */
export function runEndToEndSimulatedWorkflow(
  input: DevelopmentRequestInput,
): { ok: true; session: DevelopmentWorkflowSession } | { ok: false; reason: string; message: string } {
  const created = createDevelopmentRequest(input);
  if (!created.ok) return created;
  const approved = approveDevelopmentRequest(created.session, input.ownerId);
  if (!approved.ok) return approved;
  const queued = queueDevelopmentTask(approved.session);
  if (!queued.ok) return queued;
  const simulated = runSimulatedExecution(queued.session);
  if (!simulated.ok) return simulated;
  const verified = verifySimulatedEvidence(simulated.session, input.ownerId);
  if (!verified.ok) return verified;
  return reviewSimulatedOutcome(verified.session, "ACCEPT", input.ownerId);
}
