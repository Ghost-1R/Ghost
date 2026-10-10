import type { AgentAuthorizationKind } from "./types";
import { DEPLOYMENT_ACTION_TYPES, DEVELOPMENT_ACTION_TYPES } from "./types";

const DEVELOPMENT_SET = new Set<string>(DEVELOPMENT_ACTION_TYPES);
const DEPLOYMENT_SET = new Set<string>(DEPLOYMENT_ACTION_TYPES);

/**
 * Classify a founder authorization action type into DEVELOPMENT or DEPLOYMENT.
 * Unknown types fail closed (null) — they cannot authorize agent tasks.
 */
export function classifyAgentActionType(actionType: string): AgentAuthorizationKind | null {
  const trimmed = actionType.trim();
  if (DEVELOPMENT_SET.has(trimmed)) return "DEVELOPMENT";
  if (DEPLOYMENT_SET.has(trimmed)) return "DEPLOYMENT";
  return null;
}

/**
 * Development approvals never authorize deployment work (and vice versa).
 * Fail closed when kinds diverge or action types are unclassified.
 */
export function assertAuthorizationKindCompatible(
  declaredKind: AgentAuthorizationKind,
  actionType: string,
): { ok: true } | { ok: false; reason: "UNKNOWN_ACTION_TYPE" | "KIND_MISMATCH" | "DEPLOYMENT_NOT_AUTHORIZED" | "DEVELOPMENT_NOT_AUTHORIZED" } {
  const classified = classifyAgentActionType(actionType);
  if (!classified) {
    return { ok: false, reason: "UNKNOWN_ACTION_TYPE" };
  }
  if (classified !== declaredKind) {
    if (declaredKind === "DEPLOYMENT" && classified === "DEVELOPMENT") {
      return { ok: false, reason: "DEPLOYMENT_NOT_AUTHORIZED" };
    }
    if (declaredKind === "DEVELOPMENT" && classified === "DEPLOYMENT") {
      return { ok: false, reason: "DEVELOPMENT_NOT_AUTHORIZED" };
    }
    return { ok: false, reason: "KIND_MISMATCH" };
  }
  return { ok: true };
}

/** True only when both sides are explicitly DEPLOYMENT. */
export function developmentApprovalGrantsDeployment(
  authorizationActionType: string,
  requestedKind: AgentAuthorizationKind,
): boolean {
  if (requestedKind !== "DEPLOYMENT") return false;
  return classifyAgentActionType(authorizationActionType) === "DEPLOYMENT";
}
