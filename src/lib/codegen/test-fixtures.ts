import { randomUUID } from "node:crypto";
import { scopeFingerprint } from "@/lib/approvals/workflow";
import type { FounderActionAuthorization } from "@/lib/approvals/types";

/** In-memory APPROVED authorization for local mock codegen tests — not a DB bypass of Pilot 02. */
export function makeApprovedCodingAuth(input?: {
  ownerId?: string;
  projectId?: string;
  environmentLabel?: string;
  objective?: string;
  status?: FounderActionAuthorization["status"];
  expiresAt?: string;
  useCount?: number;
}): FounderActionAuthorization {
  const ownerId = input?.ownerId ?? randomUUID();
  const projectId = input?.projectId ?? randomUUID();
  const environmentLabel = input?.environmentLabel ?? "LOCAL_CODEGEN_MOCK";
  const actionType = "agent_task.develop";
  const actionScope = `codegen:mock|obj:${(input?.objective ?? "Generate a responsive vehicle comparison component with three dummy vehicles.").slice(0, 200)}`;
  const fingerprint = scopeFingerprint({
    projectId,
    actionType,
    actionScope,
    environmentLabel,
  });
  const status = input?.status ?? "APPROVED";
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ownerId,
    projectId,
    projectName: "Codegen Mock",
    environmentLabel,
    decisionId: null,
    actionType,
    actionScope,
    scopeFingerprint: fingerprint,
    reason: "Local mock code-generation pilot authorization fixture.",
    evidence: [{ source: "codegen_mock", reference: "vehicle-comparison", at: now }],
    sideEffects: "Isolated mock generation only. No deployment. No live provider.",
    estimatedCost: "USD 0",
    status,
    effectiveStatus: status,
    reusePolicy: "ONE_TIME",
    maxUses: null,
    useCount: input?.useCount ?? 0,
    expiresAt: input?.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString(),
    requestedAt: now,
    decidedAt: status === "APPROVED" || status === "CONSUMED" ? now : null,
    decidedBy: status === "APPROVED" || status === "CONSUMED" ? ownerId : null,
    revokedAt: status === "REVOKED" ? now : null,
    revokedBy: status === "REVOKED" ? ownerId : null,
    revokeReason: status === "REVOKED" ? "test revoke" : "",
    consumedAt: status === "CONSUMED" ? now : null,
    idempotencyKey: `codegen-fixture-${randomUUID()}`,
  };
}
