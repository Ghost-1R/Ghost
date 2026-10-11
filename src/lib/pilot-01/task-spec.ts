/**
 * Pilot 01 — supervised coding task specification (test-only).
 * Does not activate workers or dispatch live providers.
 */

export const PILOT_01_ID = "pilot-01-car-rental-landing" as const;

export const PILOT_01_OBJECTIVE =
  "Create a responsive car rental landing page containing a hero, three example vehicle cards, and a booking inquiry form with local validation.";

export const PILOT_01_ACTION_TYPE = "agent_task.develop" as const;
export const PILOT_01_AUTHORIZATION_KIND = "DEVELOPMENT" as const;
export const PILOT_01_ENVIRONMENT = "LOCAL_PILOT" as const;

/** Paths relative to repository root — disposable sample workspace only. */
export const PILOT_01_PERMITTED_FILES = [
  ".ghost/pilot-01/sample-workspace/car-rental-landing/index.html",
  ".ghost/pilot-01/sample-workspace/car-rental-landing/styles.css",
  ".ghost/pilot-01/sample-workspace/car-rental-landing/app.js",
  ".ghost/pilot-01/sample-workspace/car-rental-landing/README.md",
] as const;

export const PILOT_01_RESOURCE_LIMITS = {
  memoryBytes: 256 * 1024 * 1024,
  nanoCpus: 500_000_000,
  pidsLimit: 128,
  durationMs: 60_000,
  networkMode: "none",
  image: "node:22-alpine",
  user: "10001:10001",
} as const;

export const PILOT_01_PROHIBITIONS = [
  "real_customer_records",
  "credentials",
  "payments",
  "real_email_submission",
  "production_api_access",
  "hosted_supabase_writes",
  "general_agent_activation",
  "production_app_route_changes",
] as const;

export type Pilot01ReviewCriterion = {
  id: string;
  description: string;
};

export const PILOT_01_REVIEW_CRITERIA: Pilot01ReviewCriterion[] = [
  { id: "hero", description: "Hero section present with brand-forward title" },
  { id: "vehicles", description: "Exactly three example vehicle cards with dummy data" },
  { id: "form", description: "Booking inquiry form with local validation only" },
  { id: "scope", description: "Files confined to permitted sample workspace" },
  { id: "no_secrets", description: "No credentials, payments, or production APIs" },
  { id: "auth_gates", description: "DEVELOPMENT ONE_TIME authorization required before Ghost execution" },
  {
    id: "independent_verify",
    description: "Simulated success cannot become independently VERIFIED without founder review",
  },
];

export function buildPilot01ActionScope(repositoryRootLabel = "Ghost-1R/Ghost"): string {
  return [
    "pilot=01",
    `objective=${PILOT_01_OBJECTIVE}`,
    `repo=${repositoryRootLabel}`,
    `files=${PILOT_01_PERMITTED_FILES.join(",")}`,
    "payments=false",
    "email=false",
  ].join("|");
}
