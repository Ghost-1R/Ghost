/**
 * Operations experience map (Build 09.0) — reuse, do not duplicate.
 *
 * Questions → existing surfaces (real data only):
 * 1. What is true right now?     → CEO health + Project Truth facets + Inspector
 * 2. What changed?               → /operations activity + deployment/release history
 * 3. What is blocked?            → CEO blockers/defects + operating_actions BLOCKED
 * 4. What needs founder approval?→ decisions + TodayAction.requiresDecision
 * 5. What should Ghost do next?  → prioritizeTodayActions + nextHighestPriorityAction
 * 6. What evidence supports it?  → FacetTruth.evidence + CEO signal detail/href
 *
 * Build 09.1 may unify these into one Operations page. No decorative controls here.
 */

export const OPERATIONS_SURFACE_QUESTIONS = [
  "WHAT_IS_TRUE_NOW",
  "WHAT_CHANGED",
  "WHAT_IS_BLOCKED",
  "WHAT_NEEDS_FOUNDER_APPROVAL",
  "WHAT_SHOULD_GHOST_DO_NEXT",
  "WHAT_EVIDENCE_SUPPORTS",
] as const;

export type OperationsSurfaceQuestion = (typeof OPERATIONS_SURFACE_QUESTIONS)[number];
