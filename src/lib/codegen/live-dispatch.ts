/**
 * Pilot 03 live coding dispatch orchestration (safe preparation).
 * Requires: founder APPROVED auth, PUBLIC classification, allowance reserve,
 * GHOST_CODEGEN_LIVE_ENABLED=1, OpenAI allowlisted model.
 * Always ends in AWAITING_FOUNDER_REVIEW. Never deploys. Never grants deployment.
 * Duplicate idempotency keys replay without a second paid call.
 */

import { randomUUID } from "node:crypto";
import type { MemoryAllowanceLedger } from "@/lib/allowance";
import { assertExecutionAuthorized } from "@/lib/approvals/execution-gate";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { developmentApprovalGrantsDeployment } from "@/lib/agent-runtime/authorization-kind";
import type { ProviderEnv } from "@/lib/ai/live-provider-mode";
import { materializeProposals } from "./materialize";
import { createOpenAiHttpCodingAdapter, type OpenAiHttpAdapterOptions } from "./openai-http";
import { estimateOpenAiCostUsd, PILOT_03_MAX_TRIAL_CENTS } from "./openai-models";
import { isCodegenLiveEnabled } from "./provider-config";
import { PILOT_03_ALLOWED_FILES, PILOT_03_OBJECTIVE } from "./pilot03-constants";
import type { CodeGenerationResult, DataClassification, FileChangeProposal } from "./types";
import { DEFAULT_CODING_BUDGET } from "./types";

export type LiveDispatchCheckpoint = { label: string; detail: string };

export type LiveDispatchResult =
  | {
      ok: true;
      mode: "LIVE_PROVIDER";
      founderReviewStatus: "AWAITING_FOUNDER_REVIEW";
      reservationId: string;
      generation: CodeGenerationResult & { ok: true };
      materializeSha256: string | null;
      chargedCents: number;
      availableCentsAfter: number;
      deploymentAttempted: false;
      idempotentReplay: boolean;
      checkpoints: LiveDispatchCheckpoint[];
      liveHttpInvoked: boolean;
    }
  | {
      ok: false;
      reason: string;
      message: string;
      checkpoints: LiveDispatchCheckpoint[];
      reservationReleased?: boolean;
    };

type CachedDispatch = Extract<LiveDispatchResult, { ok: true }>;

const dispatchCache = new Map<string, CachedDispatch>();

export function resetLiveDispatchCacheForTests(): void {
  dispatchCache.clear();
}

function note(checkpoints: LiveDispatchCheckpoint[], label: string, detail: string) {
  checkpoints.push({ label, detail });
}

/**
 * Supervised live OpenAI coding dispatch with atomic allowance reservation.
 * Does not enable live by itself — requires env flag + injectible fetch for tests.
 */
export async function runPilot03LiveOpenAiDispatch(input: {
  authorization: FounderActionAuthorization | null;
  ownerId: string;
  projectId: string;
  ledger: MemoryAllowanceLedger;
  workspaceRoot: string;
  objective?: string;
  classification?: DataClassification;
  model?: string;
  estimatedCents?: number;
  idempotencyKey: string;
  env?: ProviderEnv;
  adapterOptions?: OpenAiHttpAdapterOptions;
  signal?: AbortSignal;
}): Promise<LiveDispatchResult> {
  const checkpoints: LiveDispatchCheckpoint[] = [];
  note(checkpoints, "START", "Pilot 03 live OpenAI dispatch gate");

  if (developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT")) {
    return { ok: false, reason: "DEPLOYMENT_NOT_AUTHORIZED", message: "Development cannot grant deployment.", checkpoints };
  }

  const env = input.env ?? process.env;
  if (!isCodegenLiveEnabled(env)) {
    return {
      ok: false,
      reason: "LIVE_DISABLED",
      message: "GHOST_CODEGEN_LIVE_ENABLED is not 1. No provider call.",
      checkpoints,
    };
  }

  const cached = dispatchCache.get(`${input.ownerId}:${input.idempotencyKey}`);
  if (cached) {
    note(checkpoints, "IDEMPOTENT_REPLAY", input.idempotencyKey);
    return { ...cached, idempotentReplay: true, checkpoints: [...cached.checkpoints, ...checkpoints] };
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
    note(checkpoints, "AUTH_DENIED", gate.reason);
    return { ok: false, reason: gate.reason, message: gate.message, checkpoints };
  }
  note(checkpoints, "AUTH_OK", input.authorization.id);

  const classification = input.classification ?? "PUBLIC";
  if (classification !== "PUBLIC") {
    return {
      ok: false,
      reason: "PUBLIC_ONLY",
      message: "Initial live trial is PUBLIC fictional data only.",
      checkpoints,
    };
  }

  const estimatedCents = input.estimatedCents ?? PILOT_03_MAX_TRIAL_CENTS;
  if (!Number.isInteger(estimatedCents) || estimatedCents <= 0 || estimatedCents > PILOT_03_MAX_TRIAL_CENTS) {
    return {
      ok: false,
      reason: "INVALID_ESTIMATE",
      message: `Estimated cents must be 1..${PILOT_03_MAX_TRIAL_CENTS}.`,
      checkpoints,
    };
  }

  const taskKey = `pilot03-live-${input.authorization.id}`;
  const reserve = input.ledger.reserve({
    ownerId: input.ownerId,
    projectId: input.projectId,
    taskKey,
    estimatedCents,
    idempotencyKey: `reserve-${input.idempotencyKey}`,
  });
  if (!reserve.ok) {
    note(checkpoints, "RESERVE_DENIED", reserve.reason);
    return { ok: false, reason: reserve.reason, message: reserve.message, checkpoints };
  }
  note(checkpoints, "RESERVED", `reservation=${reserve.reservation.id} est=${estimatedCents}`);

  const model = input.model ?? "gpt-5-mini";
  const adapter = createOpenAiHttpCodingAdapter({
    ...input.adapterOptions,
    env: { ...env, ...(input.adapterOptions?.env ?? {}) },
    model,
  });

  const objective = (input.objective ?? PILOT_03_OBJECTIVE).trim();
  const generation = await adapter.generate(
    {
      objective,
      ownerId: input.ownerId,
      projectId: input.projectId,
      authorizationId: input.authorization.id,
      environmentLabel: input.authorization.environmentLabel,
      classification,
      allowedRelativeRoots: ["generated"],
      budget: {
        ...DEFAULT_CODING_BUDGET,
        maxCostUsd: estimatedCents / 100,
        maxInputTokens: 4_000,
        maxOutputTokens: 4_000,
        maxDurationMs: 60_000,
        maxRetries: 2,
        maxOutputBytes: 200_000,
      },
      idempotencyKey: input.idempotencyKey,
    },
    input.signal,
  );

  if (!generation.ok) {
    const released = input.ledger.release({
      ownerId: input.ownerId,
      reservationId: reserve.reservation.id,
      idempotencyKey: `release-${input.idempotencyKey}`,
    });
    note(checkpoints, "GENERATION_FAILED", generation.reason);
    note(checkpoints, "RESERVATION_RELEASED", released.ok ? "ok" : released.reason);
    return {
      ok: false,
      reason: generation.reason,
      message: generation.message,
      checkpoints,
      reservationReleased: released.ok,
    };
  }

  // Restrict to Pilot 03 allowed files when objective matches pilot task.
  const allowed = new Set<string>(PILOT_03_ALLOWED_FILES);
  const filtered: FileChangeProposal[] = [];
  for (const proposal of generation.proposals) {
    if (objective === PILOT_03_OBJECTIVE && !allowed.has(proposal.relativePath)) {
      const released = input.ledger.release({
        ownerId: input.ownerId,
        reservationId: reserve.reservation.id,
        idempotencyKey: `release-path-${input.idempotencyKey}`,
      });
      return {
        ok: false,
        reason: "OUTPUT_PATH_NOT_ALLOWED",
        message: `Generated path ${proposal.relativePath} is outside Pilot 03 allowed files.`,
        checkpoints,
        reservationReleased: released.ok,
      };
    }
    filtered.push(proposal);
  }

  const cost = estimateOpenAiCostUsd({
    model,
    inputTokens: generation.usage.inputTokens,
    outputTokens: generation.usage.outputTokens,
  });
  if (!cost.ok) {
    const released = input.ledger.release({
      ownerId: input.ownerId,
      reservationId: reserve.reservation.id,
      idempotencyKey: `release-cost-${input.idempotencyKey}`,
    });
    return { ok: false, reason: cost.reason, message: cost.message, checkpoints, reservationReleased: released.ok };
  }

  const chargedCents = Math.min(estimatedCents, Math.max(cost.cents, 1));
  const reconciled = input.ledger.reconcile({
    ownerId: input.ownerId,
    reservationId: reserve.reservation.id,
    actualCents: chargedCents,
    idempotencyKey: `charge-${input.idempotencyKey}`,
  });
  if (!reconciled.ok) {
    note(checkpoints, "RECONCILE_FAILED", reconciled.reason);
    return { ok: false, reason: reconciled.reason, message: reconciled.message, checkpoints };
  }
  note(checkpoints, "RECONCILED", `chargedCents=${chargedCents}`);

  const materialize = materializeProposals({
    taskId: randomUUID(),
    ownerId: input.ownerId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
    allowedRelativeRoots: ["generated"],
    proposals: filtered.length > 0 ? filtered : generation.proposals,
  });
  if (!materialize.ok) {
    note(checkpoints, "MATERIALIZE_FAILED", materialize.reason);
    // Charge already applied — founder must review uncertain workspace outcome.
    return {
      ok: false,
      reason: materialize.reason,
      message: `${materialize.message} Usage was reconciled; founder must review billing/workspace outcome.`,
      checkpoints,
    };
  }
  note(checkpoints, "MATERIALIZED", materialize.contentSha256);
  note(checkpoints, "FOUNDER_REVIEW", "AWAITING_FOUNDER_REVIEW — acceptance not auto-applied");

  const result: CachedDispatch = {
    ok: true,
    mode: "LIVE_PROVIDER",
    founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
    reservationId: reserve.reservation.id,
    generation: { ...generation, proposals: filtered.length > 0 ? filtered : generation.proposals },
    materializeSha256: materialize.contentSha256,
    chargedCents,
    availableCentsAfter: reconciled.snapshot.availableCents,
    deploymentAttempted: false,
    idempotentReplay: false,
    checkpoints,
    liveHttpInvoked: true,
  };
  dispatchCache.set(`${input.ownerId}:${input.idempotencyKey}`, result);
  return result;
}
