/**
 * Pilot 02 — durable supervised execution task contract.
 * Car rental sample is a predefined Cursor-prepared fixture, not Ghost-generated.
 */

export const PILOT_02_ID = "pilot-02-validate-car-rental" as const;

export const PILOT_02_TITLE = "Validate Car Rental Landing Page";

export const PILOT_02_OBJECTIVE =
  "Validate the previously prepared car rental sample using a restricted Docker runner and return the actual validation results to the founder.";

export const PILOT_02_ACTION_TYPE = "agent_task.develop" as const;
export const PILOT_02_AUTHORIZATION_KIND = "DEVELOPMENT" as const;
export const PILOT_02_ENVIRONMENT = "LOCAL_PILOT" as const;
export const PILOT_02_REUSE = "ONE_TIME" as const;

export const PILOT_02_FIXTURE_RELATIVE = ".ghost/pilot-fixtures/car-rental-validate" as const;

export const PILOT_02_SOURCE_ATTRIBUTION = {
  carRentalSample: "CURSOR_PREPARED",
  validationFixture: "GHOST_RESTRICTED_RUNNER",
  autonomousCodeGeneration: "NOT_IMPLEMENTED",
} as const;

/** Conceptual lifecycle → existing schema mapping */
export const PILOT_02_STATE_MAP = {
  Requested: "remote_development_tasks.status=AWAITING_APPROVAL + founder_action_authorizations.status=PENDING",
  AwaitingApproval: "AWAITING_APPROVAL / PENDING",
  Approved: "APPROVED (founder transition only)",
  Queued: "QUEUED after ONE_TIME consume + agent_tasks bind",
  Claimed: "agent_tasks.status=RUNNING with lease",
  Running: "RUNNING",
  CompletedOrFailed: "SUCCEEDED | FAILED",
  AwaitingFounderReview: "AWAITING_FOUNDER_REVIEW",
} as const;
