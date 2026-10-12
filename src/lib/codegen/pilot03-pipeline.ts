import { randomUUID } from "node:crypto";
import type { MemoryAllowanceLedger } from "@/lib/allowance";
import { assertExecutionAuthorized } from "@/lib/approvals/execution-gate";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { developmentApprovalGrantsDeployment } from "@/lib/agent-runtime/authorization-kind";
import { resolveCodingProvider } from "./adapter";
import { materializeProposals } from "./materialize";
import type { DataClassification } from "./types";
import { estimateTrialCostCents } from "./live-adapters";
import { PILOT_03_ALLOWED_FILES, PILOT_03_OBJECTIVE } from "./pilot03-constants";

export { PILOT_03_ALLOWED_FILES, PILOT_03_OBJECTIVE };

/**
 * End-to-end mock path for Pilot 03:
 * auth → allowance reserve → mock generate → validate/materialize → reconcile/release → founder review.
 * Live providers remain disabled. Results labeled MOCK_GENERATION.
 */
export async function runPilot03MockPipeline(input: {
  authorization: FounderActionAuthorization | null;
  ownerId: string;
  projectId: string;
  ledger: MemoryAllowanceLedger;
  workspaceRoot: string;
  classification?: DataClassification;
  estimatedCents?: number;
  /** Simulated actual charge in cents after mock generation (0 for free mock). */
  actualCents?: number;
  forceProviderFailure?: boolean;
}): Promise<
  | {
      ok: true;
      mode: "MOCK_GENERATION";
      founderReviewStatus: "AWAITING_FOUNDER_REVIEW";
      reservationId: string | null;
      checkpoints: Array<{ label: string; detail: string }>;
      materializeSha256: string | null;
      availableCentsAfter: number;
      deploymentAttempted: false;
      liveCalls: 0;
    }
  | { ok: false; reason: string; message: string; checkpoints: Array<{ label: string; detail: string }> }
> {
  const checkpoints: Array<{ label: string; detail: string }> = [];
  const classification = input.classification ?? "PUBLIC";
  const estimatedCents = input.estimatedCents ?? 100; // $1.00 proposed trial ceiling
  const actualCents = input.actualCents ?? 0;

  checkpoints.push({ label: "START", detail: "Pilot 03 mock pipeline" });

  if (developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT")) {
    return { ok: false, reason: "DEPLOYMENT_NOT_AUTHORIZED", message: "Development cannot deploy.", checkpoints };
  }

  if (!input.authorization) {
    return { ok: false, reason: "MISSING_AUTHORIZATION", message: "Founder authorization required.", checkpoints };
  }

  const gate = assertExecutionAuthorized(input.authorization, {
    authorizationId: input.authorization.id,
    ownerId: input.ownerId,
    projectId: input.projectId,
    actionType: input.authorization.actionType,
    actionScope: input.authorization.actionScope,
    environmentLabel: input.authorization.environmentLabel,
  });
  if (!gate.ok) {
    checkpoints.push({ label: "AUTH_DENIED", detail: gate.reason });
    return { ok: false, reason: gate.reason, message: gate.message, checkpoints };
  }
  checkpoints.push({ label: "AUTH_OK", detail: input.authorization.id });

  const taskKey = `pilot03-${input.authorization.id.slice(0, 8)}`;
  const reserve = input.ledger.reserve({
    ownerId: input.ownerId,
    projectId: input.projectId,
    taskKey,
    estimatedCents,
    idempotencyKey: `reserve-${taskKey}`,
  });
  if (!reserve.ok) {
    checkpoints.push({ label: "RESERVE_DENIED", detail: reserve.reason });
    return { ok: false, reason: reserve.reason, message: reserve.message, checkpoints };
  }
  checkpoints.push({
    label: "RESERVED",
    detail: `reservation=${reserve.reservation.id} estCents=${estimatedCents} available=${reserve.snapshot.availableCents}`,
  });

  // Cost estimate sanity (OpenAI gpt-5-mini published rates) — informational for mock
  const est = estimateTrialCostCents({
    inputTokens: 2_000,
    outputTokens: 4_000,
    inputPerMillionUsd: 0.25,
    outputPerMillionUsd: 2.0,
  });
  checkpoints.push({ label: "ESTIMATE", detail: `illustrativeOpenAiMiniCents=${est}` });

  if (input.forceProviderFailure) {
    input.ledger.release({
      ownerId: input.ownerId,
      reservationId: reserve.reservation.id,
      idempotencyKey: `release-fail-${taskKey}`,
    });
    return {
      ok: false,
      reason: "PROVIDER_UNAVAILABLE",
      message: "Forced provider failure before generation.",
      checkpoints: [...checkpoints, { label: "PROVIDER_FAIL", detail: "released reservation" }],
    };
  }

  const resolved = resolveCodingProvider({ providerId: "mock", requiredClassification: classification });
  if (!resolved.ok) {
    input.ledger.release({
      ownerId: input.ownerId,
      reservationId: reserve.reservation.id,
      idempotencyKey: `release-provider-${taskKey}`,
    });
    return { ok: false, reason: resolved.reason, message: resolved.message, checkpoints };
  }

  const generation = await resolved.provider.generate({
    objective: PILOT_03_OBJECTIVE,
    ownerId: input.ownerId,
    projectId: input.projectId,
    authorizationId: input.authorization.id,
    environmentLabel: input.authorization.environmentLabel,
    classification,
    allowedRelativeRoots: ["generated"],
    budget: {
      maxInputTokens: 4_000,
      maxOutputTokens: 8_000,
      maxCostUsd: estimatedCents / 100,
      maxDurationMs: 60_000,
      maxSteps: 8,
      maxRetries: 2,
      maxOutputBytes: 250_000,
    },
    idempotencyKey: `gen-${taskKey}`,
  });

  if (!generation.ok) {
    input.ledger.release({
      ownerId: input.ownerId,
      reservationId: reserve.reservation.id,
      idempotencyKey: `release-gen-${taskKey}`,
    });
    checkpoints.push({ label: "GENERATE_FAILED", detail: generation.reason });
    return { ok: false, reason: generation.reason, message: generation.message, checkpoints };
  }
  checkpoints.push({
    label: "GENERATED",
    detail: `mode=${generation.attribution.mode} files=${generation.proposals.length}`,
  });

  // Ensure paths are pilot-03 originals (rewrite relative paths if mock used legacy names)
  const proposals = generation.proposals.map((p) => {
    if (p.relativePath.includes("vehicle-comparison") && !p.relativePath.includes("pilot-03")) {
      return {
        ...p,
        relativePath: p.relativePath.replace(
          "generated/vehicle-comparison/",
          "generated/pilot-03-vehicle-comparison/",
        ),
      };
    }
    return p;
  });

  const materialize = materializeProposals({
    taskId: randomUUID(),
    ownerId: input.ownerId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
    allowedRelativeRoots: ["generated"],
    proposals,
  });
  if (!materialize.ok) {
    input.ledger.release({
      ownerId: input.ownerId,
      reservationId: reserve.reservation.id,
      idempotencyKey: `release-mat-${taskKey}`,
    });
    return { ok: false, reason: materialize.reason, message: materialize.message, checkpoints };
  }
  checkpoints.push({ label: "MATERIALIZED", detail: materialize.contentSha256.slice(0, 16) });

  const reconciled = input.ledger.reconcile({
    ownerId: input.ownerId,
    reservationId: reserve.reservation.id,
    actualCents,
    idempotencyKey: `charge-${taskKey}`,
  });
  if (!reconciled.ok) {
    return { ok: false, reason: reconciled.reason, message: reconciled.message, checkpoints };
  }
  checkpoints.push({
    label: "RECONCILED",
    detail: `charged=${actualCents} available=${reconciled.snapshot.availableCents}`,
  });
  checkpoints.push({ label: "AWAITING_FOUNDER_REVIEW", detail: "Not auto-accepted" });

  return {
    ok: true,
    mode: "MOCK_GENERATION",
    founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
    reservationId: reserve.reservation.id,
    checkpoints,
    materializeSha256: materialize.contentSha256,
    availableCentsAfter: reconciled.snapshot.availableCents,
    deploymentAttempted: false,
    liveCalls: 0,
  };
}
