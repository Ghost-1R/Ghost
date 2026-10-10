import { createHash } from "node:crypto";
import { FakeRemoteExecutionProvider } from "./fake-provider";
import { buildGitHubEvidence } from "./github-evidence";
import { reconcileRemoteStatus } from "./reconcile";
import { signProviderWebhookBody, validateProviderWebhook } from "./webhook";
import type { RemoteDevTask, RemoteProviderStatusEvent } from "./types";

export const SIMULATION_LABEL = "SIMULATED" as const;

export type SimulateStep =
  | "SUBMIT"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMEOUT"
  | "CANCEL";

export type SimulateResult =
  | {
      ok: true;
      task: RemoteDevTask;
      provider: FakeRemoteExecutionProvider;
      externalJobId: string;
      simulationLabel: typeof SIMULATION_LABEL;
      detail: string;
    }
  | { ok: false; reason: string; message: string };

/**
 * Drive FakeRemoteExecutionProvider through one simulated step.
 * All output is labeled SIMULATED. Never contacts external services.
 */
export function simulateProviderStep(input: {
  task: RemoteDevTask;
  provider: FakeRemoteExecutionProvider;
  step: SimulateStep;
  ownerId: string;
  webhookSecret?: string;
  seenEventIds?: Set<string>;
}): SimulateResult {
  if (input.ownerId !== input.task.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: "Owner mismatch on simulated step." };
  }

  const secret = input.webhookSecret ?? "ghost-09-11-sim-secret";
  const seen = input.seenEventIds ?? new Set<string>();
  let task = input.task;
  let externalJobId = task.externalJobId;

  if (input.step === "SUBMIT") {
    if (task.status !== "QUEUED") {
      return {
        ok: false,
        reason: "INVALID_STATUS",
        message: "SIMULATED submit requires QUEUED status after authorization gate.",
      };
    }
    const submitted = input.provider.submitTask(task);
    if (!submitted.ok) {
      return { ok: false, reason: submitted.reason, message: submitted.message };
    }
    if (submitted.dispatched !== false) {
      return {
        ok: false,
        reason: "EXTERNAL_DISPATCH",
        message: "SIMULATED provider must not report external dispatch.",
      };
    }
    externalJobId = submitted.externalJobId;
    task = {
      ...task,
      externalJobId,
      providerKind: "FAKE",
      git: {
        ...task.git,
        taskBranch: `sim/${task.id.slice(0, 8)}`,
      },
      checkpoints: [
        ...task.checkpoints,
        {
          id: createHash("sha256").update(`submit|${task.id}`).digest("hex").slice(0, 16),
          sequence: task.checkpoints.length + 1,
          label: "SIMULATED_SUBMIT",
          progressRef: `sim:submit:${submitted.externalJobId}`,
          at: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    return {
      ok: true,
      task,
      provider: input.provider,
      externalJobId,
      simulationLabel: SIMULATION_LABEL,
      detail: "SIMULATED: fake provider accepted job (not dispatched externally).",
    };
  }

  if (!externalJobId) {
    return { ok: false, reason: "MISSING_JOB", message: "No external job id for simulated step." };
  }

  if (input.step === "CANCEL") {
    const cancel = input.provider.requestCancellation(externalJobId);
    if (!cancel.ok) return { ok: false, reason: cancel.reason, message: cancel.message };
    const eventId = `cancel-${task.id.slice(0, 8)}-${Date.now()}`;
    const occurredAt = new Date().toISOString();
    const bodyForSig = JSON.stringify({
      externalJobId,
      providerKind: "FAKE",
      status: "CANCELLED",
      detail: `${SIMULATION_LABEL}: cancelled by founder`,
      occurredAt,
      eventId,
      signature: "",
    });
    const sig = signProviderWebhookBody(bodyForSig, secret);
    const event: RemoteProviderStatusEvent = {
      externalJobId,
      providerKind: "FAKE",
      status: "CANCELLED",
      detail: `${SIMULATION_LABEL}: cancelled by founder`,
      occurredAt,
      eventId,
      signature: sig,
    };
    const okWebhook = validateProviderWebhook({
      rawBody: bodyForSig,
      signatureHeader: sig,
      sharedSecret: secret,
      event,
      seenEventIds: seen,
    });
    if (!okWebhook.ok) {
      return { ok: false, reason: okWebhook.reason, message: okWebhook.message };
    }
    if (okWebhook.duplicate) {
      return {
        ok: true,
        task,
        provider: input.provider,
        externalJobId,
        simulationLabel: SIMULATION_LABEL,
        detail: "SIMULATED: duplicate cancel event ignored (idempotent).",
      };
    }
    seen.add(event.eventId);
    const reconciled = reconcileRemoteStatus(task, event, { ownerId: input.ownerId });
    if (!reconciled.ok) return { ok: false, reason: reconciled.reason, message: reconciled.message };
    return {
      ok: true,
      task: reconciled.task,
      provider: input.provider,
      externalJobId,
      simulationLabel: SIMULATION_LABEL,
      detail: "SIMULATED: cancelled.",
    };
  }

  const statusMap = {
    RUNNING: "RUNNING",
    SUCCEEDED: "SUCCEEDED",
    FAILED: "FAILED",
    TIMEOUT: "TIMEOUT",
  } as const;
  const providerStatus = statusMap[input.step as keyof typeof statusMap];
  if (!providerStatus) {
    return { ok: false, reason: "UNKNOWN_STEP", message: `Unknown simulate step ${input.step}` };
  }

  const advanced = input.provider.advance(
    externalJobId,
    providerStatus,
    `${SIMULATION_LABEL}: advanced to ${providerStatus}`,
  );
  if (!advanced) {
    return { ok: false, reason: "UNKNOWN_JOB", message: "Fake job missing for advance." };
  }

  const eventId = `sim-${providerStatus.toLowerCase()}-${task.id.slice(0, 8)}-${Date.now()}`;
  const bodyForSig = JSON.stringify({
    externalJobId,
    providerKind: "FAKE",
    status: providerStatus,
    detail: `${SIMULATION_LABEL}: ${providerStatus}`,
    occurredAt: new Date().toISOString(),
    eventId,
    signature: "",
  });
  const sig = signProviderWebhookBody(bodyForSig, secret);
  const event: RemoteProviderStatusEvent = {
    ...JSON.parse(bodyForSig),
    signature: sig,
  };

  const validated = validateProviderWebhook({
    rawBody: bodyForSig,
    signatureHeader: sig,
    sharedSecret: secret,
    event,
    seenEventIds: seen,
  });
  if (!validated.ok) {
    return { ok: false, reason: validated.reason, message: validated.message };
  }
  if (validated.duplicate) {
    return {
      ok: true,
      task,
      provider: input.provider,
      externalJobId,
      simulationLabel: SIMULATION_LABEL,
      detail: "SIMULATED: duplicate status event ignored (idempotent).",
    };
  }
  seen.add(event.eventId);

  const reconciled = reconcileRemoteStatus(task, event, { ownerId: input.ownerId });
  if (!reconciled.ok) return { ok: false, reason: reconciled.reason, message: reconciled.message };
  task = reconciled.task;

  if (providerStatus === "SUCCEEDED") {
    const evidence = buildGitHubEvidence({
      task,
      commitSha: createHash("sha256").update(`sim-commit|${task.id}`).digest("hex").slice(0, 40),
      pullRequestRef: "#0",
      testResultsRef: `SIMULATED:fake-tests:${externalJobId}`,
      artifactHashes: [createHash("sha256").update(`sim-artifact|${task.id}`).digest("hex")],
      providerClaimedAt: new Date().toISOString(),
    });
    if (evidence.ok) {
      // Provider claims stay UNVERIFIED — founder must independently check.
      task = { ...task, evidence: evidence.evidence };
    }
  }

  return {
    ok: true,
    task,
    provider: input.provider,
    externalJobId,
    simulationLabel: SIMULATION_LABEL,
    detail: `SIMULATED: ${providerStatus}`,
  };
}

/** Convenience: run submit → running → succeeded (or fail/timeout/cancel). */
export function runSimulatedHappyPath(input: {
  task: RemoteDevTask;
  ownerId: string;
  provider?: FakeRemoteExecutionProvider;
}): SimulateResult & { provider: FakeRemoteExecutionProvider } {
  const provider = input.provider ?? new FakeRemoteExecutionProvider();
  const seen = new Set<string>();
  let result = simulateProviderStep({
    task: input.task,
    provider,
    step: "SUBMIT",
    ownerId: input.ownerId,
    seenEventIds: seen,
  });
  if (!result.ok) return { ...result, provider };
  result = simulateProviderStep({
    task: result.task,
    provider,
    step: "RUNNING",
    ownerId: input.ownerId,
    seenEventIds: seen,
  });
  if (!result.ok) return { ...result, provider };
  result = simulateProviderStep({
    task: result.task,
    provider,
    step: "SUCCEEDED",
    ownerId: input.ownerId,
    seenEventIds: seen,
  });
  return { ...result, provider };
}
