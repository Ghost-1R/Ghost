import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeOutput } from "@/lib/inspector/sanitize";
import type {
  ApprovalRecord,
  EvidenceCheckType,
  EvidenceRecord,
  EvidenceStatus,
  EvidenceWriter,
  OverrideRecord,
  PresentationReview,
} from "./types";

const OWNER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function presentationRoot(cwd = process.cwd()): string {
  return path.join(cwd, ".ghost", "presentation");
}

type LedgerFile = {
  evidence: EvidenceRecord[];
  reviews: PresentationReview[];
  approvals: ApprovalRecord[];
  overrides: OverrideRecord[];
};

function emptyLedger(): LedgerFile {
  return { evidence: [], reviews: [], approvals: [], overrides: [] };
}

function ownerFile(root: string, ownerId: string): string {
  if (!OWNER_ID.test(ownerId)) {
    throw new Error("Owner id is not valid.");
  }
  return path.join(root, `${ownerId}.json`);
}

async function readLedger(root: string, ownerId: string): Promise<LedgerFile> {
  const raw = await readFile(ownerFile(root, ownerId), "utf8").catch(() => "");
  if (!raw) {
    return emptyLedger();
  }
  const parsed = JSON.parse(raw) as LedgerFile;
  return {
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
    reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
    approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
    overrides: Array.isArray(parsed.overrides) ? parsed.overrides : [],
  };
}

async function writeLedger(root: string, ownerId: string, value: LedgerFile): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(ownerFile(root, ownerId), JSON.stringify(value), "utf8");
}

export function outputHash(value: string): string {
  return createHash("sha256").update(sanitizeOutput(value, 100_000)).digest("hex");
}

export function logExcerpt(value: string): string {
  return sanitizeOutput(value, 500);
}

export async function appendEvidence(
  root: string,
  writer: EvidenceWriter,
  input: Omit<EvidenceRecord, "id" | "runner" | "logExcerpt" | "outputHash"> & { output: string },
): Promise<EvidenceRecord | null> {
  if (writer !== "runner") {
    return null;
  }
  const record: EvidenceRecord = {
    id: randomUUID(),
    ownerId: input.ownerId,
    projectId: input.projectId,
    runId: input.runId,
    checkType: input.checkType,
    commitSha: input.commitSha,
    treeHash: input.treeHash,
    command: input.command,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    outputHash: outputHash(input.output),
    logExcerpt: logExcerpt(input.output),
    runner: "inspector",
    environment: input.environment,
    status: input.status,
    createdAt: input.createdAt,
  };
  const ledger = await readLedger(root, input.ownerId);
  ledger.evidence = [...ledger.evidence, record];
  await writeLedger(root, input.ownerId, ledger);
  return record;
}

export async function listEvidence(root: string, ownerId: string): Promise<EvidenceRecord[]> {
  const ledger = await readLedger(root, ownerId);
  return ledger.evidence.filter((row) => row.ownerId === ownerId);
}

export async function appendReview(root: string, review: PresentationReview): Promise<void> {
  const ledger = await readLedger(root, review.ownerId);
  ledger.reviews = [...ledger.reviews, review];
  await writeLedger(root, review.ownerId, ledger);
}

export async function listReviews(root: string, ownerId: string): Promise<PresentationReview[]> {
  const ledger = await readLedger(root, ownerId);
  return ledger.reviews.filter((row) => row.ownerId === ownerId);
}

export async function appendApproval(root: string, approval: ApprovalRecord): Promise<void> {
  const ledger = await readLedger(root, approval.ownerId);
  ledger.approvals = [...ledger.approvals, approval];
  await writeLedger(root, approval.ownerId, ledger);
}

export async function listApprovals(root: string, ownerId: string): Promise<ApprovalRecord[]> {
  const ledger = await readLedger(root, ownerId);
  return ledger.approvals.filter((row) => row.ownerId === ownerId);
}

export function createOverride(input: Omit<OverrideRecord, "id" | "createdAt"> & { createdAt?: string }): OverrideRecord | null {
  if (input.reason.trim().length < 8 || !input.founderId || !input.target || !input.commitSha) {
    return null;
  }
  return {
    ...input,
    id: randomUUID(),
    reason: input.reason.trim(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export async function appendOverride(root: string, override: OverrideRecord): Promise<void> {
  const ledger = await readLedger(root, override.ownerId);
  ledger.overrides = [...ledger.overrides, override];
  await writeLedger(root, override.ownerId, ledger);
}

export function evidenceCovers(
  rows: EvidenceRecord[],
  checkType: EvidenceCheckType,
  status: EvidenceStatus,
): EvidenceRecord | null {
  return [...rows].reverse().find((row) => row.checkType === checkType && row.status === status) ?? null;
}
