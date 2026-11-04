import { actionFingerprint } from "@/lib/inspector/approval";
import type { RiskLevel } from "@/lib/inspector/types";
import { classifyOperationRisk, raiseRisk } from "./change-risk";
import { buildPresentationReview } from "./review";
import { logExcerpt, outputHash } from "./ledger";
import {
  EVIDENCE_CHECK_TYPES,
  EVIDENCE_STATUSES,
  type ApprovalRecord,
  type EvidenceCheckType,
  type EvidenceRecord,
  type EvidenceStatus,
  type EvidenceWriter,
  type OverrideRecord,
  type PresentationReview,
} from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CLIENT_EVIDENCE_FIELDS = [
  "status",
  "exit_code",
  "exitCode",
  "runner",
  "commit",
  "commitSha",
  "tree_hash",
  "treeHash",
  "output",
  "check_type",
  "checkType",
  "environment",
] as const;

export function rejectedClientEvidence(fields: Iterable<string>): string | null {
  const forbidden = new Set<string>(CLIENT_EVIDENCE_FIELDS);
  const present = [...fields].filter((field) => forbidden.has(field));
  if (present.length === 0) {
    return null;
  }
  return "The server records evidence from the check, not from the client.";
}

const RISK_LEVELS = new Set<RiskLevel>(["SAFE", "CAUTION", "HIGH", "CRITICAL"]);

export type Prepared<T> = { ok: true; value: T } | { ok: false; reason: string };

export type EvidenceDraft = {
  writer: EvidenceWriter;
  ownerId: string;
  projectId: string;
  runId: string;
  checkType: string;
  commitSha: string;
  treeHash: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  output: string;
  environment: string;
  status: string;
  createdAt: string;
  claimedResult?: string;
};

export function prepareEvidence(draft: EvidenceDraft): Prepared<Omit<EvidenceRecord, "id">> {
  if (draft.writer !== "runner") {
    return { ok: false, reason: "Only the inspector runner can create evidence." };
  }
  if (draft.claimedResult) {
    return { ok: false, reason: "Evidence cannot carry a presentation result." };
  }
  if (!UUID_PATTERN.test(draft.ownerId) || !UUID_PATTERN.test(draft.projectId) || !UUID_PATTERN.test(draft.runId)) {
    return { ok: false, reason: "Evidence identity is not valid." };
  }
  if (!EVIDENCE_CHECK_TYPES.includes(draft.checkType as EvidenceCheckType)) {
    return { ok: false, reason: "That check is not part of the evidence record." };
  }
  if (!EVIDENCE_STATUSES.includes(draft.status as EvidenceStatus)) {
    return { ok: false, reason: "That evidence status is not valid." };
  }
  if (draft.environment !== "local" && draft.environment !== "production") {
    return { ok: false, reason: "That evidence environment is not valid." };
  }
  if (!Number.isInteger(draft.durationMs) || draft.durationMs < 0 || draft.durationMs > 3_600_000) {
    return { ok: false, reason: "Evidence duration is not valid." };
  }
  if (draft.exitCode !== null && !Number.isInteger(draft.exitCode)) {
    return { ok: false, reason: "Evidence exit code is not valid." };
  }
  if (!/^[0-9a-f]{7,64}$/i.test(draft.commitSha) || !/^[0-9a-f]{64}$/i.test(draft.treeHash)) {
    return { ok: false, reason: "Evidence is not bound to a commit and tree." };
  }
  if (Number.isNaN(Date.parse(draft.createdAt))) {
    return { ok: false, reason: "Evidence timestamp is not valid." };
  }
  const command = logExcerpt(draft.command);
  if (!command.trim()) {
    return { ok: false, reason: "Evidence command is empty." };
  }
  return {
    ok: true,
    value: {
      ownerId: draft.ownerId,
      projectId: draft.projectId,
      runId: draft.runId,
      checkType: draft.checkType as EvidenceCheckType,
      commitSha: draft.commitSha,
      treeHash: draft.treeHash,
      command,
      exitCode: draft.exitCode,
      durationMs: draft.durationMs,
      outputHash: outputHash(draft.output),
      logExcerpt: logExcerpt(draft.output),
      runner: "inspector",
      environment: draft.environment,
      status: draft.status as EvidenceStatus,
      createdAt: draft.createdAt,
    },
  };
}

export function prepareApproval(input: {
  ownerId: string;
  projectId: string;
  operation: string;
  target: string;
  commitSha: string;
  parameters: Record<string, string>;
  paths?: string[];
  suppliedRisk?: string | null;
  evidenceIdsShown: string[];
  knownEvidenceIds: string[];
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  suppliedFingerprint?: string | null;
}): Prepared<Omit<ApprovalRecord, "id">> {
  if (!UUID_PATTERN.test(input.ownerId) || !UUID_PATTERN.test(input.projectId) || !UUID_PATTERN.test(input.approvedBy)) {
    return { ok: false, reason: "Approval identity is not valid." };
  }
  if (input.approvedBy !== input.ownerId) {
    return { ok: false, reason: "The signed-in founder is the approver." };
  }
  if (!input.operation.trim() || !input.target.trim() || !/^[0-9a-f]{7,64}$/i.test(input.commitSha)) {
    return { ok: false, reason: "Approval operation, target, and commit are required." };
  }
  if (Number.isNaN(Date.parse(input.approvedAt)) || Number.isNaN(Date.parse(input.expiresAt))) {
    return { ok: false, reason: "Approval times are not valid." };
  }
  if (Date.parse(input.expiresAt) <= Date.parse(input.approvedAt)) {
    return { ok: false, reason: "Approval expiry is not after the approval time." };
  }
  const unknownEvidence = input.evidenceIdsShown.filter((id) => !input.knownEvidenceIds.includes(id));
  if (unknownEvidence.length > 0 || input.evidenceIdsShown.some((id) => !UUID_PATTERN.test(id))) {
    return { ok: false, reason: "Approval can only cite evidence the server loaded." };
  }
  const determined = classifyOperationRisk(input.operation, input.paths ?? []);
  const requested = input.suppliedRisk && RISK_LEVELS.has(input.suppliedRisk as RiskLevel) ? (input.suppliedRisk as RiskLevel) : null;
  const riskLevel = raiseRisk(determined, requested);
  const fingerprint = actionFingerprint({
    actionType: input.operation,
    target: input.target,
    parameters: input.parameters,
    projectId: input.projectId,
  });
  if (input.suppliedFingerprint && input.suppliedFingerprint !== fingerprint) {
    return { ok: false, reason: "Approval fingerprint does not match the operation." };
  }
  return {
    ok: true,
    value: {
      ownerId: input.ownerId,
      projectId: input.projectId,
      operation: input.operation,
      target: input.target,
      commitSha: input.commitSha,
      riskLevel,
      evidenceIdsShown: input.evidenceIdsShown,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      expiresAt: input.expiresAt,
      fingerprint,
    },
  };
}

export function prepareOverride(
  input: {
    ownerId: string;
    projectId: string;
    reason: string;
    founderId: string;
    createdAt: string;
    target: string;
    commitSha: string;
    affectedChecks: string[];
  },
  evidence: EvidenceRecord[],
): Prepared<{ override: Omit<OverrideRecord, "id">; evidence: EvidenceRecord[] }> {
  if (input.reason.trim().length < 8) {
    return { ok: false, reason: "An override needs a written reason." };
  }
  if (!UUID_PATTERN.test(input.ownerId) || !UUID_PATTERN.test(input.projectId) || !UUID_PATTERN.test(input.founderId)) {
    return { ok: false, reason: "Override identity is not valid." };
  }
  if (input.founderId !== input.ownerId) {
    return { ok: false, reason: "The signed-in founder records the override." };
  }
  if (!input.target.trim() || !/^[0-9a-f]{7,64}$/i.test(input.commitSha) || Number.isNaN(Date.parse(input.createdAt))) {
    return { ok: false, reason: "Override target, commit, and time are required." };
  }
  if (input.affectedChecks.length === 0 || input.affectedChecks.some((check) => !EVIDENCE_CHECK_TYPES.includes(check as EvidenceCheckType))) {
    return { ok: false, reason: "Override must name the affected checks." };
  }
  return {
    ok: true,
    value: {
      override: {
        ownerId: input.ownerId,
        projectId: input.projectId,
        reason: input.reason.trim(),
        founderId: input.founderId,
        createdAt: input.createdAt,
        target: input.target,
        commitSha: input.commitSha,
        affectedChecks: input.affectedChecks,
      },
      evidence,
    },
  };
}

export function computePresentationReview(
  input: Parameters<typeof buildPresentationReview>[0] & { claimedResult?: string },
): PresentationReview {
  const { claimedResult: _claimedResult, ...rest } = input;
  void _claimedResult;
  return buildPresentationReview(rest);
}
