import { actionFingerprint } from "@/lib/inspector/approval";
import type { ApprovalRecord } from "./types";

export function approvalVoidReason(
  approval: ApprovalRecord,
  request: { operation: string; target: string; parameters: Record<string, string>; projectId: string; commitSha: string },
  now: string,
): "expired" | "commit" | "fingerprint" | null {
  if (approval.expiresAt <= now) {
    return "expired";
  }
  if (approval.commitSha !== request.commitSha) {
    return "commit";
  }
  const fingerprint = actionFingerprint({
    actionType: request.operation,
    target: request.target,
    parameters: request.parameters,
    projectId: request.projectId,
  });
  if (approval.fingerprint !== fingerprint) {
    return "fingerprint";
  }
  return null;
}
