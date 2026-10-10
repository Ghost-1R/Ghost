import type { PilotEvidencePack } from "@/lib/agent-runtime/pilot-evidence";
import type { ActivityItem } from "./activity";

/**
 * Minimal development wiring for isolated pilot evidence (Build 09.9).
 * Does not add public endpoints or Settings controls.
 * Only surfaces classifications from a real evidence pack — never invents PASS.
 */

export type PilotSurfaceSummary = {
  build: "09.9";
  classification: PilotEvidencePack["classification"];
  realContainerExecution: boolean;
  dockerAvailable: boolean;
  evidenceSha256: string;
  scenarioCount: number;
  notes: string[];
};

export function summarizePilotEvidenceForOps(pack: PilotEvidencePack): PilotSurfaceSummary {
  return {
    build: "09.9",
    classification: pack.classification,
    realContainerExecution: pack.report.realContainerExecution,
    dockerAvailable: pack.report.dockerAvailable,
    evidenceSha256: pack.evidenceSha256,
    scenarioCount: pack.report.scenarios.length,
    notes: [...pack.notes],
  };
}

export function pilotEvidenceToActivity(
  pack: PilotEvidencePack,
  project: { id: string; name: string },
): ActivityItem {
  return {
    id: `pilot-evidence-${pack.evidenceSha256.slice(0, 12)}`,
    projectId: project.id,
    projectName: project.name,
    kind: "agent_task",
    title: `Isolated pilot evidence: ${pack.classification}`,
    detail: [
      `docker=${pack.report.dockerAvailable ? "available" : "unavailable"}`,
      `real_container=${pack.report.realContainerExecution}`,
      `sha256=${pack.evidenceSha256.slice(0, 16)}…`,
    ].join(" · "),
    at: pack.report.finishedAt,
    href: `/projects/${project.id}`,
  };
}
