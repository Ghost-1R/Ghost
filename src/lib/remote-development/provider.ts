import type { RemoteDevTask, RemoteProviderKind, RemoteProviderStatusEvent } from "./types";

/**
 * Disabled-by-default remote execution provider interface (Build 09.10).
 * Real Cursor/GitHub Actions dispatch is not implemented in this build.
 */

export const REMOTE_PROVIDER_DISPATCH_ENV = "GHOST_REMOTE_PROVIDER_DISPATCH_ENABLED";

export type ProviderSubmitResult =
  | { ok: true; externalJobId: string; dispatched: false }
  | { ok: false; reason: string; message: string };

export type ProviderStatusResult =
  | {
      ok: true;
      externalJobId: string;
      status: RemoteProviderStatusEvent["status"];
      detail: string;
      at: string;
    }
  | { ok: false; reason: string; message: string };

export type ProviderCancelResult =
  | { ok: true; cancelled: boolean }
  | { ok: false; reason: string; message: string };

export type ProviderLogsResult =
  | { ok: true; logRef: string; evidenceRefs: string[] }
  | { ok: false; reason: string; message: string };

export interface RemoteExecutionProvider {
  readonly kind: RemoteProviderKind;
  submitTask(task: RemoteDevTask): Promise<ProviderSubmitResult> | ProviderSubmitResult;
  readStatus(externalJobId: string): Promise<ProviderStatusResult> | ProviderStatusResult;
  retrieveLogs(externalJobId: string): Promise<ProviderLogsResult> | ProviderLogsResult;
  requestCancellation(externalJobId: string): Promise<ProviderCancelResult> | ProviderCancelResult;
}

export function isRemoteProviderDispatchEnabled(): boolean {
  return process.env[REMOTE_PROVIDER_DISPATCH_ENV]?.trim() === "1";
}

/**
 * Hard boundary: this build never dispatches real external tasks,
 * even if the dispatch env flag is set.
 */
export function assertNoRealExternalDispatch(providerKind: RemoteProviderKind): {
  ok: true;
  dispatched: false;
} | { ok: false; reason: "REAL_DISPATCH_FORBIDDEN"; message: string } {
  if (providerKind !== "FAKE") {
    return {
      ok: false,
      reason: "REAL_DISPATCH_FORBIDDEN",
      message: `Provider ${providerKind} real dispatch is forbidden in Build 09.10.`,
    };
  }
  if (isRemoteProviderDispatchEnabled()) {
    // Flag acknowledged but still no paid/real providers in this build.
    return {
      ok: true,
      dispatched: false,
    };
  }
  return { ok: true, dispatched: false };
}
