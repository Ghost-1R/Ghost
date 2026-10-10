export const AUTHORIZATION_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "REVOKED",
  "EXPIRED",
  "CONSUMED",
] as const;

export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

export const AUTHORIZATION_REUSE_POLICIES = ["ONE_TIME", "BOUNDED"] as const;
export type AuthorizationReusePolicy = (typeof AUTHORIZATION_REUSE_POLICIES)[number];

export type AuthorizationEvidenceItem = {
  source: string;
  reference: string;
  at: string | null;
};

export type FounderActionAuthorization = {
  id: string;
  ownerId: string;
  projectId: string;
  projectName: string;
  environmentLabel: string;
  decisionId: string | null;
  actionType: string;
  actionScope: string;
  scopeFingerprint: string;
  reason: string;
  evidence: AuthorizationEvidenceItem[];
  sideEffects: string;
  estimatedCost: string;
  status: AuthorizationStatus;
  /** Effective status after expiry clock (may differ from stored when past expires_at). */
  effectiveStatus: AuthorizationStatus;
  reusePolicy: AuthorizationReusePolicy;
  maxUses: number | null;
  useCount: number;
  expiresAt: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string;
  consumedAt: string | null;
  idempotencyKey: string;
};

export type AuthorizationEvent = {
  id: string;
  authorizationId: string;
  eventType: string;
  detail: string;
  scopeFingerprint: string;
  actorId: string | null;
  createdAt: string;
};

export type AuthorizationRequestInput = {
  projectId: string;
  environmentLabel?: string;
  decisionId?: string | null;
  actionType: string;
  actionScope: string;
  reason: string;
  evidence?: AuthorizationEvidenceItem[];
  sideEffects?: string;
  estimatedCost?: string;
  reusePolicy?: AuthorizationReusePolicy;
  maxUses?: number | null;
  expiresAt: string;
  idempotencyKey: string;
};

/** What an executor must present when revalidating — never taken from UI alone. */
export type ExecutionRevalidationRequest = {
  authorizationId: string;
  ownerId: string;
  projectId: string;
  actionType: string;
  actionScope: string;
  environmentLabel?: string;
  at?: string;
};
