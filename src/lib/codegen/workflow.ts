import { randomUUID } from "node:crypto";
import { assertExecutionAuthorized } from "@/lib/approvals/execution-gate";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { developmentApprovalGrantsDeployment } from "@/lib/agent-runtime/authorization-kind";
import { resolveCodingProvider } from "./adapter";
import { assertBudgetAllows } from "./budget";
import { materializeProposals, type MaterializeResult } from "./materialize";
import { assertObjectiveSafe } from "./security";
import type {
  CodeGenerationRequest,
  CodeGenerationResult,
  CodingProviderId,
  DataClassification,
  FileChangeProposal,
} from "./types";
import { DEFAULT_CODING_BUDGET } from "./types";

export type CodegenCheckpoint = {
  id: string;
  sequence: number;
  label: string;
  at: string;
  detail: string;
};

export type SupervisedCodegenRun = {
  runId: string;
  attributionMode: "MOCK_GENERATION";
  checkpoints: CodegenCheckpoint[];
  generation: CodeGenerationResult;
  materialize: MaterializeResult | null;
  founderReviewStatus: "AWAITING_FOUNDER_REVIEW";
  deploymentAttempted: false;
};

function checkpoint(sequence: number, label: string, detail: string): CodegenCheckpoint {
  return { id: randomUUID(), sequence, label, at: new Date().toISOString(), detail };
}

/**
 * Supervised mock code-generation workflow.
 * Requires a matching APPROVED (or CONSUMED_FOR_TASK-compatible) authorization for the exact scope.
 * Does not auto-accept founder review. Does not deploy. Does not call live providers.
 */
export async function runSupervisedMockCodegen(input: {
  authorization: FounderActionAuthorization | null;
  ownerId: string;
  projectId: string;
  objective: string;
  classification: DataClassification;
  environmentLabel?: string;
  allowedRelativeRoots?: string[];
  workspaceRoot: string;
  providerId?: CodingProviderId;
  signal?: AbortSignal;
  at?: string;
}): Promise<{ ok: true; run: SupervisedCodegenRun } | { ok: false; reason: string; message: string; checkpoints: CodegenCheckpoint[] }> {
  const checkpoints: CodegenCheckpoint[] = [];
  const runId = randomUUID();
  const at = input.at ?? new Date().toISOString();
  const allowedRelativeRoots = input.allowedRelativeRoots ?? ["generated"];

  checkpoints.push(checkpoint(1, "START", "Supervised mock codegen started."));

  if (developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT")) {
    return { ok: false, reason: "DEPLOYMENT_NOT_AUTHORIZED", message: "Development must not grant deployment.", checkpoints };
  }

  const objectiveOk = assertObjectiveSafe(input.objective);
  if (!objectiveOk.ok) {
    return { ok: false, reason: objectiveOk.reason, message: objectiveOk.message, checkpoints };
  }

  if (!input.authorization) {
    checkpoints.push(checkpoint(2, "AUTH_DENIED", "MISSING_AUTHORIZATION"));
    return {
      ok: false,
      reason: "MISSING_AUTHORIZATION",
      message: "Founder authorization is required for code generation.",
      checkpoints,
    };
  }

  const authGate = assertExecutionAuthorized(input.authorization, {
    authorizationId: input.authorization.id,
    ownerId: input.ownerId,
    projectId: input.projectId,
    actionType: input.authorization.actionType,
    actionScope: input.authorization.actionScope,
    environmentLabel: input.authorization.environmentLabel,
    at,
  });
  if (!authGate.ok) {
    checkpoints.push(checkpoint(2, "AUTH_DENIED", authGate.reason));
    return { ok: false, reason: authGate.reason, message: authGate.message, checkpoints };
  }
  checkpoints.push(checkpoint(2, "AUTH_OK", `Authorization ${input.authorization!.id} revalidated.`));

  const request: CodeGenerationRequest = {
    objective: input.objective.trim(),
    ownerId: input.ownerId,
    projectId: input.projectId,
    authorizationId: input.authorization!.id,
    environmentLabel: input.authorization!.environmentLabel,
    classification: input.classification,
    allowedRelativeRoots,
    budget: { ...DEFAULT_CODING_BUDGET, maxCostUsd: 0 },
    idempotencyKey: `codegen-mock-${runId}`,
    at,
  };

  const budgetOk = assertBudgetAllows(request);
  if (!budgetOk.ok) {
    return { ok: false, reason: budgetOk.reason, message: budgetOk.message, checkpoints };
  }

  const resolved = resolveCodingProvider({
    providerId: input.providerId ?? "mock",
    requiredClassification: input.classification,
  });
  if (!resolved.ok) {
    checkpoints.push(checkpoint(3, "PROVIDER_DENIED", resolved.reason));
    return { ok: false, reason: resolved.reason, message: resolved.message, checkpoints };
  }
  checkpoints.push(checkpoint(3, "PROVIDER_READY", `provider=${resolved.provider.id} live=false`));

  const generation = await resolved.provider.generate(request, input.signal);
  checkpoints.push(
    checkpoint(
      4,
      generation.ok ? "GENERATED" : "GENERATE_FAILED",
      generation.ok ? `proposals=${generation.proposals.length}` : `${generation.reason}`,
    ),
  );

  if (!generation.ok) {
    return {
      ok: true,
      run: {
        runId,
        attributionMode: "MOCK_GENERATION",
        checkpoints,
        generation,
        materialize: null,
        founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
        deploymentAttempted: false,
      },
    };
  }

  if (generation.attribution.mode !== "MOCK_GENERATION") {
    return {
      ok: false,
      reason: "ATTRIBUTION_MISMATCH",
      message: "Mock workflow received non-mock attribution.",
      checkpoints,
    };
  }

  const materialize = materializeProposals({
    taskId: runId,
    ownerId: input.ownerId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
    allowedRelativeRoots,
    proposals: generation.proposals as FileChangeProposal[],
  });
  checkpoints.push(
    checkpoint(
      5,
      materialize.ok ? "MATERIALIZED" : "MATERIALIZE_FAILED",
      materialize.ok ? materialize.contentSha256.slice(0, 16) : materialize.reason,
    ),
  );

  checkpoints.push(checkpoint(6, "AWAITING_FOUNDER_REVIEW", "Deliverable ready; not auto-accepted."));

  return {
    ok: true,
    run: {
      runId,
      attributionMode: "MOCK_GENERATION",
      checkpoints,
      generation,
      materialize,
      founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
      deploymentAttempted: false,
    },
  };
}
