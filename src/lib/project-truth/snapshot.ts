import { nextHighestPriorityAction } from "./next-action";
import { classifyDeploymentAttemptStatuses, reconcileDeploymentFacet, reconcileLocalVerificationFacet } from "./reconcile";
import type {
  DeploymentAttemptInput,
  FacetTruth,
  OperationalState,
  TruthEvidenceRef,
} from "./types";

export type ProjectTruthBlocker = {
  id: string;
  title: string;
  at: string | null;
  href: string;
};

export type ProjectTruthDecision = {
  id: string;
  title: string;
  at: string | null;
  href: string;
};

export type ClassifiedDeploymentRow = DeploymentAttemptInput & {
  operationalState: OperationalState;
  supersededById: string | null;
};

export type ProjectTruthSnapshot = {
  projectId: string;
  projectName: string;
  deployment: FacetTruth;
  verification: FacetTruth;
  overallState: OperationalState;
  evidence: TruthEvidenceRef[];
  nextAction: {
    facet: FacetTruth["facet"] | null;
    state: OperationalState | null;
    nextAction: string | null;
    evidenceCount: number;
  };
  currentFailures: ClassifiedDeploymentRow[];
  historicalFailures: ClassifiedDeploymentRow[];
  blockers: ProjectTruthBlocker[];
  openDecisions: ProjectTruthDecision[];
};

/** Failure/block take precedence; UNKNOWN does not erase independently verified production. */
const FAILURE_PRIORITY: OperationalState[] = ["BLOCKED", "FAILED"];
const PROGRESS_ORDER: OperationalState[] = [
  "PLANNED",
  "IMPLEMENTED_LOCALLY",
  "VERIFIED_LOCALLY",
  "DEPLOYED",
  "VERIFIED_IN_PRODUCTION",
];

export function deriveOverallOperationalState(facets: readonly FacetTruth[]): OperationalState {
  if (facets.length === 0) return "UNKNOWN";
  for (const state of FAILURE_PRIORITY) {
    if (facets.some((facet) => facet.state === state)) return state;
  }
  let best: OperationalState | null = null;
  let bestRank = -1;
  for (const facet of facets) {
    const rank = PROGRESS_ORDER.indexOf(facet.state);
    if (rank > bestRank) {
      best = facet.state;
      bestRank = rank;
    }
  }
  return best ?? "UNKNOWN";
}

export function assembleProjectTruthSnapshot(input: {
  projectId: string;
  projectName: string;
  attempts: readonly DeploymentAttemptInput[];
  releaseStatus?: string | null;
  productionVerified?: boolean | null;
  hasFreshInspectorPass?: boolean | null;
  legacyVerifiedRecord?: boolean | null;
  openBlockingDefects?: number;
  blockers?: readonly ProjectTruthBlocker[];
  openDecisions?: readonly ProjectTruthDecision[];
}): ProjectTruthSnapshot {
  const projectAttempts = input.attempts.filter((row) => row.projectId === input.projectId);
  const classified = classifyDeploymentAttemptStatuses(projectAttempts);

  const deployment = reconcileDeploymentFacet({
    projectId: input.projectId,
    attempts: projectAttempts,
    releaseStatus: input.releaseStatus,
    productionVerified: input.productionVerified,
  });

  const verification = reconcileLocalVerificationFacet({
    projectId: input.projectId,
    hasFreshInspectorPass: input.hasFreshInspectorPass ?? null,
    legacyVerifiedRecord: input.legacyVerifiedRecord ?? null,
    openBlockingDefects: input.openBlockingDefects ?? 0,
  });

  const blockers = [...(input.blockers ?? [])];
  const openDecisions = [...(input.openDecisions ?? [])];

  const statusFacets: FacetTruth[] = [deployment, verification];
  if (blockers.length > 0) {
    statusFacets.unshift({
      facet: "execution",
      state: "BLOCKED",
      summary: `${blockers.length} open blocker(s).`,
      evidence: blockers.slice(0, 4).map((blocker) => ({
        source: "blockers",
        at: blocker.at,
        projectId: input.projectId,
        environment: "UNKNOWN" as const,
        reference: blocker.id,
      })),
      nextAction: "Resolve open blockers before claiming progress.",
    });
  }

  // Decisions affect next action priority, not invented operational success.
  const actionFacets: FacetTruth[] = [...statusFacets];
  if (openDecisions.length > 0) {
    actionFacets.unshift({
      facet: "execution",
      state: "UNKNOWN",
      summary: `${openDecisions.length} founder decision(s) open.`,
      evidence: openDecisions.slice(0, 4).map((decision) => ({
        source: "project_decisions",
        at: decision.at,
        projectId: input.projectId,
        environment: "UNKNOWN",
        reference: decision.id,
      })),
      nextAction: "Resolve the open founder decision before advancing consequential work.",
    });
  }

  const evidence = [...deployment.evidence, ...verification.evidence];

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    deployment,
    verification,
    overallState: deriveOverallOperationalState(statusFacets),
    evidence,
    nextAction: nextHighestPriorityAction(actionFacets),
    currentFailures: classified.filter((row) => row.operationalState === "FAILED"),
    historicalFailures: classified.filter((row) => row.operationalState === "SUPERSEDED"),
    blockers,
    openDecisions,
  };
}
