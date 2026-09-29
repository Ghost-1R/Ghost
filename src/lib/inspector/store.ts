import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { actionFingerprint, initialApprovalState } from "./approval";
import { classifyRisk } from "./risk";
import type { ActionApproval, ActionRequest, ApprovalState, InspectionResult } from "./types";

const OWNER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RuntimeFile = {
  inspections: InspectionResult[];
  approvals: ActionApproval[];
};

function ownerFile(root: string, ownerId: string): string {
  if (!OWNER_ID.test(ownerId)) {
    throw new Error("Owner id is not valid.");
  }
  return path.join(root, `${ownerId}.json`);
}

async function readRuntime(root: string, ownerId: string): Promise<RuntimeFile> {
  const raw = await readFile(ownerFile(root, ownerId), "utf8").catch(() => "");
  if (!raw) {
    return { inspections: [], approvals: [] };
  }
  const parsed = JSON.parse(raw) as RuntimeFile;
  return {
    inspections: Array.isArray(parsed.inspections) ? parsed.inspections : [],
    approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
  };
}

async function writeRuntime(root: string, ownerId: string, value: RuntimeFile): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(ownerFile(root, ownerId), JSON.stringify(value, null, 2), "utf8");
}

export function defaultRuntimeRoot(cwd = process.cwd()): string {
  return path.join(cwd, ".ghost", "runtime");
}

export async function saveInspection(root: string, result: InspectionResult): Promise<void> {
  const current = await readRuntime(root, result.ownerId);
  current.inspections = [result, ...current.inspections.filter((item) => item.id !== result.id)].slice(0, 40);
  await writeRuntime(root, result.ownerId, current);
}

export async function listInspections(root: string, ownerId: string): Promise<InspectionResult[]> {
  const current = await readRuntime(root, ownerId);
  return current.inspections.filter((item) => item.ownerId === ownerId);
}

export async function deleteInspection(root: string, ownerId: string, inspectionId: string): Promise<void> {
  const current = await readRuntime(root, ownerId);
  current.inspections = current.inspections.filter((item) => item.id !== inspectionId);
  await writeRuntime(root, ownerId, current);
}

export async function proposeApproval(root: string, ownerId: string, request: ActionRequest): Promise<ActionApproval | null> {
  const risk = classifyRisk(request.actionType);
  const status = initialApprovalState(request.actionType);
  if (!risk || !status) {
    return null;
  }
  const approval: ActionApproval = {
    id: randomUUID(),
    ownerId,
    projectId: request.projectId,
    actionType: request.actionType,
    target: request.target,
    parameters: request.parameters,
    fingerprint: actionFingerprint(request),
    risk,
    reason: request.reason,
    expectedEffect: request.expectedEffect,
    verificationPlan: request.verificationPlan,
    rollbackPlan: request.rollbackPlan,
    status,
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  const current = await readRuntime(root, ownerId);
  current.approvals = [approval, ...current.approvals].slice(0, 40);
  await writeRuntime(root, ownerId, current);
  return approval;
}

export async function listApprovals(root: string, ownerId: string): Promise<ActionApproval[]> {
  const current = await readRuntime(root, ownerId);
  return current.approvals.filter((item) => item.ownerId === ownerId);
}

export async function decideApproval(
  root: string,
  ownerId: string,
  approvalId: string,
  decision: Extract<ApprovalState, "APPROVED" | "REJECTED">,
): Promise<ActionApproval | null> {
  const current = await readRuntime(root, ownerId);
  const approval = current.approvals.find((item) => item.id === approvalId && item.ownerId === ownerId);
  if (!approval || approval.status !== "PENDING") {
    return null;
  }
  approval.status = decision;
  approval.decidedAt = new Date().toISOString();
  await writeRuntime(root, ownerId, current);
  return approval;
}
