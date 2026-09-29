import type { ActionRequest, RiskLevel } from "./types";

const ACTION_RISK: Record<string, RiskLevel> = {
  "read-repository": "SAFE",
  "read-project-brain": "SAFE",
  "run-lint": "SAFE",
  "run-typescript": "SAFE",
  "run-tests": "SAFE",
  "inspect-git": "SAFE",
  "read-verification": "SAFE",
  "read-github": "SAFE",
  "create-reconciliation-plan": "SAFE",
  "propose-memory": "SAFE",
  "create-local-file": "CAUTION",
  "modify-code": "CAUTION",
  "create-migration-file": "CAUTION",
  "local-commit": "CAUTION",
  "create-branch": "CAUTION",
  "approve-memory": "CAUTION",
  "retire-memory": "CAUTION",
  "apply-remote-migration": "HIGH",
  push: "HIGH",
  merge: "HIGH",
  "change-production-config": "HIGH",
  "modify-auth-rls": "HIGH",
  "modify-payment": "HIGH",
  "bulk-data-change": "HIGH",
  "force-push": "CRITICAL",
  "remote-db-reset": "CRITICAL",
  "delete-repository": "CRITICAL",
  "delete-production-data": "CRITICAL",
  "destructive-migration": "CRITICAL",
  "disable-security": "CRITICAL",
  "bulk-destructive-delete": "CRITICAL",
};

export const UNSUPPORTED_ACTIONS = new Set([
  "apply-remote-migration",
  "push",
  "merge",
  "force-push",
  "remote-db-reset",
  "delete-repository",
  "delete-production-data",
  "destructive-migration",
  "disable-security",
  "bulk-destructive-delete",
]);

export function classifyRisk(actionType: string): RiskLevel | null {
  return ACTION_RISK[actionType] ?? null;
}

export function approvalRequired(risk: RiskLevel): boolean {
  return risk === "HIGH" || risk === "CRITICAL";
}

export function actionPlan(input: ActionRequest & { risk: RiskLevel }) {
  return {
    action: input.actionType,
    target: input.target,
    risk: input.risk,
    reason: input.reason,
    expectedEffect: input.expectedEffect,
    verificationPlan: input.verificationPlan,
    rollbackPlan: input.rollbackPlan,
  };
}
