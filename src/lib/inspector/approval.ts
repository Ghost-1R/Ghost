import { createHash } from "node:crypto";
import { approvalRequired, classifyRisk, UNSUPPORTED_ACTIONS } from "./risk";
import type { ActionApproval, ActionRequest, ApprovalState } from "./types";

export function actionFingerprint(input: Pick<ActionRequest, "actionType" | "target" | "parameters" | "projectId">): string {
  const parameters = Object.keys(input.parameters)
    .sort()
    .map((key) => [key, input.parameters[key] ?? ""]);
  const payload = JSON.stringify({
    actionType: input.actionType,
    target: input.target,
    parameters,
    projectId: input.projectId,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function initialApprovalState(actionType: string): ApprovalState | null {
  const risk = classifyRisk(actionType);
  if (!risk) {
    return null;
  }
  return approvalRequired(risk) ? "PENDING" : "NOT_REQUIRED";
}

export function chatCannotApprove(message: string): true {
  void message;
  return true;
}

export type ExecuteDecision = {
  ok: false;
  reason: "UNSUPPORTED" | "UNKNOWN_ACTION" | "APPROVAL_REQUIRED" | "PENDING" | "REJECTED" | "FINGERPRINT_MISMATCH" | "NOT_APPROVED";
} | {
  ok: true;
  reason: "NOT_REQUIRED" | "APPROVED";
};

export function canExecute(approval: ActionApproval | null, request: ActionRequest): ExecuteDecision {
  const risk = classifyRisk(request.actionType);
  if (!risk) {
    return { ok: false, reason: "UNKNOWN_ACTION" };
  }
  const unsupported = risk === "CRITICAL" || UNSUPPORTED_ACTIONS.has(request.actionType);
  if (!approvalRequired(risk) && !unsupported) {
    return { ok: true, reason: "NOT_REQUIRED" };
  }
  if (!approval) {
    return { ok: false, reason: unsupported ? "UNSUPPORTED" : "APPROVAL_REQUIRED" };
  }
  if (approval.fingerprint !== actionFingerprint(request)) {
    return { ok: false, reason: "FINGERPRINT_MISMATCH" };
  }
  if (approval.status === "PENDING") {
    return { ok: false, reason: "PENDING" };
  }
  if (approval.status === "REJECTED") {
    return { ok: false, reason: "REJECTED" };
  }
  if (approval.status !== "APPROVED") {
    return { ok: false, reason: "NOT_APPROVED" };
  }
  if (unsupported) {
    return { ok: false, reason: "UNSUPPORTED" };
  }
  return { ok: true, reason: "APPROVED" };
}
