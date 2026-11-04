import type { AgentTask } from "@/lib/agent-runtime/types";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { effectiveAuthorizationStatus } from "@/lib/approvals/workflow";
import { suggestRemoteProgressFromAgent } from "./relationship";
import type { RemoteDevTask } from "./types";

/**
 * Single consistent state projection for Operations + development-task review.
 * Distinguishes requested → approved → queued → running → review → verified
 * without inventing progress metrics or Project Truth verification.
 */

export const DEVELOPMENT_PROJECTION_STATES = [
  "TASK_REQUESTED",
  "AWAITING_APPROVAL",
  "AUTHORIZED",
  "QUEUED",
  "RUNNING",
  "FAILED_OR_BLOCKED",
  "AWAITING_REVIEW",
  "INDEPENDENTLY_VERIFIED",
  "FOUNDER_ACCEPTED",
] as const;

export type DevelopmentProjectionState = (typeof DEVELOPMENT_PROJECTION_STATES)[number];

export type DevelopmentStateProjection = {
  remoteTaskId: string;
  agentTaskId: string | null;
  authorizationId: string;
  projectId: string;
  projectName: string;
  objective: string;
  state: DevelopmentProjectionState;
  remoteStatus: RemoteDevTask["status"];
  agentStatus: AgentTask["status"] | null;
  approvalEffectiveStatus: string;
  evidenceState: string;
  independentlyVerified: boolean;
  simulationLabel: "SIMULATED" | "NONE";
  persistenceMode: "DATABASE" | "MEMORY_TEST_ONLY" | "UNAVAILABLE";
  deploymentAuthorized: false;
  projectTruthNote: string;
  nextAction: string;
};

export function projectDevelopmentState(input: {
  remote: RemoteDevTask;
  authorization: FounderActionAuthorization | null;
  agent: AgentTask | null;
  persistenceMode: DevelopmentStateProjection["persistenceMode"];
  simulationLabel?: "SIMULATED" | "NONE";
  at?: string;
}): DevelopmentStateProjection {
  const authStatus = input.authorization
    ? effectiveAuthorizationStatus(
        input.authorization.status,
        input.authorization.expiresAt,
        input.at,
      )
    : "MISSING";
  const evidenceState = input.remote.evidence?.verificationState ?? "NONE";
  const independentlyVerified =
    evidenceState === "VERIFIED" && Boolean(input.remote.evidence?.independentlyCheckedAt);

  let state: DevelopmentProjectionState = "TASK_REQUESTED";
  if (input.remote.status === "VERIFIED") {
    state = "FOUNDER_ACCEPTED";
  } else if (input.remote.status === "AWAITING_FOUNDER_REVIEW") {
    state = independentlyVerified ? "INDEPENDENTLY_VERIFIED" : "AWAITING_REVIEW";
  } else if (input.remote.status === "FAILED" || input.remote.status === "BLOCKED" || input.remote.status === "CANCELLED") {
    state = "FAILED_OR_BLOCKED";
  } else if (input.remote.status === "RUNNING") {
    state = "RUNNING";
  } else if (input.remote.status === "QUEUED") {
    state = "QUEUED";
    if (input.agent) {
      const hint = suggestRemoteProgressFromAgent(input.agent.status);
      if (hint === "RUNNING") state = "RUNNING";
      if (hint === "BLOCKED" || hint === "FAILED") state = "FAILED_OR_BLOCKED";
      if (hint === "AWAITING_FOUNDER_REVIEW") state = "AWAITING_REVIEW";
    }
  } else if (input.remote.status === "AWAITING_APPROVAL") {
    if (authStatus === "APPROVED") state = "AUTHORIZED";
    else if (authStatus === "PENDING") state = "AWAITING_APPROVAL";
    else state = "TASK_REQUESTED";
  }

  const simulationLabel =
    input.simulationLabel ??
    (input.remote.providerKind === "FAKE" && input.remote.externalJobId ? "SIMULATED" : "NONE");

  const nextAction = (() => {
    switch (state) {
      case "TASK_REQUESTED":
      case "AWAITING_APPROVAL":
        return "Approve DEVELOPMENT authorization in Founder Approval Center.";
      case "AUTHORIZED":
        return "Queue after durable authorization revalidation (binds agent_tasks row).";
      case "QUEUED":
        return "Execution remains disabled — agent_tasks row is prepared, not dispatched.";
      case "RUNNING":
        return "Monitor execution progress or cancel; revalidate before every step.";
      case "FAILED_OR_BLOCKED":
        return "Inspect blocker; retry only with valid durable authorization.";
      case "AWAITING_REVIEW":
        return "Independently verify evidence before Accept.";
      case "INDEPENDENTLY_VERIFIED":
        return "Accept or reject founder review (does not set Project Truth VERIFIED_*).";
      case "FOUNDER_ACCEPTED":
        return "No Project Truth verification claimed from this workflow.";
      default:
        return "Inspect development workflow state.";
    }
  })();

  return {
    remoteTaskId: input.remote.id,
    agentTaskId: input.remote.agentTaskId ?? input.agent?.id ?? null,
    authorizationId: input.remote.binding.authorizationId,
    projectId: input.remote.projectId,
    projectName: input.remote.projectName,
    objective: input.remote.objective,
    state,
    remoteStatus: input.remote.status,
    agentStatus: input.agent?.status ?? null,
    approvalEffectiveStatus: authStatus,
    evidenceState,
    independentlyVerified,
    simulationLabel,
    persistenceMode: input.persistenceMode,
    deploymentAuthorized: false,
    projectTruthNote:
      simulationLabel === "SIMULATED"
        ? "SIMULATED outcome cannot set Project Truth VERIFIED_LOCALLY / VERIFIED_IN_PRODUCTION."
        : "Durable development records do not auto-promote Project Truth verification facets.",
    nextAction,
  };
}
