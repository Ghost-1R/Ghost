import type { OperationalState } from "@/lib/project-truth/types";
import type { EvidenceVerificationState, RemoteDevTask } from "./types";

/**
 * Project Truth boundary for Build 09.11.
 * SIMULATED fake-provider outcomes must never become VERIFIED_LOCALLY
 * or VERIFIED_IN_PRODUCTION. Provider claims remain UNVERIFIED until
 * independently checked — and even founder review of simulated work
 * does not promote Project Truth verification facets.
 */

export const SIMULATION_TRUTH_SOURCE = "remote_development_simulated" as const;

export type SimulatedTruthReport = {
  source: typeof SIMULATION_TRUTH_SOURCE;
  simulationLabel: "SIMULATED";
  taskId: string;
  taskStatus: RemoteDevTask["status"];
  evidenceVerificationState: EvidenceVerificationState | "NONE";
  /** Always false — simulation cannot grant local/production verification. */
  mapsToVerifiedLocally: false;
  mapsToVerifiedInProduction: false;
  /** Honest operational state for Project Truth — never a verified facet. */
  projectTruthOperationalState: Extract<OperationalState, "UNKNOWN" | "PLANNED" | "BLOCKED" | "FAILED">;
  summary: string;
};

/**
 * Map a remote-dev / simulated outcome into a Project Truth-safe report.
 * Fake provider success is explicitly NOT genuine implementation verification.
 */
export function reportSimulatedOutcomeForProjectTruth(task: RemoteDevTask): SimulatedTruthReport {
  const evidenceState = task.evidence?.verificationState ?? "NONE";
  let projectTruthOperationalState: SimulatedTruthReport["projectTruthOperationalState"] = "UNKNOWN";
  let summary =
    "SIMULATED remote development outcome — not genuine implementation; Project Truth verification unchanged.";

  if (task.status === "FAILED" || task.status === "CANCELLED") {
    projectTruthOperationalState = "FAILED";
    summary = "SIMULATED remote development failed or cancelled — Project Truth remains non-verified.";
  } else if (task.status === "BLOCKED") {
    projectTruthOperationalState = "BLOCKED";
    summary = "SIMULATED remote development blocked — Project Truth remains non-verified.";
  } else if (task.status === "AWAITING_APPROVAL" || task.status === "QUEUED") {
    projectTruthOperationalState = "PLANNED";
    summary = "SIMULATED workflow planned/queued — no local or production verification claim.";
  } else if (task.status === "VERIFIED") {
    // Founder reviewed simulated evidence — still NOT Project Truth VERIFIED_*.
    projectTruthOperationalState = "UNKNOWN";
    summary =
      "Founder reviewed SIMULATED remote-dev evidence. Does not set VERIFIED_LOCALLY or VERIFIED_IN_PRODUCTION.";
  }

  return {
    source: SIMULATION_TRUTH_SOURCE,
    simulationLabel: "SIMULATED",
    taskId: task.id,
    taskStatus: task.status,
    evidenceVerificationState: evidenceState,
    mapsToVerifiedLocally: false,
    mapsToVerifiedInProduction: false,
    projectTruthOperationalState,
    summary,
  };
}

/**
 * Hard guard: refuse any attempt to treat simulated success as Project Truth verification.
 */
export function assertSimulatedCannotVerifyProjectTruth(input: {
  simulationLabel: "SIMULATED" | "NONE";
  requestedOperationalState: OperationalState;
}): { ok: true } | { ok: false; reason: "FALSE_SUCCESS_PREVENTED"; message: string } {
  if (input.simulationLabel !== "SIMULATED") {
    return { ok: true };
  }
  if (
    input.requestedOperationalState === "VERIFIED_LOCALLY" ||
    input.requestedOperationalState === "VERIFIED_IN_PRODUCTION" ||
    input.requestedOperationalState === "IMPLEMENTED_LOCALLY" ||
    input.requestedOperationalState === "DEPLOYED"
  ) {
    return {
      ok: false,
      reason: "FALSE_SUCCESS_PREVENTED",
      message: `SIMULATED outcomes cannot become ${input.requestedOperationalState}.`,
    };
  }
  return { ok: true };
}
