/**
 * Durable Pilot 03 codegen execution wired to remote_development_tasks.
 * Path: queued durable task → SQL allowance reserve → MOCK generate →
 * materialize → restricted Docker validate → AWAITING_FOUNDER_REVIEW.
 * Live OpenAI remains disabled unless GHOST_CODEGEN_LIVE_ENABLED=1 (still not auto-wired to UI).
 * Never grants deployment. Never auto-accepts founder review.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { developmentApprovalGrantsDeployment } from "@/lib/agent-runtime/authorization-kind";
import {
  insertAgentTaskCheckpoint,
  persistAgentTaskState,
} from "@/lib/agent-runtime/queries";
import {
  reconcileSqlAllowance,
  releaseSqlAllowance,
  reserveSqlAllowance,
} from "@/lib/allowance/sql-ledger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GhostClient } from "@/lib/auth/session";
import { transitionRemoteDevTask } from "@/lib/remote-development/contract";
import { loadDurableDevelopmentBundle } from "@/lib/remote-development/durable-workflow";
import {
  appendRemoteDevReviewEvent,
  updateRemoteDevTaskState,
} from "@/lib/remote-development/queries";
import type { GitHubEvidence, RemoteDevTask } from "@/lib/remote-development/types";
import {
  isCodegenPilotScope,
  parseCodegenScopeFragment,
} from "./request-contract";
import { createMockCodingProvider } from "./mock-provider";
import { materializeProposals, cleanupWorkspace } from "./materialize";
import { validateGeneratedInDocker } from "./docker-validate-generated";
import { PILOT_03_ALLOWED_FILES, PILOT_03_OBJECTIVE } from "./pilot03-constants";
import { PILOT_03_MAX_TRIAL_CENTS } from "./openai-models";
import { isCodegenLiveEnabled } from "./provider-config";
import { DEFAULT_CODING_BUDGET } from "./types";

function db(supabase: GhostClient): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

export type DurableCodegenExecutionResult =
  | {
      ok: true;
      mode: "MOCK_GENERATION";
      task: RemoteDevTask;
      reservationId: string;
      chargedCents: number;
      dockerPassed: boolean;
      realContainerExecution: boolean;
      contentSha256: string;
      founderReviewStatus: "AWAITING_FOUNDER_REVIEW";
      deploymentAttempted: false;
      liveHttpInvoked: false;
      idempotentReplay: boolean;
    }
  | { ok: false; reason: string; message: string };

function fail(reason: string, message: string): DurableCodegenExecutionResult {
  return { ok: false, reason, message };
}

async function recordDispatch(
  supabase: GhostClient,
  row: {
    ownerId: string;
    projectId: string;
    remoteTaskId: string;
    reservationId: string | null;
    providerId: string;
    model: string;
    mode: "MOCK_GENERATION" | "LIVE_PROVIDER";
    status: "STARTED" | "SUCCEEDED" | "FAILED" | "RELEASED";
    idempotencyKey: string;
    detail: string;
  },
): Promise<"inserted" | "exists" | "error"> {
  const { data: existing } = await db(supabase)
    .from("codegen_provider_dispatches")
    .select("id, status")
    .eq("owner_id", row.ownerId)
    .eq("idempotency_key", row.idempotencyKey)
    .maybeSingle();
  if (existing) return "exists";

  const { error } = await db(supabase).from("codegen_provider_dispatches").insert({
    owner_id: row.ownerId,
    project_id: row.projectId,
    remote_development_task_id: row.remoteTaskId,
    reservation_id: row.reservationId,
    provider_id: row.providerId,
    model: row.model,
    mode: row.mode,
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
 * Execute MOCK codegen validation for a QUEUED durable Pilot 03 task.
 * Refuses live provider calls from this entrypoint (live remains separately gated).
 */
export async function executeDurableCodegenMockPipeline(
  supabase: GhostClient,
  input: {
    ownerId: string;
    remoteTaskId: string;
    workspaceRoot?: string;
    forceDockerDryRun?: boolean;
    estimatedCents?: number;
    at?: string;
  },
): Promise<DurableCodegenExecutionResult> {
  if (developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT")) {
    return fail("DEPLOYMENT_NOT_AUTHORIZED", "Development cannot grant deployment.");
  }

  // Hard refuse live from this Remote Dev wiring path.
  if (isCodegenLiveEnabled()) {
    return fail(
      "LIVE_PATH_NOT_WIRED",
      "GHOST_CODEGEN_LIVE_ENABLED is set, but the Remote Dev execute action only runs MOCK_GENERATION. Disable the flag or use a separate founder-authorized live entrypoint.",
    );
  }

  const loaded = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
  if (!loaded.ok) return fail(loaded.reason, loaded.message);

  const { remote, authorization, agent } = loaded.data;
  if (remote.ownerId !== input.ownerId) {
    return fail("OWNER_MISMATCH", "Only the owning founder can execute this task.");
  }
  if (!isCodegenPilotScope(remote.binding.actionScope)) {
    return fail("NOT_CODEGEN_TASK", "Remote task is not a Pilot 03 codegen contract.");
  }
  if (remote.status !== "QUEUED" && remote.status !== "AWAITING_FOUNDER_REVIEW") {
    return fail("INVALID_STATUS", `Codegen execute requires QUEUED (or idempotent replay), got ${remote.status}.`);
  }
  if (authorization.status !== "CONSUMED" && authorization.effectiveStatus !== "CONSUMED") {
    return fail(
      "AUTH_NOT_CONSUMED",
      `ONE_TIME authorization must be consumed at queue before execute (status=${authorization.status}).`,
    );
  }
  if (!remote.agentTaskId || !agent) {
    return fail("MISSING_AGENT_TASK", "Agent task binding required after durable queue.");
  }

  const codegen = parseCodegenScopeFragment(remote.binding.actionScope);
  const model = codegen?.model ?? "mock-codegen-v1";
  const estimatedCents = Math.min(
    PILOT_03_MAX_TRIAL_CENTS,
    Math.max(1, input.estimatedCents ?? Math.round((remote.spending.maxEstimatedCostUsd ?? 1) * 100)),
  );
  if (estimatedCents > PILOT_03_MAX_TRIAL_CENTS) {
    return fail("TRIAL_CEILING", "Estimated cents exceed Pilot 03 $1 hard ceiling.");
  }

  const dispatchKey = `codegen-mock-${remote.id}`;
  const prior = await db(supabase)
    .from("codegen_provider_dispatches")
    .select("id, status, detail")
    .eq("owner_id", input.ownerId)
    .eq("idempotency_key", dispatchKey)
    .maybeSingle();
  if (prior.data && (prior.data as { status: string }).status === "SUCCEEDED") {
    const reload = await loadDurableDevelopmentBundle(supabase, input.ownerId, input.remoteTaskId);
    if (reload.ok && reload.data.remote.status === "AWAITING_FOUNDER_REVIEW") {
      return {
        ok: true,
        mode: "MOCK_GENERATION",
        task: reload.data.remote,
        reservationId: "idempotent",
        chargedCents: 0,
        dockerPassed: /dockerPassed=true/.test((prior.data as { detail?: string }).detail ?? ""),
        realContainerExecution: /realDocker=true/.test((prior.data as { detail?: string }).detail ?? ""),
        contentSha256: "idempotent",
        founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
        deploymentAttempted: false,
        liveHttpInvoked: false,
        idempotentReplay: true,
      };
    }
  }

  const at = input.at ?? new Date().toISOString();
  const taskKey = `codegen-${remote.id}`;
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

  const started = await recordDispatch(supabase, {
    ownerId: input.ownerId,
    projectId: remote.projectId,
    remoteTaskId: remote.id,
    reservationId: reserved.reservationId,
    providerId: "mock",
    model,
    mode: "MOCK_GENERATION",
    status: "STARTED",
    idempotencyKey: dispatchKey,
    detail: "MOCK codegen dispatch started",
  });
  if (started === "error") {
    await releaseSqlAllowance(supabase, {
      ownerId: input.ownerId,
      reservationId: reserved.reservationId,
      idempotencyKey: `release-startfail-${dispatchKey}`,
    });
    return fail("DISPATCH_RECORD_FAILED", "Could not record durable provider dispatch identity.");
  }
  if (started === "exists" && remote.status === "AWAITING_FOUNDER_REVIEW") {
    return {
      ok: true,
      mode: "MOCK_GENERATION",
      task: remote,
      reservationId: reserved.reservationId,
      chargedCents: 0,
      dockerPassed: false,
      realContainerExecution: false,
      contentSha256: "idempotent",
      founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
      deploymentAttempted: false,
      liveHttpInvoked: false,
      idempotentReplay: true,
    };
  }

  // Advance QUEUED → RUNNING for founder-visible progress.
  if (remote.status === "QUEUED") {
    const running = transitionRemoteDevTask(remote, "RUNNING", {
      ownerId: input.ownerId,
      at,
      detail: "MOCK codegen execution started",
    });
    if (running.ok) {
      await updateRemoteDevTaskState(supabase, running.task, { expectedStatus: "QUEUED" });
    }
  }

  const provider = createMockCodingProvider();
  const objective = remote.objective.includes("vehicle comparison")
    ? PILOT_03_OBJECTIVE
    : remote.objective;
  const generation = await provider.generate({
    objective,
    ownerId: input.ownerId,
    projectId: remote.projectId,
    authorizationId: remote.binding.authorizationId,
    environmentLabel: remote.binding.environmentLabel,
    classification: "PUBLIC",
    allowedRelativeRoots: ["generated"],
    budget: { ...DEFAULT_CODING_BUDGET, maxCostUsd: 0 },
    idempotencyKey: `gen-${dispatchKey}`,
    at,
  });

  if (!generation.ok) {
    await releaseSqlAllowance(supabase, {
      ownerId: input.ownerId,
      reservationId: reserved.reservationId,
      idempotencyKey: `release-genfail-${dispatchKey}`,
    });
    await db(supabase)
      .from("codegen_provider_dispatches")
      .update({ status: "FAILED", detail: generation.reason, updated_at: at })
      .eq("owner_id", input.ownerId)
      .eq("idempotency_key", dispatchKey);
    return fail(generation.reason, generation.message);
  }

  // Prefer Pilot 03 allowed paths when objective matches; otherwise keep mock paths.
  let proposals = generation.proposals;
  if (objective === PILOT_03_OBJECTIVE) {
    proposals = generation.proposals.map((p) => {
      const base = path.posix.basename(p.relativePath);
      const mapped = PILOT_03_ALLOWED_FILES.find((f) => f.endsWith(`/${base}`));
      return mapped ? { ...p, relativePath: mapped } : p;
    });
  }

  const workspaceRoot =
    input.workspaceRoot ?? mkdtempSync(path.join(os.tmpdir(), "ghost-codegen-durable-"));
  const materialize = materializeProposals({
    taskId: remote.id,
    ownerId: input.ownerId,
    projectId: remote.projectId,
    workspaceRoot,
    allowedRelativeRoots: ["generated"],
    proposals,
  });
  if (!materialize.ok) {
    await releaseSqlAllowance(supabase, {
      ownerId: input.ownerId,
      reservationId: reserved.reservationId,
      idempotencyKey: `release-matfail-${dispatchKey}`,
    });
    return fail(materialize.reason, materialize.message);
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
    await releaseSqlAllowance(supabase, {
      ownerId: input.ownerId,
      reservationId: reserved.reservationId,
      idempotencyKey: `release-dockfail-${dispatchKey}`,
    });
    cleanupWorkspace(materialize.workspacePath);
    return fail(docker.reason, docker.message);
  }

  // Mock generation cost is $0 — reconcile 0 cents (releases reservation without charge).
  // Restart recovery: if reservation already RECONCILED, continue (idempotent charge event).
  let reconciled = await reconcileSqlAllowance(supabase, {
    ownerId: input.ownerId,
    reservationId: reserved.reservationId,
    actualCents: 0,
    idempotencyKey: `charge-${dispatchKey}`,
  });
  if (!reconciled.ok && reconciled.reason === "NOT_OPEN") {
    const { data: resRow } = await db(supabase)
      .from("project_ai_allowance_reservations")
      .select("status")
      .eq("id", reserved.reservationId)
      .eq("owner_id", input.ownerId)
      .maybeSingle();
    if ((resRow as { status?: string } | null)?.status === "RECONCILED") {
      reconciled = {
        ok: true,
        reservationId: reserved.reservationId,
        snapshot: reserved.snapshot,
      };
    }
  }
  if (!reconciled.ok) {
    cleanupWorkspace(materialize.workspacePath);
    return fail(reconciled.reason, reconciled.message);
  }

  const evidence: GitHubEvidence = {
    repository: remote.git.repository,
    baseCommitSha: remote.git.baseCommitSha,
    taskBranch: remote.git.taskBranch,
    commitSha: null,
    pullRequestRef: null,
    testResultsRef: docker.testRelativePath,
    artifactHashes: [docker.contentSha256, materialize.contentSha256],
    executionMode: "MOCK_GENERATION",
    verificationState: docker.passed && docker.realContainerExecution ? "VERIFIED" : "UNVERIFIED",
    providerClaimedAt: at,
    independentlyCheckedAt: docker.passed && docker.realContainerExecution ? at : null,
  };

  // Bind agent terminal status for durable founder ACCEPT (requires SUCCEEDED + checkpoint).
  if (agent && docker.passed) {
    const checkpointId = randomUUID();
    await insertAgentTaskCheckpoint(supabase, {
      ownerId: input.ownerId,
      taskId: agent.id,
      checkpoint: {
        id: checkpointId,
        sequence: Math.max(1, agent.checkpointSequence + 1),
        label: "codegen-mock-docker-validate",
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
    return fail(current.reason, current.message);
  }

  // Docker failure → FAILED (cannot be VERIFIED). Success → AWAITING_FOUNDER_REVIEW.
  const nextStatus = docker.passed ? "AWAITING_FOUNDER_REVIEW" : "FAILED";
  const fromStatus = current.data.remote.status;
  const transitioned = transitionRemoteDevTask(
    { ...current.data.remote, evidence },
    nextStatus,
    {
      ownerId: input.ownerId,
      at,
      detail: docker.passed
        ? "MOCK codegen + Docker validation complete — founder review required"
        : `MOCK codegen Docker validation failed: ${docker.detail}`,
    },
  );
  if (!transitioned.ok) {
    // If already at target, treat as success path for idempotency
    if (fromStatus === nextStatus) {
      cleanupWorkspace(materialize.workspacePath);
      return {
        ok: true,
        mode: "MOCK_GENERATION",
        task: current.data.remote,
        reservationId: reserved.reservationId,
        chargedCents: 0,
        dockerPassed: docker.passed,
        realContainerExecution: docker.realContainerExecution,
        contentSha256: docker.contentSha256,
        founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
        deploymentAttempted: false,
        liveHttpInvoked: false,
        idempotentReplay: true,
      };
    }
    cleanupWorkspace(materialize.workspacePath);
    return fail("ILLEGAL_TRANSITION", transitioned.reason);
  }

  const saved = await updateRemoteDevTaskState(supabase, {
    ...transitioned.task,
    evidence,
    completedAt: at,
  }, { expectedStatus: fromStatus });
  if (saved.status === "error") {
    cleanupWorkspace(materialize.workspacePath);
    return fail("PERSIST_FAILED", saved.message);
  }

  await appendRemoteDevReviewEvent(supabase, {
    ownerId: input.ownerId,
    projectId: remote.projectId,
    remoteDevelopmentTaskId: remote.id,
    agentTaskId: remote.agentTaskId,
    authorizationId: remote.binding.authorizationId,
    eventType: docker.passed ? "CODEGEN_MOCK_AWAITING_REVIEW" : "CODEGEN_MOCK_DOCKER_FAILED",
    detail: `mode=MOCK_GENERATION dockerPassed=${docker.passed} realDocker=${docker.realContainerExecution} sha=${docker.contentSha256}. Founder review required. No deployment.`,
    scopeFingerprint: remote.binding.scopeFingerprint,
  });

  await db(supabase)
    .from("codegen_provider_dispatches")
    .update({
      status: docker.passed ? "SUCCEEDED" : "FAILED",
      detail: `dockerPassed=${docker.passed};realDocker=${docker.realContainerExecution};sha=${docker.contentSha256}`,
      updated_at: at,
    })
    .eq("owner_id", input.ownerId)
    .eq("idempotency_key", dispatchKey);

  cleanupWorkspace(materialize.workspacePath);

  if (!docker.passed) {
    return fail(
      "DOCKER_VALIDATION_FAILED",
      `${docker.detail} Task marked FAILED — cannot be founder-accepted as VERIFIED without a passing run.`,
    );
  }

  return {
    ok: true,
    mode: "MOCK_GENERATION",
    task: saved.data,
    reservationId: reserved.reservationId,
    chargedCents: 0,
    dockerPassed: true,
    realContainerExecution: docker.realContainerExecution,
    contentSha256: docker.contentSha256,
    founderReviewStatus: "AWAITING_FOUNDER_REVIEW",
    deploymentAttempted: false,
    liveHttpInvoked: false,
    idempotentReplay: false,
  };
}
