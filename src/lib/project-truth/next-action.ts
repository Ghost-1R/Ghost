import type { FacetTruth, OperationalState } from "./types";

const STATE_URGENCY: Record<OperationalState, number> = {
  BLOCKED: 0,
  FAILED: 1,
  UNKNOWN: 2,
  PLANNED: 3,
  IMPLEMENTED_LOCALLY: 4,
  VERIFIED_LOCALLY: 5,
  DEPLOYED: 6,
  VERIFIED_IN_PRODUCTION: 7,
  SUPERSEDED: 8,
};

/**
 * Pick the highest-priority next action across facet truths.
 * Does not invent work when every facet is healthy or has no nextAction.
 */
export function nextHighestPriorityAction(facets: readonly FacetTruth[]): {
  facet: FacetTruth["facet"] | null;
  state: OperationalState | null;
  nextAction: string | null;
  evidenceCount: number;
} {
  const actionable = facets
    .filter((facet) => facet.nextAction != null && facet.nextAction.trim().length > 0)
    .sort((a, b) => STATE_URGENCY[a.state] - STATE_URGENCY[b.state]);

  const top = actionable[0];
  if (!top) {
    return { facet: null, state: null, nextAction: null, evidenceCount: 0 };
  }
  return {
    facet: top.facet,
    state: top.state,
    nextAction: top.nextAction,
    evidenceCount: top.evidence.length,
  };
}
