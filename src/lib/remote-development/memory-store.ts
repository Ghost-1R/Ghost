import type { FounderActionAuthorization } from "@/lib/approvals/types";
import { planAuthorizationConsumption } from "@/lib/agent-runtime/consume";
import type { RemoteDevTask } from "./types";

/**
 * Isolated test-only persistence for Build 09.11 when disposable DB is unavailable.
 * Never claims durable production persistence. Process-local only.
 */

export const MEMORY_PERSISTENCE_MODE = "MEMORY_TEST_ONLY" as const;
export type PersistenceMode = typeof MEMORY_PERSISTENCE_MODE | "DATABASE" | "UNAVAILABLE";

export type WorkflowAuditEvent = {
  id: string;
  taskId: string;
  eventType: string;
  detail: string;
  at: string;
  /** Always present for simulated activity. */
  simulationLabel: "SIMULATED" | "NONE";
};

type MemoryBucket = {
  tasks: Map<string, RemoteDevTask>;
  authorizations: Map<string, FounderActionAuthorization>;
  events: WorkflowAuditEvent[];
  /** Tracks one-time consumption for in-memory auth rows. */
  consumedAuthIds: Set<string>;
  /** Post-consume execution kill switch (auth status stays CONSUMED). */
  haltedAuthIds: Set<string>;
};

declare global {
  // eslint-disable-next-line no-var
  var __ghostRemoteDevMemoryStore: MemoryBucket | undefined;
}

function bucket(): MemoryBucket {
  if (!globalThis.__ghostRemoteDevMemoryStore) {
    globalThis.__ghostRemoteDevMemoryStore = {
      tasks: new Map(),
      authorizations: new Map(),
      events: [],
      consumedAuthIds: new Set(),
      haltedAuthIds: new Set(),
    };
  }
  return globalThis.__ghostRemoteDevMemoryStore;
}

/** Reset between unit tests — not for production use. */
export function resetRemoteDevMemoryStore(): void {
  globalThis.__ghostRemoteDevMemoryStore = {
    tasks: new Map(),
    authorizations: new Map(),
    events: [],
    consumedAuthIds: new Set(),
    haltedAuthIds: new Set(),
  };
}

export function memoryPersistenceMode(): PersistenceMode {
  return MEMORY_PERSISTENCE_MODE;
}

export function memorySaveAuthorization(auth: FounderActionAuthorization): FounderActionAuthorization {
  const next = { ...auth };
  bucket().authorizations.set(next.id, next);
  return next;
}

export function memoryLoadAuthorization(id: string): FounderActionAuthorization | null {
  return bucket().authorizations.get(id) ?? null;
}

export function memorySaveTask(task: RemoteDevTask): RemoteDevTask {
  const next = { ...task };
  bucket().tasks.set(next.id, next);
  return next;
}

export function memoryLoadTask(id: string): RemoteDevTask | null {
  return bucket().tasks.get(id) ?? null;
}

export function memoryListTasks(ownerId: string, limit = 50): RemoteDevTask[] {
  return [...bucket().tasks.values()]
    .filter((t) => t.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export function memoryAppendEvent(event: Omit<WorkflowAuditEvent, "id"> & { id?: string }): WorkflowAuditEvent {
  const row: WorkflowAuditEvent = {
    id: event.id ?? `evt_${bucket().events.length + 1}`,
    taskId: event.taskId,
    eventType: event.eventType,
    detail: event.detail,
    at: event.at,
    simulationLabel: event.simulationLabel,
  };
  bucket().events.push(row);
  return row;
}

export function memoryListEvents(taskId: string): WorkflowAuditEvent[] {
  return bucket().events.filter((e) => e.taskId === taskId);
}

export function memoryMarkAuthConsumed(authorizationId: string): void {
  bucket().consumedAuthIds.add(authorizationId);
}

export function memoryIsAuthConsumed(authorizationId: string): boolean {
  return bucket().consumedAuthIds.has(authorizationId);
}

export function memoryHaltExecution(authorizationId: string): void {
  bucket().haltedAuthIds.add(authorizationId);
}

export function memoryIsExecutionHalted(authorizationId: string): boolean {
  return bucket().haltedAuthIds.has(authorizationId);
}

/**
 * Compare-and-swap consumption for MEMORY_TEST_ONLY authorizations.
 * Mirrors planAuthorizationConsumption / markAuthorizationConsumed semantics.
 */
export function memoryConsumeAuthorizationCas(
  authorizationId: string,
  at?: string,
):
  | { ok: true; authorization: FounderActionAuthorization; consumedFully: boolean }
  | { ok: false; reason: "MISSING_AUTHORIZATION" | "NOT_APPROVED" | "USES_EXHAUSTED" | "ALREADY_CONSUMED" | "CAS_LOST" } {
  const observed = bucket().authorizations.get(authorizationId);
  if (!observed) {
    return { ok: false, reason: "MISSING_AUTHORIZATION" };
  }
  const plan = planAuthorizationConsumption({
    authorizationId,
    observedStatus: observed.status,
    observedUseCount: observed.useCount,
    reusePolicy: observed.reusePolicy,
    maxUses: observed.maxUses,
  });
  if (!plan.ok) {
    return { ok: false, reason: plan.reason };
  }

  const current = bucket().authorizations.get(authorizationId);
  if (
    !current ||
    current.status !== plan.cas.status ||
    current.useCount !== plan.cas.useCount
  ) {
    return { ok: false, reason: "CAS_LOST" };
  }

  const next: FounderActionAuthorization = {
    ...current,
    status: plan.nextStatus,
    effectiveStatus: plan.nextStatus,
    useCount: plan.nextUseCount,
    consumedAt: plan.consumeFully ? (at ?? new Date().toISOString()) : current.consumedAt,
  };
  bucket().authorizations.set(authorizationId, next);
  if (plan.consumeFully) {
    bucket().consumedAuthIds.add(authorizationId);
  }
  return { ok: true, authorization: next, consumedFully: plan.consumeFully };
}
