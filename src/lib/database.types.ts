import type {
  ActionStatus,
  BlockerStatus,
  FounderRuleStatus,
  KnowledgeKind,
  MemoryProposalStatus,
  MemoryScope,
  ProjectStatus,
  VerificationCategory,
  VerificationState,
} from "@/lib/domain/status";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row extends Record<string, unknown>, Insert extends Record<string, unknown>> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        {
          id: string;
          display_name: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id: string;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      companies: Table<
        {
          id: string;
          owner_id: string;
          name: string;
          slug: string;
          description: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          owner_id: string;
          name: string;
          slug: string;
          description?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      projects: Table<
        {
          id: string;
          company_id: string;
          name: string;
          slug: string;
          description: string;
          current_milestone: string;
          status: ProjectStatus;
          repository_url: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          company_id: string;
          name: string;
          slug: string;
          description?: string;
          current_milestone?: string;
          status?: ProjectStatus;
          repository_url?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      project_knowledge: Table<
        {
          id: string;
          project_id: string;
          kind: KnowledgeKind;
          title: string;
          content: string;
          source: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          project_id: string;
          kind: KnowledgeKind;
          title: string;
          content: string;
          source?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      founder_rules: Table<
        {
          id: string;
          owner_id: string;
          title: string;
          content: string;
          origin_project_id: string | null;
          provenance: string;
          status: FounderRuleStatus;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          owner_id: string;
          title: string;
          content: string;
          origin_project_id?: string | null;
          provenance: string;
          status?: FounderRuleStatus;
          approved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      milestones: Table<
        {
          id: string;
          project_id: string;
          title: string;
          description: string;
          status: ProjectStatus;
          position: number;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          project_id: string;
          title: string;
          description?: string;
          status?: ProjectStatus;
          position?: number;
          created_at?: string;
          updated_at?: string;
        }
      >;
      blockers: Table<
        {
          id: string;
          project_id: string;
          milestone_id: string | null;
          title: string;
          description: string;
          status: BlockerStatus;
          created_at: string;
          resolved_at: string | null;
        },
        {
          id?: string;
          project_id: string;
          milestone_id?: string | null;
          title: string;
          description?: string;
          status?: BlockerStatus;
          created_at?: string;
          resolved_at?: string | null;
        }
      >;
      next_actions: Table<
        {
          id: string;
          project_id: string;
          milestone_id: string | null;
          title: string;
          description: string;
          status: ActionStatus;
          position: number;
          created_at: string;
          completed_at: string | null;
        },
        {
          id?: string;
          project_id: string;
          milestone_id?: string | null;
          title: string;
          description?: string;
          status?: ActionStatus;
          position?: number;
          created_at?: string;
          completed_at?: string | null;
        }
      >;
      verification_records: Table<
        {
          id: string;
          project_id: string;
          category: VerificationCategory;
          target: string;
          state: VerificationState;
          evidence: Json;
          checked_at: string | null;
          created_at: string;
        },
        {
          id?: string;
          project_id: string;
          category: VerificationCategory;
          target: string;
          state?: VerificationState;
          evidence?: Json;
          checked_at?: string | null;
          created_at?: string;
        }
      >;
      memory_proposals: Table<
        {
          id: string;
          owner_id: string;
          project_id: string | null;
          proposed_scope: MemoryScope;
          title: string;
          content: string;
          provenance: string;
          status: MemoryProposalStatus;
          created_at: string;
          reviewed_at: string | null;
        },
        {
          id?: string;
          owner_id: string;
          project_id?: string | null;
          proposed_scope: MemoryScope;
          title: string;
          content: string;
          provenance: string;
          status?: MemoryProposalStatus;
          created_at?: string;
          reviewed_at?: string | null;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      review_memory_proposal: {
        Args: {
          proposal_id: string;
          decision: ReviewDecisionArg;
        };
        Returns: undefined;
      };
      retire_founder_rule: {
        Args: {
          rule_id: string;
        };
        Returns: undefined;
      };
    };
  };
};

type ReviewDecisionArg = "APPROVED" | "REJECTED" | "PROJECT_ONLY" | "PENDING";
