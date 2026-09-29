export const AUTHORITY_ORDER = [
  "SYSTEM",
  "VERIFIED_EVIDENCE",
  "FOUNDER_RULE",
  "PROJECT_DECISION",
  "PROJECT_REQUIREMENT",
  "PROJECT_STATE",
  "PROJECT_NOTE",
  "REPOSITORY_EVIDENCE",
  "CONVERSATION_CLAIM",
] as const;

export type Authority = (typeof AUTHORITY_ORDER)[number];

export type ContextItem = {
  id: string;
  type: string;
  authority: Authority;
  sourceTable: string;
  sourceId: string;
  projectId: string | null;
  title: string;
  content: string;
  status: string | null;
  relevance: number;
  keep: boolean;
  selectedBecause: string;
};

export type SourceRef = {
  id: string;
  type: string;
  title: string;
  status?: string | null;
};

export type ProjectName = {
  id: string;
  name: string;
};
