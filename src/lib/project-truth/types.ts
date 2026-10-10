/**
 * Project Truth — operational states for Build 09.0.
 * Claims are never treated as verified evidence without sources.
 */

export const OPERATIONAL_STATES = [
  "PLANNED",
  "IMPLEMENTED_LOCALLY",
  "VERIFIED_LOCALLY",
  "DEPLOYED",
  "VERIFIED_IN_PRODUCTION",
  "BLOCKED",
  "FAILED",
  "SUPERSEDED",
  "UNKNOWN",
] as const;

export type OperationalState = (typeof OPERATIONAL_STATES)[number];

export const OPERATIONAL_ENVIRONMENTS = ["LOCAL", "PRODUCTION", "UNKNOWN"] as const;
export type OperationalEnvironment = (typeof OPERATIONAL_ENVIRONMENTS)[number];

export type TruthEvidenceRef = {
  source: string;
  at: string | null;
  projectId: string;
  environment: OperationalEnvironment;
  /** Opaque id of the backing row/run — never secret material. */
  reference: string;
};

export type FacetTruth = {
  facet: "deployment" | "verification" | "execution" | "release";
  state: OperationalState;
  summary: string;
  evidence: TruthEvidenceRef[];
  /** Highest-priority next step derived from this facet alone; null when unknown. */
  nextAction: string | null;
};

export type DeploymentAttemptInput = {
  id: string;
  projectId: string;
  status: string;
  createdAt: string;
  humanId?: string | null;
  failureReason?: string | null;
  commitSha?: string | null;
};
