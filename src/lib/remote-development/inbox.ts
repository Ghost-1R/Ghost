import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { effectiveAuthorizationStatus } from "@/lib/approvals/workflow";
import {
  describeEvidenceAttribution,
  isCodegenPilotScope,
  parseCodegenScopeFragment,
} from "@/lib/codegen/request-contract";
import { reportSimulatedOutcomeForProjectTruth } from "./project-truth-boundary";
import { deriveWorkflowStage, type DevelopmentWorkflowStage } from "./workflow";
import type { RemoteDevTask } from "./types";
import { memoryListEvents, type PersistenceMode } from "./memory-store";

export type FounderStatusLabel =
  | "PREPARED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "QUEUED"
  | "RUNNING"
  | "AWAITING_REVIEW"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "CHANGES_REQUESTED";

export type FounderInboxCard = {
  taskId: string;
  projectId: string;
  projectName: string;
  objective: string;
  workflowStage: DevelopmentWorkflowStage;
  founderStatusLabel: FounderStatusLabel;
  taskStatus: RemoteDevTask["status"];
  approvalState: string;
  authorizedScope: string;
  actionType: string;
  executionState: RemoteDevTask["status"];
  providerActivity: string;
  simulationLabel: "SIMULATED" | "NONE";
  evidenceAttributionLabel: string;
  evidenceAttributionMode: string;
  codegenProviderModel: string | null;
  isCodegenPilot: boolean;
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

function toFounderStatusLabel(
  stage: DevelopmentWorkflowStage,
  taskStatus: RemoteDevTask["status"],
): FounderStatusLabel {
  if (taskStatus === "CHANGES_REQUESTED") return "CHANGES_REQUESTED";
  if (taskStatus === "VERIFIED") return "COMPLETED";
  switch (stage) {
    case "DRAFT":
      return "PREPARED";
    case "AWAITING_APPROVAL":
      return "AWAITING_APPROVAL";
    case "APPROVED":
      return "APPROVED";
    case "QUEUED":
      return "QUEUED";
    case "RUNNING":
      return "RUNNING";
    case "AWAITING_REVIEW":
      return "AWAITING_REVIEW";
    case "REVIEWED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "BLOCKED":
      return "BLOCKED";
    default:
      return "PREPARED";
  }
}

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
  if (input.task.status === "VERIFIED") {
    reviewDecision =
      input.persistenceMode === "DATABASE" ? "ACCEPTED_DURABLE_REVIEW" : "ACCEPTED_SIMULATED_REVIEW";
  }
  if (input.task.status === "CHANGES_REQUESTED") reviewDecision = "CHANGES_REQUESTED";
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
        return input.persistenceMode === "DATABASE"
          ? "Authorized queue only — workers remain disabled until founder dispatch"
          : "Run SIMULATED execution";
      case "RUNNING":
        return input.persistenceMode === "DATABASE"
          ? "Monitor durable agent progress / cancel"
          : "Monitor SIMULATED provider / cancel";
      case "AWAITING_REVIEW":
        if (input.persistenceMode === "DATABASE") {
          return "Confirm durable founder review (ACCEPT / REJECT / REQUEST_CHANGES) — no auto-submit";
        }
        return input.task.evidence?.verificationState === "VERIFIED"
          ? "Accept or reject independently verified SIMULATED evidence"
          : "Independently verify SIMULATED evidence (required before Accept)";
      case "REVIEWED":
        return "No Project Truth verification claimed";
      case "FAILED":
      case "BLOCKED":
        return input.task.status === "CHANGES_REQUESTED"
          ? "Changes requested — re-queue only with new authorization"
          : "Inspect blocker and decide retry";
      default:
        return "Inspect task";
    }
  })();

  const scope = auth?.actionScope ?? input.task.binding.actionScope;
  const codegen = parseCodegenScopeFragment(scope);
  const hasLiveUsage =
    input.task.evidence?.executionMode === "LIVE_PROVIDER" ||
    Boolean(input.task.lastError?.message?.includes("LIVE_PROVIDER")) ||
    input.task.checkpoints.some((c) => /LIVE_PROVIDER/i.test(c.label));
  const attribution = describeEvidenceAttribution({
    actionScope: scope,
    simulationLabel,
    hasLiveUsage,
  });

  return {
    taskId: input.task.id,
    projectId: input.task.projectId,
    projectName: input.task.projectName,
    objective: input.task.objective,
    workflowStage: stage,
    founderStatusLabel: toFounderStatusLabel(stage, input.task.status),
    taskStatus: input.task.status,
    approvalState,
    authorizedScope: scope,
    actionType: auth?.actionType ?? input.task.binding.actionType,
    executionState: input.task.status,
    providerActivity: lastSim?.detail ?? (input.task.externalJobId
      ? `SIMULATED job ${input.task.externalJobId.slice(0, 12)}…`
      : codegen
        ? `Codegen intent: ${codegen.providerId}/${codegen.model} (dispatch=${codegen.dispatch})`
        : "No provider activity"),
    simulationLabel,
    evidenceAttributionLabel: attribution.label,
    evidenceAttributionMode: attribution.mode,
    codegenProviderModel: codegen ? `${codegen.providerId}:${codegen.model}` : null,
    isCodegenPilot: isCodegenPilotScope(scope),
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
