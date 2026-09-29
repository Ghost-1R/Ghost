import type { VerificationState } from "@/lib/domain/status";

/**
 * A future host implements this contract.
 * Alpha registers no provider and must not pretend a deploy happened.
 */
export type DeploymentProvider = {
  id: string;
  label: string;
  inspect(): Promise<{
    state: VerificationState;
    evidence: string;
  }>;
};

export type DeploymentSelection = {
  provider: string | null;
  vercelAllowed: false;
};
