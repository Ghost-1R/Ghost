import { createHash } from "node:crypto";
import type {
  ProviderCancelResult,
  ProviderLogsResult,
  ProviderStatusResult,
  ProviderSubmitResult,
  RemoteExecutionProvider,
} from "./provider";
import { assertNoRealExternalDispatch } from "./provider";
import type { RemoteDevTask } from "./types";

type FakeJob = {
  taskId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMEOUT";
  detail: string;
  createdAt: string;
  updatedAt: string;
  cancelled: boolean;
};

/**
 * Deterministic fake remote provider for unit tests.
 * Never contacts Cursor, GitHub Actions, or any network service.
 */
export class FakeRemoteExecutionProvider implements RemoteExecutionProvider {
  readonly kind = "FAKE" as const;
  private readonly jobs = new Map<string, FakeJob>();

  submitTask(task: RemoteDevTask): ProviderSubmitResult {
    const boundary = assertNoRealExternalDispatch("FAKE");
    if (!boundary.ok) {
      return { ok: false, reason: boundary.reason, message: boundary.message };
    }
    if (task.status !== "QUEUED" && task.status !== "AWAITING_APPROVAL") {
      return {
        ok: false,
        reason: "INVALID_STATUS",
        message: `Cannot submit task in status ${task.status}.`,
      };
    }
    const externalJobId = createHash("sha256")
      .update(`${task.id}|${task.idempotencyKey}|fake`)
      .digest("hex")
      .slice(0, 32);
    const at = new Date().toISOString();
    if (!this.jobs.has(externalJobId)) {
      this.jobs.set(externalJobId, {
        taskId: task.id,
        status: "QUEUED",
        detail: "Fake provider accepted task (not dispatched externally).",
        createdAt: at,
        updatedAt: at,
        cancelled: false,
      });
    }
    return { ok: true, externalJobId, dispatched: false };
  }

  readStatus(externalJobId: string): ProviderStatusResult {
    const job = this.jobs.get(externalJobId);
    if (!job) {
      return { ok: false, reason: "UNKNOWN_JOB", message: "Unknown fake job id." };
    }
    return {
      ok: true,
      externalJobId,
      status: job.status,
      detail: job.detail,
      at: job.updatedAt,
    };
  }

  retrieveLogs(externalJobId: string): ProviderLogsResult {
    const job = this.jobs.get(externalJobId);
    if (!job) {
      return { ok: false, reason: "UNKNOWN_JOB", message: "Unknown fake job id." };
    }
    return {
      ok: true,
      logRef: `fake-log:${externalJobId}`,
      evidenceRefs: [`fake-evidence:${job.taskId}`],
    };
  }

  requestCancellation(externalJobId: string): ProviderCancelResult {
    const job = this.jobs.get(externalJobId);
    if (!job) {
      return { ok: false, reason: "UNKNOWN_JOB", message: "Unknown fake job id." };
    }
    job.cancelled = true;
    job.status = "CANCELLED";
    job.detail = "Cancelled via fake provider.";
    job.updatedAt = new Date().toISOString();
    return { ok: true, cancelled: true };
  }

  /** Test helper: advance fake job state deterministically. */
  advance(externalJobId: string, status: FakeJob["status"], detail?: string): boolean {
    const job = this.jobs.get(externalJobId);
    if (!job) return false;
    job.status = status;
    job.detail = detail ?? `Advanced to ${status}`;
    job.updatedAt = new Date().toISOString();
    return true;
  }
}
