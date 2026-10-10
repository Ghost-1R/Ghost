import type { OperationalState } from "./types";
import type { ProjectTruthSnapshot } from "./snapshot";

export function operationalStateLabel(state: OperationalState): string {
  switch (state) {
    case "PLANNED":
      return "Planned";
    case "IMPLEMENTED_LOCALLY":
      return "Implemented locally";
    case "VERIFIED_LOCALLY":
      return "Verified locally";
    case "DEPLOYED":
      return "Deployed";
    case "VERIFIED_IN_PRODUCTION":
      return "Verified in production";
    case "BLOCKED":
      return "Blocked";
    case "FAILED":
      return "Failed";
    case "SUPERSEDED":
      return "Superseded (historical)";
    case "UNKNOWN":
      return "Unknown / unverified";
    default:
      return "Unknown / unverified";
  }
}

export function formatEvidenceLine(evidence: ProjectTruthSnapshot["evidence"][number]): string {
  const when = evidence.at ? evidence.at : "time unknown";
  return `${evidence.source} · ${evidence.environment} · ${evidence.reference} · ${when}`;
}

export function summarizeProjectTruth(snapshot: ProjectTruthSnapshot): {
  headline: string;
  deploymentLine: string;
  verificationLine: string;
  nextLine: string | null;
  unknownNotice: string | null;
} {
  const headline = `${snapshot.projectName}: ${operationalStateLabel(snapshot.overallState)}`;
  const deploymentLine = snapshot.deployment.summary;
  const verificationLine = snapshot.verification.summary;
  const nextLine = snapshot.nextAction.nextAction;
  const unknownNotice =
    snapshot.overallState === "UNKNOWN" ||
    snapshot.deployment.state === "UNKNOWN" ||
    snapshot.verification.state === "UNKNOWN"
      ? "Insufficient evidence for a stronger claim. Ghost shows UNKNOWN instead of inventing status."
      : null;
  return { headline, deploymentLine, verificationLine, nextLine, unknownNotice };
}
