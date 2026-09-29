export type BrainProject = {
  id: string;
  name: string;
  description: string;
  status: string;
  currentMilestone: string;
  repositoryProvider: string | null;
  repositoryUrl: string | null;
  repositoryBranch: string | null;
  repositoryCommit: string | null;
};

export type BrainProjectSummary = {
  id: string;
  name: string;
  status: string;
  currentMilestone: string;
  openBlockers: number;
  nextAction: string | null;
};

export type BrainMilestone = {
  title: string;
  status: string;
};

export type BrainText = {
  title: string;
  content: string;
};

export type BrainBlocker = {
  title: string;
  description: string;
  status: string;
};

export type BrainAction = {
  title: string;
  description: string;
  status: string;
  position: number;
};

export type BrainVerification = {
  category: string;
  target: string;
  state: string;
  evidence: unknown;
  checkedAt: string | null;
};

export type BrainRule = {
  id: string;
  title: string;
  content: string;
  status: string;
};

export type GhostContext = {
  scope: "project" | "global";
  project: BrainProject | null;
  projects: BrainProjectSummary[];
  milestone: BrainMilestone | null;
  requirements: BrainText[];
  decisions: BrainText[];
  constraints: BrainText[];
  blockers: BrainText[];
  nextActions: BrainText[];
  verification: Array<{
    category: string;
    target: string;
    state: string;
    supported: boolean;
    checkedAt: string | null;
  }>;
  founderRules: Array<{ id: string; title: string; content: string }>;
  truncated: boolean;
};

export type StateSnapshot = {
  milestone: string | null;
  status: string | null;
  production: string | null;
};

export type DriftField = {
  field: keyof StateSnapshot;
  repository: string | null;
  database: string | null;
};

export type DriftReport = {
  drifted: boolean;
  fields: DriftField[];
};
