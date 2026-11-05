export type CommandHealthState = "healthy" | "degraded" | "disconnected" | "unknown";

export type CommandConnection = {
  id: string;
  label: string;
  state: CommandHealthState;
  detail: string;
  checkedAt: string;
  href?: string;
};

export type CommandKpi = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "good" | "warn" | "critical" | "gold";
  href?: string;
  trendLabel?: string | null;
};

export type CommandCompanyPulse = {
  id: string;
  name: string;
  slug: string;
  projectCount: number;
  openTasks: number;
  memberCount: number;
  healthLabel: string;
  healthTone: "good" | "warn" | "critical" | "unknown";
  href: string;
};

export type CommandAlert = {
  id: string;
  severity: "critical" | "win" | "attention" | "info";
  title: string;
  detail: string;
  at: string | null;
  href: string;
  companyName?: string;
  projectId?: string | null;
  companyId?: string | null;
};

export type CommandTaskColumn = {
  id: "todo" | "progress" | "review" | "done" | "blocked";
  label: string;
  items: Array<{
    id: string;
    title: string;
    meta: string;
    href: string;
    progress?: number | null;
  }>;
};

export type CommandOpportunity = {
  id: string;
  companyId: string;
  title: string;
  valueLabel: string;
  score: number | null;
  geography: string;
  status: string;
  source: string;
  sourceUrl: string;
  contactEmail: string;
  outreachStage:
    | "new"
    | "waiting"
    | "queued"
    | "sending"
    | "sent"
    | "delivered"
    | "bounced"
    | "needs_attention"
    | "replied"
    | "won"
    | "closed";
  serviceInterest: "" | "website" | "app" | "ads" | "wholesale";
  industry: string;
  market: string;
  fitReason: string;
  followUpOn: string | null;
  sentAt: string | null;
  isMock: boolean;
  discoveredByWorker: string;
  evidenceSignal: string;
  outreachDraft: string;
  outreachSubject: string;
  outreachMessageId: string | null;
  doNotContact: boolean;
  /** True when a public email exists but no opt-in/documented request covers the send scope. */
  needsPermission: boolean;
  eligibility: Array<{
    id: string;
    kind: "opt_in" | "documented_request";
    source: string;
    scope: string;
    recordedAt: string;
  }>;
  href: string;
};

export type CommandFinanceSummary = {
  cashCollectedLabel: string;
  invoicedLabel: string;
  profitLabel: string;
  detail: string;
  connected: boolean;
  href: string;
};

export type CommandBoard = {
  greeting: string;
  founderName: string;
  checkedAt: string;
  systemHealth: CommandConnection;
  connections: CommandConnection[];
  kpis: CommandKpi[];
  companies: CommandCompanyPulse[];
  alerts: CommandAlert[];
  taskBoard: CommandTaskColumn[];
  myTasks: Array<{ id: string; title: string; priority: string; href: string; done: boolean }>;
  workforce: {
    human: number;
    aiRegistered: number;
    aiOnShift: number;
    aiExecuting: number;
    detail: string;
  };
  shifts: {
    withinDefaultWindow: boolean;
    timezone: string;
    aiActive: number;
    nextHandoverLabel: string;
    href: string;
  };
  leadWorkers: import("@/lib/lead-workers/types").LeadWorkerBoardState;
  outreachWorker: import("@/lib/outreach-worker/types").OutreachBoardState;
  opportunities: CommandOpportunity[];
  opportunityBlocker: string | null;
  finance: CommandFinanceSummary;
  decisionsPending: Array<{ id: string; title: string; href: string }>;
  activeProjects: number;
  companyFilterId: string | null;
  underworldHref: string;
  briefing: Array<{ id: string; title: string; next: string; href: string }>;
  workMode: "desk" | "home" | "gym" | "entertainment" | "field";
  inboxUnread: number;
  projectsForConvert: Array<{ id: string; name: string; companyId: string }>;
};
