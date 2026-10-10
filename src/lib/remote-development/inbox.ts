import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { effectiveAuthorizationStatus } from "@/lib/approvals/workflow";
import { reportSimulatedOutcomeForProjectTruth } from "./project-truth-boundary";
import { deriveWorkflowStage, type DevelopmentWorkflowStage } from "./workflow";
import type { RemoteDevTask } from "./types";
import { memoryListEvents, type PersistenceMode } from "./memory-store";

export type FounderInboxCard = {
  taskId: string;
  projectId: string;
  projectName: string;
  objective: string;
  workflowStage: DevelopmentWorkflowStage;
  taskStatus: RemoteDevTask["status"];
  approvalState: string;
  authorizedScope: string;
  actionType: string;
  executionState: RemoteDevTask["status"];
  providerActivity: string;
  simulationLabel: "SIMULATED" | "NONE";
  maxEstimatedCostUsd: number | null;
  maxDurationMs: number;
  evidenceState: string;
  evidenceCommitSha: string | null;
  evidencePullRequestRef: string | null;
  lastError: string | null;
  reviewDecision: string;
  nextAction: string;
  projectTruthNote: string;
  persistenceMode: PersistenceMode;
  deploymentAuthorized: false;
  destinationHref: string;
  approvalsHref: string;
};

export function toFounderInboxCard(input: {
  task: RemoteDevTask;
  authorization: FounderActionAuthorization | null;
  persistenceMode: PersistenceMode;
}): FounderInboxCard {
  const auth = input.authorization;
  const approvalState = auth
    ? effectiveAuthorizationStatus(auth.status, auth.expiresAt)
    : "MISSING";
  const stage = auth
    ? deriveWorkflowStage(input.task, auth)
    : ("DRAFT" as DevelopmentWorkflowStage);
  const truth = reportSimulatedOutcomeForProjectTruth(input.task);
  const events = memoryListEvents(input.task.id);
  const lastSim = [...events].reverse().find((e) => e.simulationLabel === "SIMULATED");
  const simulationLabel =
    input.task.externalJobId || lastSim ? ("SIMULATED" as const) : ("NONE" as const);

  let reviewDecision = "NONE";
  if (input.task.status === "VERIFIED") reviewDecision = "ACCEPTED_SIMULATED_REVIEW";
  if (input.task.status === "FAILED" && input.task.completedAt) reviewDecision = "REJECTED_OR_FAILED";
  if (input.task.status === "CANCELLED") reviewDecision = "CANCELLED";

  const nextAction = (() => {
    switch (stage) {
      case "AWAITING_APPROVAL":
      case "DRAFT":
        return "Approve DEVELOPMENT authorization";
      case "APPROVED":
        return "Queue with authorization revalidation";
      case "QUEUED":
        return "Run SIMULATED execution";
      case "RUNNING":
        return "Monitor SIMULATED provider / cancel";
      case "AWAITING_REVIEW":
        return "Independently verify SIMULATED evidence";
      case "REVIEWED":
        return "No Project Truth verification claimed";
      case "FAILED":
      case "BLOCKED":
        return "Inspect blocker and decide retry";
      default:
        return "Inspect task";
    }
  })();

  return {
    taskId: input.task.id,
    projectId: input.task.projectId,
    projectName: input.task.projectName,
    objective: input.task.objective,
    workflowStage: stage,
    taskStatus: input.task.status,
    approvalState,
    authorizedScope: auth?.actionScope ?? input.task.binding.actionScope,
    actionType: auth?.actionType ?? input.task.binding.actionType,
    executionState: input.task.status,
    providerActivity: lastSim?.detail ?? (input.task.externalJobId
      ? `SIMULATED job ${input.task.externalJobId.slice(0, 12)}…`
      : "No provider activity"),
    simulationLabel,
    maxEstimatedCostUsd: input.task.spending.maxEstimatedCostUsd,
    maxDurationMs: input.task.duration.maxDurationMs,
    evidenceState: input.task.evidence?.verificationState ?? "NONE",
    evidenceCommitSha: input.task.evidence?.commitSha ?? null,
    evidencePullRequestRef: input.task.evidence?.pullRequestRef ?? null,
    lastError: input.task.lastError
      ? `${input.task.lastError.code}: ${input.task.lastError.message}`
      : null,
    reviewDecision,
    nextAction,
    projectTruthNote: truth.summary,
    persistenceMode: input.persistenceMode,
    deploymentAuthorized: false,
    destinationHref: `/projects/${input.task.projectId}`,
    approvalsHref: "/approvals",
  };
}
