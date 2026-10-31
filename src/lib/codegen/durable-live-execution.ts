/**
 * Separate Pilot 03 LIVE codegen entrypoint (durable Remote Dev tasks).
 * Gated by GHOST_CODEGEN_LIVE_ENABLED=1. Uses SQL allowance — never MemoryAllowanceLedger.
 * Exactly one paid dispatch identity per remote task. Uncertain billing preserves reservation.
 * Never auto-retries after dispatch may have started. Never deploys. Never auto-accepts.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { developmentApprovalGrantsDeployment } from "@/lib/agent-runtime/authorization-kind";
import {
  insertAgentTaskCheckpoint,
  persistAgentTaskState,
} from "@/lib/agent-runtime/queries";
import type { ProviderEnv } from "@/lib/ai/live-provider-mode";
import {
  reconcileSqlAllowance,
  releaseSqlAllowance,
  reserveSqlAllowance,
} from "@/lib/allowance/sql-ledger";
import type { GhostClient } from "@/lib/auth/session";
import { transitionRemoteDevTask } from "@/lib/remote-development/contract";
import { loadDurableDevelopmentBundle } from "@/lib/remote-development/durable-workflow";
import {
  appendRemoteDevReviewEvent,
  updateRemoteDevTaskState,
} from "@/lib/remote-development/queries";
import type { GitHubEvidence, RemoteDevTask } from "@/lib/remote-development/types";
import { validateGeneratedInDocker } from "./docker-validate-generated";
import { isUncertainBillingReason, verifyPilot03LiveFounderScope } from "./live-scope";
import { materializeProposals, cleanupWorkspace } from "./materialize";
import { createOpenAiHttpCodingAdapter, type OpenAiHttpAdapterOptions } from "./openai-http";
import {
  estimateOpenAiCostUsd,
  PILOT_03_MAX_TRIAL_CENTS,
  PILOT_LIVE_TOKEN_STRATEGY,
  OPENAI_LIVE_TIMEOUT_MS,
} from "./openai-models";
import { PILOT_03_ALLOWED_FILES, PILOT_03_OBJECTIVE } from "./pilot03-constants";
import { PILOT_04_ALLOWED_FILES, PILOT_04_OBJECTIVE } from "./pilot04-constants";
import { isCodegenLiveEnabled } from "./provider-config";
import { DEFAULT_CODING_BUDGET } from "./types";

export type DurableLiveCodegenResult =
  | {
      ok: true;
      mode: "LIVE_PROVIDER";
      task: RemoteDevTask;
      reservationId: string;
      chargedCents: number;
      dockerPassed: boolean;
      realContainerExecution: boolean;
      contentSha256: string;
      founderReviewStatus: "AWAITING_FOUNDER_REVIEW";
      deploymentAttempted: false;
      liveHttpInvoked: true;
      idempotentReplay: boolean;
      scopeDetail: string;
    }
  | {
      ok: false;
      reason: string;
      message: string;
      reservationPreserved?: boolean;
      liveHttpInvoked?: boolean;
    };

function db(supabase: GhostClient): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

function fail(
  reason: string,
  message: string,
  extra?: { reservationPreserved?: boolean; liveHttpInvoked?: boolean },
): DurableLiveCodegenResult {
  return { ok: false, reason, message, ...extra };
}

async function recordLiveDispatch(
  supabase: GhostClient,
  row: {
    ownerId: string;
    projectId: string;
    remoteTaskId: string;
    reservationId: string | null;
    model: string;
    status: "STARTED" | "SUCCEEDED" | "FAILED" | "RELEASED";
    idempotencyKey: string;
    detail: string;
  },
): Promise<"inserted" | "exists" | "error"> {
  const { data: existing } = await db(supabase)
    .from("codegen_provider_dispatches")
    .select("id, status, detail")
    .eq("owner_id", row.ownerId)
    .eq("idempotency_key", row.idempotencyKey)
    .maybeSingle();
  if (existing) return "exists";

  const { error } = await db(supabase).from("codegen_provider_dispatches").insert({
    owner_id: row.ownerId,
    project_id: row.projectId,
    remote_development_task_id: row.remoteTaskId,
    reservation_id: row.reservationId,
    provider_id: "openai",
    model: row.model,
    mode: "LIVE_PROVIDER",
    status: row.status,
    idempotency_key: row.idempotencyKey,
    detail: row.detail.slice(0, 4000),
  });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return "exists";
    return "error";
  }
  return "inserted";
}

/**
 * Founder-authorized LIVE OpenAI coding for a QUEUED durable Pilot 03 task.
 * Requires GHOST_CODEGEN_LIVE_ENABLED=1 + exact scope + SQL reservation.
 * Inject fetchImpl for tests — never call real OpenAI from default app env.
 */
export async function executeDurableCodegenLivePipeline(
  supabase: GhostClient,
  input: {
    ownerId: string;
    remoteTaskId: string;
    workspaceRoot?: string;
    forceDockerDryRun?: boolean;
    estimatedCents?: number;
    env?: ProviderEnv;
    adapterOptions?: OpenAiHttpAdapterOptions;
    at?: string;
  },
): Promise<DurableLiveCodegenResult> {
  if (developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT")) {
    return fail("DEPLOYMENT_NOT_AUTHORIZED", "Development cannot grant deployment.");
  }

  const env = input.env ?? process.env;
  if (!isCodegenLiveEnabled(env)) {
    return fail(
      "LIVE_DISABLED",
      "GHOST_CODEGEN_LIVE_ENABLED is not 1. Live entrypoint refuses dispatch.",
    );
  }

  const loaded = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
  if (!loaded.ok) return fail(loaded.reason, loaded.message);

  const { remote, authorization, agent } = loaded.data;
  if (remote.ownerId !== input.ownerId) {
    return fail("OWNER_MISMATCH", "Only the owning founder can execute this task.");
  }
  if (!remote.agentTaskId || !agent) {
    return fail("MISSING_AGENT_TASK", "Agent task binding required after durable queue.");
  }

  const scope = verifyPilot03LiveFounderScope({
    actionScope: remote.binding.actionScope,
    environmentLabel: remote.binding.environmentLabel,
    authorization,
  });
  if (!scope.ok) return fail(scope.reason, scope.message);
  if (scope.contract.dispatch !== "LIVE") {
    return fail(
      "DISPATCH_DISABLED",
      "Approved fingerprint does not authorize paid dispatch. GHOST_CODEGEN_LIVE_ENABLED cannot override dispatch=DISABLED.",
    );
  }

  const estimatedCents = Math.min(
    PILOT_03_MAX_TRIAL_CENTS,
    Math.max(1, input.estimatedCents ?? Math.round((remote.spending.maxEstimatedCostUsd ?? 1) * 100)),
  );
  if (estimatedCents > PILOT_03_MAX_TRIAL_CENTS) {
    return fail("TRIAL_CEILING", "Estimated cents exceed Pilot 03 $1 hard ceiling.");
  }

  // One-time dispatch identity before status gate — RUNNING after uncertain billing must still block retries.
  const dispatchKey = `codegen-live-${remote.id}`;
  const prior = await db(supabase)
    .from("codegen_provider_dispatches")
    .select("id, status, detail, reservation_id")
    .eq("owner_id", input.ownerId)
    .eq("idempotency_key", dispatchKey)
    .maybeSingle();

  if (prior.data) {
    const row = prior.data as { status: string; detail?: string; reservation_id?: string };
    if (row.status === "SUCCEEDED") {
      const reload = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
      if (reload.ok && reload.data.remote.status === "AWAITING_FOUNDER_REVIEW") {
        return {
          ok: true,
          mode: "LIVE_PROVIDER",
          task: reload.data.remote,
          reservationId: row.reservation_id ?? "idempotent",
          chargedCents: 0,
          dockerPassed: /dockerPassed=true/.test(row.detail ?? ""),
          realContainerExecution: /realDocker=true/.test(row.detail ?? ""),
          contentSha256: "idempotent",
          founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
          deploymentAttempted: false,
          liveHttpInvoked: true,
          idempotentReplay: true,
          scopeDetail: scope.detail,
        };
      }
    }
    if (row.status === "STARTED" || /UNCERTAIN_BILLING/.test(row.detail ?? "")) {
      return fail(
        "DUPLICATE_DISPATCH_BLOCKED",
        "A prior live dispatch is in-flight or billing-uncertain for this task. Reservation preserved. Do not retry until founder reconciles.",
        { reservationPreserved: true, liveHttpInvoked: true },
      );
    }
    if (row.status === "FAILED" && /UNCERTAIN_BILLING/.test(row.detail ?? "")) {
      return fail(
        "UNCERTAIN_BILLING",
        "Prior live dispatch ended with uncertain billing. Reservation preserved. Founder must reconcile before any new attempt.",
        { reservationPreserved: true, liveHttpInvoked: true },
      );
    }
    // Clear FAILED (safe to know not billed) — still block automatic second paid attempt on same task.
    if (row.status === "FAILED") {
      return fail(
        "ONE_TIME_DISPATCH_EXHAUSTED",
        "This task already attempted live provider dispatch. Create a new founder-authorized job for another attempt.",
        { reservationPreserved: false, liveHttpInvoked: false },
      );
    }
  }

  if (remote.status !== "QUEUED" && remote.status !== "AWAITING_FOUNDER_REVIEW") {
    return fail("INVALID_STATUS", `Live execute requires QUEUED (or idempotent replay), got ${remote.status}.`);
  }

  const at = input.at ?? new Date().toISOString();
  const taskKey = `codegen-live-${remote.id}`;
  const reserved = await reserveSqlAllowance(supabase, {
    ownerId: input.ownerId,
    projectId: remote.projectId,
    taskKey,
    estimatedCents,
    idempotencyKey: `reserve-${dispatchKey}`,
  });
  if (!reserved.ok) {
    return fail(reserved.reason, reserved.message);
  }

  // Re-check auth + scope immediately before recording dispatch / provider call.
  const recheck = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
  if (!recheck.ok) {
    await releaseSqlAllowance(supabase, {
      ownerId: input.ownerId,
      reservationId: reserved.reservationId,
      idempotencyKey: `release-recheck-${dispatchKey}`,
    });
    return fail(recheck.reason, recheck.message);
  }
  const scope2 = verifyPilot03LiveFounderScope({
    actionScope: recheck.data.remote.binding.actionScope,
    environmentLabel: recheck.data.remote.binding.environmentLabel,
    authorization: recheck.data.authorization,
  });
  if (!scope2.ok) {
    await releaseSqlAllowance(supabase, {
      ownerId: input.ownerId,
      reservationId: reserved.reservationId,
      idempotencyKey: `release-scope2-${dispatchKey}`,
    });
    return fail(scope2.reason, scope2.message);
  }
  if (!isCodegenLiveEnabled(env)) {
    await releaseSqlAllowance(supabase, {
      ownerId: input.ownerId,
      reservationId: reserved.reservationId,
      idempotencyKey: `release-flag-${dispatchKey}`,
    });
    return fail("LIVE_DISABLED", "Live flag disabled during pre-dispatch recheck.");
  }

  const started = await recordLiveDispatch(supabase, {
    ownerId: input.ownerId,
    projectId: remote.projectId,
    remoteTaskId: remote.id,
    reservationId: reserved.reservationId,
    model: scope.contract.model,
    status: "STARTED",
    idempotencyKey: dispatchKey,
    detail: `LIVE_PROVIDER dispatch started scope=${scope.detail}`,
  });
  if (started === "error") {
    await releaseSqlAllowance(supabase, {
      ownerId: input.ownerId,
      reservationId: reserved.reservationId,
      idempotencyKey: `release-startfail-${dispatchKey}`,
    });
    return fail("DISPATCH_RECORD_FAILED", "Could not record durable live provider dispatch identity.");
  }
  if (started === "exists") {
    return fail(
      "DUPLICATE_DISPATCH_BLOCKED",
      "Concurrent live dispatch identity already exists for this task.",
      { reservationPreserved: true },
    );
  }

  if (remote.status === "QUEUED") {
    const running = transitionRemoteDevTask(remote, "RUNNING", {
      ownerId: input.ownerId,
      at,
      detail: "LIVE_PROVIDER codegen execution started",
    });
    if (running.ok) {
      await updateRemoteDevTaskState(supabase, running.task, { expectedStatus: "QUEUED" });
    }
  }

  // No automatic retries after a paid request may have started.
  const adapter = createOpenAiHttpCodingAdapter({
    ...input.adapterOptions,
    env: { ...env, ...(input.adapterOptions?.env ?? {}) },
    model: scope.contract.model,
    maxRetries: 0,
    timeoutMs: OPENAI_LIVE_TIMEOUT_MS,
  });

  const objective = /pilot\s*04/i.test(remote.objective)
    ? PILOT_04_OBJECTIVE
    : remote.objective.includes("vehicle comparison")
      ? PILOT_03_OBJECTIVE
      : remote.objective;

  const generation = await adapter.generate({
    objective,
    ownerId: input.ownerId,
    projectId: remote.projectId,
    authorizationId: remote.binding.authorizationId,
    environmentLabel: remote.binding.environmentLabel,
    classification: "PUBLIC",
    allowedRelativeRoots: ["generated"],
    budget: {
      ...DEFAULT_CODING_BUDGET,
      maxCostUsd: estimatedCents / 100,
      maxInputTokens: PILOT_LIVE_TOKEN_STRATEGY.maxInputTokens,
      maxOutputTokens: PILOT_LIVE_TOKEN_STRATEGY.maxCompletionTokens,
      maxDurationMs: PILOT_LIVE_TOKEN_STRATEGY.maxDurationMs,
      maxRetries: PILOT_LIVE_TOKEN_STRATEGY.maxRetries,
      maxOutputBytes: PILOT_LIVE_TOKEN_STRATEGY.maxOutputBytes,
    },
    idempotencyKey: `gen-${dispatchKey}`,
    at,
  });

  if (!generation.ok) {
    const uncertain = isUncertainBillingReason(generation.reason);
    const usage = "usage" in generation ? generation.usage : undefined;
    const providerMeta = "providerMeta" in generation ? generation.providerMeta : undefined;
    const metaSuffix = providerMeta
      ? ` http=${providerMeta.httpStatus} finish=${providerMeta.finishReason ?? "unknown"} resp=${providerMeta.responseId ?? "none"}`
      : "";
    const detailBase = uncertain
      ? `UNCERTAIN_BILLING:${generation.reason}:${generation.message}${metaSuffix}`
      : `${generation.reason}:${generation.message}${metaSuffix}`;

    await db(supabase)
      .from("codegen_provider_dispatches")
      .update({
        status: "FAILED",
        detail: detailBase.slice(0, 4000),
        updated_at: at,
      })
      .eq("owner_id", input.ownerId)
      .eq("idempotency_key", dispatchKey);

    let reservationPreserved = uncertain;
    if (uncertain && usage) {
      // Empty/failed content with usable usage — charge actual cents; do not release as unused.
      const chargeCents = Math.min(
        estimatedCents,
        Math.max(0, Math.ceil(usage.estimatedCostUsd * 100 - 1e-12)),
      );
      const charged = await reconcileSqlAllowance(supabase, {
        ownerId: input.ownerId,
        reservationId: reserved.reservationId,
        actualCents: chargeCents,
        idempotencyKey: `charge-empty-${dispatchKey}`,
      });
      reservationPreserved = !charged.ok;
    } else if (!uncertain) {
      await releaseSqlAllowance(supabase, {
        ownerId: input.ownerId,
        reservationId: reserved.reservationId,
        idempotencyKey: `release-genfail-${dispatchKey}`,
      });
      reservationPreserved = false;
    }

    // Provider errors after claim must leave a terminal remote-dev status (never stuck RUNNING).
    const currentBundle = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
    if (currentBundle.ok && currentBundle.data.remote.status === "RUNNING") {
      const failed = transitionRemoteDevTask(currentBundle.data.remote, "FAILED", {
        ownerId: input.ownerId,
        at,
        detail: `LIVE_PROVIDER generation failed: ${generation.reason}`,
      });
      if (failed.ok) {
        await updateRemoteDevTaskState(
          supabase,
          {
            ...failed.task,
            evidence: {
              repository: currentBundle.data.remote.git.repository,
              baseCommitSha: currentBundle.data.remote.git.baseCommitSha,
              taskBranch: currentBundle.data.remote.git.taskBranch,
              commitSha: null,
              pullRequestRef: null,
              testResultsRef: null,
              artifactHashes: [],
              verificationState: "FAILED",
              providerClaimedAt: at,
              independentlyCheckedAt: null,
              executionMode: "LIVE_PROVIDER",
            },
            lastError: {
              code: generation.reason,
              message: generation.message.slice(0, 2000),
              retryable: false,
              at,
            },
          },
          { expectedStatus: "RUNNING" },
        );
      }
    }
    if (agent) {
      await persistAgentTaskState(supabase, {
        ...agent,
        status: "CANCELLED",
        blockReason: `LIVE_PROVIDER failed: ${generation.reason}`.slice(0, 2000),
        completedAt: at,
        updatedAt: at,
        authorizationConsumed: true,
      });
    }

    await appendRemoteDevReviewEvent(supabase, {
      ownerId: input.ownerId,
      projectId: remote.projectId,
      remoteDevelopmentTaskId: remote.id,
      agentTaskId: remote.agentTaskId,
      authorizationId: remote.binding.authorizationId,
      eventType: uncertain ? "CODEGEN_LIVE_BILLING_UNCERTAIN" : "CODEGEN_LIVE_FAILED",
      detail: detailBase.slice(0, 4000),
      scopeFingerprint: remote.binding.scopeFingerprint,
    });

    return fail(generation.reason, generation.message, {
      reservationPreserved,
      liveHttpInvoked: true,
    });
  }

  const allowed = new Set<string>([...PILOT_03_ALLOWED_FILES, ...PILOT_04_ALLOWED_FILES]);
  const proposals = generation.proposals.filter((p) => allowed.has(p.relativePath));
  if (proposals.length === 0 || proposals.length !== generation.proposals.length) {
    // Clear path rejection after successful response with usage — reconcile actual usage first.
    const costEarly = estimateOpenAiCostUsd({
      model: scope.contract.model,
      inputTokens: generation.usage.inputTokens,
      outputTokens: generation.usage.outputTokens,
    });
    const chargeCents = costEarly.ok
      ? Math.min(estimatedCents, Math.max(costEarly.cents, 0))
      : estimatedCents;
    await reconcileSqlAllowance(supabase, {
      ownerId: input.ownerId,
      reservationId: reserved.reservationId,
      actualCents: chargeCents,
      idempotencyKey: `charge-pathfail-${dispatchKey}`,
    });
    await db(supabase)
      .from("codegen_provider_dispatches")
      .update({
        status: "FAILED",
        detail: "OUTPUT_PATH_NOT_ALLOWED after paid response",
        updated_at: at,
      })
      .eq("owner_id", input.ownerId)
      .eq("idempotency_key", dispatchKey);
    return fail(
      "OUTPUT_PATH_NOT_ALLOWED",
      "Provider returned paths outside Pilot 03/04 allowlist. Usage reconciled; founder must review.",
      { liveHttpInvoked: true },
    );
  }

  const cost = estimateOpenAiCostUsd({
    model: scope.contract.model,
    inputTokens: generation.usage.inputTokens,
    outputTokens: generation.usage.outputTokens,
  });
  if (!cost.ok) {
    await db(supabase)
      .from("codegen_provider_dispatches")
      .update({
        status: "FAILED",
        detail: `UNCERTAIN_BILLING:${cost.reason}`,
        updated_at: at,
      })
      .eq("owner_id", input.ownerId)
      .eq("idempotency_key", dispatchKey);
    return fail(cost.reason, cost.message, { reservationPreserved: true, liveHttpInvoked: true });
  }

  const chargedCents = Math.min(estimatedCents, Math.max(cost.cents, 0));
  const reconciled = await reconcileSqlAllowance(supabase, {
    ownerId: input.ownerId,
    reservationId: reserved.reservationId,
    actualCents: chargedCents,
    idempotencyKey: `charge-${dispatchKey}`,
  });
  if (!reconciled.ok) {
    await db(supabase)
      .from("codegen_provider_dispatches")
      .update({
        status: "FAILED",
        detail: `UNCERTAIN_BILLING:RECONCILE:${reconciled.reason}`,
        updated_at: at,
      })
      .eq("owner_id", input.ownerId)
      .eq("idempotency_key", dispatchKey);
    return fail(reconciled.reason, reconciled.message, {
      reservationPreserved: true,
      liveHttpInvoked: true,
    });
  }

  const workspaceRoot =
    input.workspaceRoot ?? mkdtempSync(path.join(os.tmpdir(), "ghost-codegen-live-"));
  const materialize = materializeProposals({
    taskId: remote.id,
    ownerId: input.ownerId,
    projectId: remote.projectId,
    workspaceRoot,
    allowedRelativeRoots: ["generated"],
    proposals,
  });
  if (!materialize.ok) {
    cleanupWorkspace(workspaceRoot);
    await db(supabase)
      .from("codegen_provider_dispatches")
      .update({
        status: "FAILED",
        detail: `MATERIALIZE_FAILED charged=${chargedCents}`,
        updated_at: at,
      })
      .eq("owner_id", input.ownerId)
      .eq("idempotency_key", dispatchKey);
    return fail(
      materialize.reason,
      `${materialize.message} Usage was reconciled ($${ (chargedCents / 100).toFixed(2) }); founder must review.`,
      { liveHttpInvoked: true },
    );
  }

  const testPath =
    proposals.find((p) => p.relativePath.endsWith("/test.mjs"))?.relativePath ??
    "generated/pilot-03-vehicle-comparison/test.mjs";

  const docker = validateGeneratedInDocker({
    taskId: remote.id,
    ownerId: input.ownerId,
    projectId: remote.projectId,
    workspaceRoot,
    testRelativePath: testPath,
    materializedPaths: materialize.files.map((f) => f.relativePath),
    forceDryRun: input.forceDockerDryRun,
    cleanupWorkspace: false,
  });
  if (!docker.ok) {
    cleanupWorkspace(materialize.workspacePath);
    await db(supabase)
      .from("codegen_provider_dispatches")
      .update({
        status: "FAILED",
        detail: `DOCKER_SETUP_FAILED charged=${chargedCents}`,
        updated_at: at,
      })
      .eq("owner_id", input.ownerId)
      .eq("idempotency_key", dispatchKey);
    return fail(docker.reason, docker.message, { liveHttpInvoked: true });
  }

  const evidence: GitHubEvidence = {
    repository: remote.git.repository,
    baseCommitSha: remote.git.baseCommitSha,
    taskBranch: remote.git.taskBranch,
    commitSha: null,
    pullRequestRef: null,
    testResultsRef: docker.testRelativePath,
    artifactHashes: [docker.contentSha256, materialize.contentSha256],
    verificationState: docker.passed && docker.realContainerExecution ? "VERIFIED" : "UNVERIFIED",
    providerClaimedAt: at,
    independentlyCheckedAt: docker.passed && docker.realContainerExecution ? at : null,
    executionMode: "LIVE_PROVIDER",
  };

  if (agent && docker.passed) {
    const checkpointId = randomUUID();
    await insertAgentTaskCheckpoint(supabase, {
      ownerId: input.ownerId,
      taskId: agent.id,
      checkpoint: {
        id: checkpointId,
        sequence: Math.max(1, agent.checkpointSequence + 1),
        label: "codegen-live-docker-validate",
        progressRef: docker.contentSha256,
        createdAt: at,
        authorizationId: remote.binding.authorizationId,
        scopeFingerprint: remote.binding.scopeFingerprint,
      },
    });
    await persistAgentTaskState(supabase, {
      ...agent,
      status: "SUCCEEDED",
      checkpointSequence: Math.max(1, agent.checkpointSequence + 1),
      lastCheckpointId: checkpointId,
      completedAt: at,
      updatedAt: at,
      authorizationConsumed: true,
    });
  } else if (agent && !docker.passed) {
    await persistAgentTaskState(supabase, {
      ...agent,
      status: "FAILED",
      blockReason: docker.detail.slice(0, 2000),
      completedAt: at,
      updatedAt: at,
      authorizationConsumed: true,
    });
  }

  const current = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
  if (!current.ok) {
    cleanupWorkspace(materialize.workspacePath);
    return fail(current.reason, current.message, { liveHttpInvoked: true });
  }

  const nextStatus = docker.passed ? "AWAITING_FOUNDER_REVIEW" : "FAILED";
  const fromStatus = current.data.remote.status;
  const transitioned = transitionRemoteDevTask(
    { ...current.data.remote, evidence },
    nextStatus,
    {
      ownerId: input.ownerId,
      at,
      detail: docker.passed
        ? `LIVE_PROVIDER codegen + Docker complete — charged $${(chargedCents / 100).toFixed(2)} — founder review required`
        : `LIVE_PROVIDER Docker validation failed: ${docker.detail}`,
    },
  );
  if (!transitioned.ok) {
    cleanupWorkspace(materialize.workspacePath);
    if (fromStatus === nextStatus) {
      return {
        ok: true,
        mode: "LIVE_PROVIDER",
        task: current.data.remote,
        reservationId: reserved.reservationId,
        chargedCents,
        dockerPassed: docker.passed,
        realContainerExecution: docker.realContainerExecution,
        contentSha256: docker.contentSha256,
        founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
        deploymentAttempted: false,
        liveHttpInvoked: true,
        idempotentReplay: true,
        scopeDetail: scope.detail,
      };
    }
    return fail("ILLEGAL_TRANSITION", transitioned.reason, { liveHttpInvoked: true });
  }

  const saved = await updateRemoteDevTaskState(
    supabase,
    { ...transitioned.task, evidence, completedAt: at },
    { expectedStatus: fromStatus },
  );
  if (saved.status === "error") {
    cleanupWorkspace(materialize.workspacePath);
    return fail("PERSIST_FAILED", saved.message, { liveHttpInvoked: true });
  }

  await appendRemoteDevReviewEvent(supabase, {
    ownerId: input.ownerId,
    projectId: remote.projectId,
    remoteDevelopmentTaskId: remote.id,
    agentTaskId: remote.agentTaskId,
    authorizationId: remote.binding.authorizationId,
    eventType: docker.passed ? "CODEGEN_LIVE_AWAITING_REVIEW" : "CODEGEN_LIVE_DOCKER_FAILED",
    detail: `mode=LIVE_PROVIDER chargedCents=${chargedCents} dockerPassed=${docker.passed} realDocker=${docker.realContainerExecution} sha=${docker.contentSha256}. Founder review required. No deployment.`,
    scopeFingerprint: remote.binding.scopeFingerprint,
  });

  await db(supabase)
    .from("codegen_provider_dispatches")
    .update({
      status: docker.passed ? "SUCCEEDED" : "FAILED",
      detail: `dockerPassed=${docker.passed};realDocker=${docker.realContainerExecution};chargedCents=${chargedCents};sha=${docker.contentSha256}`,
      updated_at: at,
    })
    .eq("owner_id", input.ownerId)
    .eq("idempotency_key", dispatchKey);

  cleanupWorkspace(materialize.workspacePath);

  if (!docker.passed) {
    return fail(
      "DOCKER_VALIDATION_FAILED",
      `${docker.detail} Charged $${(chargedCents / 100).toFixed(2)}. Cannot label VERIFIED without a passing run.`,
      { liveHttpInvoked: true },
    );
  }

  return {
    ok: true,
    mode: "LIVE_PROVIDER",
    task: saved.data,
    reservationId: reserved.reservationId,
    chargedCents,
    dockerPassed: true,
    realContainerExecution: docker.realContainerExecution,
    contentSha256: docker.contentSha256,
    founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
    deploymentAttempted: false,
    liveHttpInvoked: true,
    idempotentReplay: false,
    scopeDetail: scope.detail,
  };
}
