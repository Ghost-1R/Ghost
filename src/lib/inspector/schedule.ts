export const READ_ONLY_CHECK_IDS = ["lint", "typescript", "test", "git-status"] as const;
export const SERIAL_CHECK_IDS = ["build"] as const;

export const PARALLEL_PROBES = [
  "security-boundary",
  "customer-flows",
  "responsive-viewports",
  "conversation-migration-regression",
  "model-provider-regression",
  "requirement-trace",
] as const;

export type InspectionStage =
  | "QUEUED"
  | "PREPARING"
  | "RUNNING"
  | "COLLECTING_EVIDENCE"
  | "VERIFYING"
  | "COMPLETE"
  | "FAILED"
  | "BLOCKED";

export type InspectionProgress = {
  stage: InspectionStage;
  check: string | null;
  status: "running" | "passed" | "failed" | "blocked" | "skipped" | null;
  elapsedMs: number;
  durationMs?: number;
  detail: string;
};

export function overallStage(events: readonly InspectionProgress[]): InspectionStage | null {
  const last = events.at(-1);
  if (!last) {
    return null;
  }
  if (last.stage === "COMPLETE" || last.stage === "FAILED") {
    return last.stage;
  }
  const latest = new Map<string, InspectionProgress>();
  for (const event of events) {
    if (event.check) {
      latest.set(event.check, event);
    }
  }
  const running = [...latest.values()].filter((event) => event.status === "running");
  if (running.some((event) => event.stage === "RUNNING")) {
    return "RUNNING";
  }
  if (running.length > 0) {
    return "VERIFYING";
  }
  return last.stage;
}

const READ_ONLY = new Set<string>(READ_ONLY_CHECK_IDS);
const SERIAL = new Set<string>(SERIAL_CHECK_IDS);

export function commandWaves(checkIds: readonly string[]): string[][] {
  const remaining = new Set(checkIds);
  const parallel = READ_ONLY_CHECK_IDS.filter((id) => remaining.has(id));
  for (const id of parallel) {
    remaining.delete(id);
  }
  const waves: string[][] = [];
  if (parallel.length > 0) {
    waves.push([...parallel]);
  }
  for (const id of SERIAL_CHECK_IDS) {
    if (remaining.has(id)) {
      waves.push([id]);
      remaining.delete(id);
    }
  }
  for (const id of checkIds) {
    if (remaining.has(id)) {
      waves.push([id]);
      remaining.delete(id);
    }
  }
  return waves;
}

export function commandIsReadOnly(id: string): boolean {
  return READ_ONLY.has(id) && !SERIAL.has(id);
}

export async function runWaves<T>(checkIds: readonly string[], run: (id: string) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (const wave of commandWaves(checkIds)) {
    const batch = await Promise.all(wave.map((id) => run(id)));
    results.push(...batch);
  }
  return results;
}
