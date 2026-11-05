export const LEAD_WORKER_SLUGS = ["will", "bubba"] as const;
export type LeadWorkerSlug = (typeof LEAD_WORKER_SLUGS)[number];

export type LeadWorkerRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "blocked";

export type LeadSearchCursor = {
  industryIdx: number;
  marketIdx: number;
  serviceIdx: number;
};

export type LeadWorkerCard = {
  slug: LeadWorkerSlug;
  displayName: string;
  colorHex: string;
  duty: "on" | "off";
  executing: boolean;
  lastSuccessfulRunAt: string | null;
  nextRunAt: string | null;
  leadsAddedTotal: number;
  lastBlocker: string | null;
  shiftLabel: string;
};

export type LeadWorkerBoardState = {
  configured: boolean;
  enabled: boolean;
  paused: boolean;
  schedulerAvailable: boolean;
  unavailableReason: string | null;
  companySlug: string;
  companyId: string | null;
  dailyBraveCap: number;
  braveRequestsToday: number;
  braveQuotaDay: string;
  industries: string[];
  markets: string[];
  services: string[];
  cursor: LeadSearchCursor;
  workers: LeadWorkerCard[];
  lastHandoffSummary: string | null;
};

export const DEFAULT_INDUSTRIES = [
  "driving schools",
  "independent car rentals",
  "painting remodeling companies",
] as const;

export const DEFAULT_MARKETS = [
  "Atlanta, GA",
  "Norcross, GA",
  "Marietta, GA",
  "Decatur, GA",
  "Alpharetta, GA",
] as const;

export const DEFAULT_SERVICES = ["website", "app", "ads"] as const;

export const DIRECTORY_HOSTS = new Set([
  "yelp.com",
  "www.yelp.com",
  "yellowpages.com",
  "www.yellowpages.com",
  "manta.com",
  "www.manta.com",
  "bbb.org",
  "www.bbb.org",
  "mapquest.com",
  "www.mapquest.com",
  "facebook.com",
  "www.facebook.com",
]);
