import type {
  ActionPriority,
  ActionProvenance,
  ActionStatus,
  BlockerStatus,
  DecisionStatus,
  FounderRuleStatus,
  KnowledgeKind,
  LifecycleStage,
  MemoryProposalStatus,
  MemoryScope,
  ProjectStatus,
  VerificationCategory,
  VerificationState,
} from "@/lib/domain/status";
import type { IdeaEvidenceType, IdeaReadiness, IdeaStatus, ValidationStatus } from "@/lib/ideas/types";
import type { LifecycleActor } from "@/lib/lifecycle/stages";

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
          lifecycle_stage: LifecycleStage;
          repository_url: string | null;
          repository_provider: string | null;
          repository_branch: string | null;
          repository_commit: string | null;
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
          lifecycle_stage?: LifecycleStage;
          repository_url?: string | null;
          repository_provider?: string | null;
          repository_branch?: string | null;
          repository_commit?: string | null;
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
          priority: ActionPriority;
          provenance: ActionProvenance;
          source_kind: string;
          source_ref: string | null;
          requires_decision: boolean;
          decision_id: string | null;
          requirement_id: string | null;
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
          priority?: ActionPriority;
          provenance?: ActionProvenance;
          source_kind?: string;
          source_ref?: string | null;
          requires_decision?: boolean;
          decision_id?: string | null;
          requirement_id?: string | null;
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
      ghost_conversations: Table<
        {
          id: string;
          owner_id: string;
          project_id: string | null;
          title: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          owner_id: string;
          project_id?: string | null;
          title?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      ghost_messages: Table<
        {
          id: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          metadata: Json;
          created_at: string;
        },
        {
          id?: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          metadata?: Json;
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
      lifecycle_transitions: Table<
        {
          id: string;
          project_id: string;
          from_stage: LifecycleStage | null;
          to_stage: LifecycleStage;
          changed_at: string;
          changed_by: string | null;
          actor: LifecycleActor;
          reason: string;
          evidence_kind: string | null;
          evidence_id: string | null;
        },
        {
          id?: string;
          project_id: string;
          from_stage?: LifecycleStage | null;
          to_stage: LifecycleStage;
          changed_at?: string;
          changed_by?: string | null;
          actor: LifecycleActor;
          reason: string;
          evidence_kind?: string | null;
          evidence_id?: string | null;
        }
      >;
      project_decisions: Table<
        {
          id: string;
          project_id: string | null;
          idea_id: string | null;
          strategy_id: string | null;
          title: string;
          question: string;
          context: string;
          status: DecisionStatus;
          options: Json;
          recommendation: string | null;
          evidence: Json;
          created_at: string;
          created_by: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          selected_option: string | null;
          founder_response: string | null;
          rationale: string | null;
        },
        {
          id?: string;
          project_id?: string | null;
          idea_id?: string | null;
          strategy_id?: string | null;
          title: string;
          question: string;
          context?: string;
          status?: DecisionStatus;
          options?: Json;
          recommendation?: string | null;
          evidence?: Json;
          created_at?: string;
          created_by?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          selected_option?: string | null;
          founder_response?: string | null;
          rationale?: string | null;
        }
      >;
      ideas: Table<
        {
          id: string;
          owner_id: string;
          title: string;
          raw_idea: string;
          summary: string;
          problem: string;
          target_user: string;
          proposed_solution: string;
          value_proposition: string;
          assumptions: Json;
          risks: Json;
          opportunities: Json;
          constraints_json: Json;
          open_questions: Json;
          recommendation: string | null;
          status: IdeaStatus;
          readiness: IdeaReadiness;
          note: string;
          promoted_project_id: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          owner_id: string;
          title: string;
          raw_idea: string;
          summary?: string;
          problem?: string;
          target_user?: string;
          proposed_solution?: string;
          value_proposition?: string;
          assumptions?: Json;
          risks?: Json;
          opportunities?: Json;
          constraints_json?: Json;
          open_questions?: Json;
          recommendation?: string | null;
          status?: IdeaStatus;
          readiness?: IdeaReadiness;
          note?: string;
          promoted_project_id?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      idea_transitions: Table<
        {
          id: string;
          idea_id: string;
          from_status: IdeaStatus | null;
          to_status: IdeaStatus;
          changed_at: string;
          changed_by: string | null;
          actor: string;
          reason: string;
        },
        {
          id?: string;
          idea_id: string;
          from_status?: IdeaStatus | null;
          to_status: IdeaStatus;
          changed_at?: string;
          changed_by?: string | null;
          actor: string;
          reason: string;
        }
      >;
      idea_validations: Table<
        {
          id: string;
          idea_id: string;
          question: string;
          reason: string;
          evidence_needed: string;
          status: ValidationStatus;
          result: string;
          source: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          idea_id: string;
          question: string;
          reason?: string;
          evidence_needed?: string;
          status?: ValidationStatus;
          result?: string;
          source?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      idea_evidence: Table<
        {
          id: string;
          idea_id: string;
          evidence_type: IdeaEvidenceType;
          statement: string;
          source: string;
          confidence: string | null;
          provenance: string;
          observed_at: string | null;
          created_at: string;
          created_by: string | null;
        },
        {
          id?: string;
          idea_id: string;
          evidence_type: IdeaEvidenceType;
          statement: string;
          source?: string;
          confidence?: string | null;
          provenance?: string;
          observed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
        }
      >;
      idea_strategies: Table<
        {
          id: string;
          idea_id: string;
          vision: string;
          problem: string;
          target_customer: string;
          positioning: string;
          value_proposition: string;
          core_offer: string;
          differentiation: string;
          value_model: string;
          distribution: string;
          key_capabilities: Json;
          constraints_json: Json;
          risks: Json;
          assumptions: Json;
          success_measures: Json;
          non_goals: Json;
          initial_scope: string;
          mvp: string;
          not_building: string;
          open_decisions: Json;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          idea_id: string;
          vision?: string;
          problem?: string;
          target_customer?: string;
          positioning?: string;
          value_proposition?: string;
          core_offer?: string;
          differentiation?: string;
          value_model?: string;
          distribution?: string;
          key_capabilities?: Json;
          constraints_json?: Json;
          risks?: Json;
          assumptions?: Json;
          success_measures?: Json;
          non_goals?: Json;
          initial_scope?: string;
          mvp?: string;
          not_building?: string;
          open_decisions?: Json;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      project_repositories: Table<
        {
          id: string;
          project_id: string;
          provider: string;
          owner_login: string;
          repo_name: string;
          full_name: string;
          html_url: string;
          default_branch: string | null;
          is_primary: boolean;
          associated_at: string;
          associated_by: string | null;
        },
        {
          id?: string;
          project_id: string;
          provider?: string;
          owner_login: string;
          repo_name: string;
          full_name: string;
          html_url: string;
          default_branch?: string | null;
          is_primary?: boolean;
          associated_at?: string;
          associated_by?: string | null;
        }
      >;
      repository_observations: Table<
        {
          id: string;
          project_id: string;
          repository_id: string;
          observed_at: string;
          branch: string | null;
          commit_sha: string | null;
          commit_message: string | null;
          open_pull_requests: number | null;
          summary: string;
        },
        {
          id?: string;
          project_id: string;
          repository_id: string;
          observed_at?: string;
          branch?: string | null;
          commit_sha?: string | null;
          commit_message?: string | null;
          open_pull_requests?: number | null;
          summary?: string;
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
      record_lifecycle_transition: {
        Args: {
          target_project_id: string;
          next_stage: LifecycleStage;
          transition_reason: string;
          transition_actor?: LifecycleActor;
          evidence_kind?: string | null;
          evidence_id?: string | null;
        };
        Returns: Database["public"]["Tables"]["lifecycle_transitions"]["Row"];
      };
      resolve_project_decision: {
        Args: {
          target_decision_id: string;
          next_status: DecisionStatus;
          selected_option?: string | null;
          founder_response?: string | null;
          rationale?: string | null;
          follow_up_action_title?: string | null;
          follow_up_action_description?: string | null;
        };
        Returns: Database["public"]["Tables"]["project_decisions"]["Row"];
      };
      record_idea_transition: {
        Args: {
          target_idea_id: string;
          next_status: IdeaStatus;
          transition_reason: string;
          transition_actor?: string;
        };
        Returns: Database["public"]["Tables"]["idea_transitions"]["Row"];
      };
    };
  };
};

type ReviewDecisionArg = "APPROVED" | "REJECTED" | "PROJECT_ONLY" | "PENDING";
