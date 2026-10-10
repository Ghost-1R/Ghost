import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PilotRunReport } from "./pilot-executor";
import { summarizePilotReport } from "./pilot-executor";
import type { ReviewArtifact } from "./review-artifacts";
import { createReviewArtifact } from "./review-artifacts";

export type PilotEvidenceClassification = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "PARTIAL";

export type PilotEvidencePack = {
  build: "09.9";
  classification: PilotEvidenceClassification;
  evidenceSha256: string;
  report: PilotRunReport;
  artifact: ReviewArtifact | null;
  writtenPath: string | null;
  notes: string[];
};

/**
 * Produce private, reviewable pilot evidence.
 * Never fabricates successful container verification.
 */
export function buildPilotEvidencePack(
  report: PilotRunReport,
  options?: { writeDir?: string; ownerId?: string; projectId?: string; taskId?: string },
): PilotEvidencePack {
  const summary = summarizePilotReport(report);
  const notes: string[] = [];

  if (!report.pilotEnabled) {
    notes.push("Pilot gate disabled — execution not attempted.");
  }
  if (!report.dockerAvailable) {
    notes.push("Docker unavailable — real container execution NOT_RUN.");
  }
  if (report.realContainerExecution) {
    notes.push("Real container execution was attempted.");
  } else {
    notes.push("No real container execution occurred in this environment.");
  }

  let artifact: ReviewArtifact | null = null;
  const art = createReviewArtifact({
    task: {
      id: options?.taskId ?? "pilot-evidence",
      ownerId: options?.ownerId ?? "00000000-0000-4000-8000-000000000001",
      projectId: options?.projectId ?? "00000000-0000-4000-8000-000000000002",
    },
    kind: "TEST_LOG",
    title: `Isolated pilot evidence (${summary.overall})`,
    contentRef: `sha256:${summary.evidenceSha256}; docker=${report.dockerAvailable}; real=${report.realContainerExecution}`,
  });
  if (art.ok) artifact = art.artifact;

  let writtenPath: string | null = null;
  if (options?.writeDir) {
    mkdirSync(options.writeDir, { recursive: true });
    writtenPath = path.join(options.writeDir, `ghost-09-9-pilot-evidence-${summary.evidenceSha256.slice(0, 12)}.json`);
    writeFileSync(
      writtenPath,
      JSON.stringify(
        {
          build: "09.9",
          classification: summary.overall,
          evidenceSha256: summary.evidenceSha256,
          notes,
          report,
          artifact,
        },
        null,
        2,
      ),
    );
  }

  return {
    build: "09.9",
    classification: summary.overall,
    evidenceSha256: summary.evidenceSha256,
    report,
    artifact,
    writtenPath,
    notes,
  };
}

export function hashPilotEvidencePayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
