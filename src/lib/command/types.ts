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
  title: string;
  valueLabel: string;
  score: number | null;
  geography: string;
  status: string;
  source: string;
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
  opportunities: CommandOpportunity[];
  opportunityBlocker: string | null;
  finance: CommandFinanceSummary;
  decisionsPending: Array<{ id: string; title: string; href: string }>;
  activeProjects: number;
  companyFilterId: string | null;
  underworldHref: string;
  briefing: Array<{ id: string; title: string; next: string; href: string }>;
};
