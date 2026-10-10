export {
  classifyDeploymentAttemptStatuses,
  isCurrentFailedDeployment,
  reconcileDeploymentFacet,
  reconcileLocalVerificationFacet,
} from "./reconcile";
export { nextHighestPriorityAction } from "./next-action";
export { loadProjectTruthSnapshot } from "./load";
export {
  assembleProjectTruthSnapshot,
  deriveOverallOperationalState,
  type ClassifiedDeploymentRow,
  type ProjectTruthBlocker,
  type ProjectTruthDecision,
  type ProjectTruthSnapshot,
} from "./snapshot";
export {
  formatEvidenceLine,
  operationalStateLabel,
  summarizeProjectTruth,
} from "./present";
export type {
  DeploymentAttemptInput,
  FacetTruth,
  OperationalEnvironment,
  OperationalState,
  TruthEvidenceRef,
} from "./types";
export {
  deploymentLineageMatches,
  OPERATIONAL_ENVIRONMENTS,
  OPERATIONAL_STATES,
} from "./types";
export { OPERATIONS_SURFACE_QUESTIONS, type OperationsSurfaceQuestion } from "./operations-surface";
