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

/** Insert shape: the listed keys are required, every other column is optional (has a database default). */
type DefaultedTable<Row extends Record<string, unknown>, Required extends keyof Row> = Table<
  Row,
  Pick<Row, Required> & Partial<Omit<Row, Required>>
>;

type SystemStatus = import("@/lib/system-architecture/types").SystemArchitectureStatus;
type SystemRecord = import("@/lib/system-architecture/types").SystemRecordStatus;
type SensitiveClassValue = import("@/lib/system-architecture/types").SensitiveClass;

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
          product_architecture_id: string | null;
          system_architecture_id: string | null;
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
          product_architecture_id?: string | null;
          system_architecture_id?: string | null;
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
      product_architectures: Table<
        {
          id: string;
          project_id: string;
          idea_id: string | null;
          strategy_id: string | null;
          what: string;
          why: string;
          who: string;
          outcome: string;
          non_goals: Json;
          assumptions: Json;
          risks: Json;
          constraints_json: Json;
          status: import("@/lib/product-architect/types").ProductArchitectureStatus;
          note: string;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          project_id: string;
          idea_id?: string | null;
          strategy_id?: string | null;
          what?: string;
          why?: string;
          who?: string;
          outcome?: string;
          non_goals?: Json;
          assumptions?: Json;
          risks?: Json;
          constraints_json?: Json;
          status?: import("@/lib/product-architect/types").ProductArchitectureStatus;
          note?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      product_architecture_transitions: Table<
        {
          id: string;
          architecture_id: string;
          from_status: import("@/lib/product-architect/types").ProductArchitectureStatus | null;
          to_status: import("@/lib/product-architect/types").ProductArchitectureStatus;
          changed_at: string;
          changed_by: string | null;
          actor: string;
          reason: string;
        },
        {
          id?: string;
          architecture_id: string;
          from_status?: import("@/lib/product-architect/types").ProductArchitectureStatus | null;
          to_status: import("@/lib/product-architect/types").ProductArchitectureStatus;
          changed_at?: string;
          changed_by?: string | null;
          actor?: string;
          reason: string;
        }
      >;
      product_requirements: Table<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          title: string;
          description: string;
          req_type: import("@/lib/product-architect/types").RequirementType;
          priority: import("@/lib/product-architect/types").ProductPriority;
          approval_status: import("@/lib/product-architect/types").RequirementApproval;
          acceptance_criteria: Json;
          source: string;
          provenance: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          title: string;
          description?: string;
          req_type?: import("@/lib/product-architect/types").RequirementType;
          priority?: import("@/lib/product-architect/types").ProductPriority;
          approval_status?: import("@/lib/product-architect/types").RequirementApproval;
          acceptance_criteria?: Json;
          source?: string;
          provenance?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      product_features: Table<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          name: string;
          purpose: string;
          priority: import("@/lib/product-architect/types").ProductPriority;
          status: import("@/lib/product-architect/types").FeatureStatus;
          acceptance_criteria: Json;
          source: string;
          provenance: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          name: string;
          purpose?: string;
          priority?: import("@/lib/product-architect/types").ProductPriority;
          status?: import("@/lib/product-architect/types").FeatureStatus;
          acceptance_criteria?: Json;
          source?: string;
          provenance?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      product_feature_requirements: Table<
        {
          feature_id: string;
          requirement_id: string;
          created_at: string;
        },
        {
          feature_id: string;
          requirement_id: string;
          created_at?: string;
        }
      >;
      product_flows: Table<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          name: string;
          actor: string;
          starting_condition: string;
          steps: Json;
          expected_outcome: string;
          edge_cases: Json;
          feature_id: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          name: string;
          actor?: string;
          starting_condition?: string;
          steps?: Json;
          expected_outcome?: string;
          edge_cases?: Json;
          feature_id?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      product_questions: Table<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          question: string;
          status: import("@/lib/product-architect/types").ProductQuestionStatus;
          decision_id: string | null;
          next_action_id: string | null;
          resolution: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          architecture_id: string;
          project_id: string;
          question: string;
          status?: import("@/lib/product-architect/types").ProductQuestionStatus;
          decision_id?: string | null;
          next_action_id?: string | null;
          resolution?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      product_dependencies: Table<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          from_kind: import("@/lib/product-architect/types").DependencyKind;
          from_ref: string;
          to_kind: import("@/lib/product-architect/types").DependencyKind;
          to_ref: string;
          status: import("@/lib/product-architect/types").DependencyStatus;
          note: string;
          created_at: string;
        },
        {
          id?: string;
          architecture_id: string;
          project_id: string;
          from_kind: import("@/lib/product-architect/types").DependencyKind;
          from_ref: string;
          to_kind: import("@/lib/product-architect/types").DependencyKind;
          to_ref: string;
          status?: import("@/lib/product-architect/types").DependencyStatus;
          note?: string;
          created_at?: string;
        }
      >;
      system_architectures: DefaultedTable<
        {
          id: string;
          project_id: string;
          product_architecture_id: string;
          summary: string;
          auth_summary: string;
          authorization_summary: string;
          runtime_topology: Json;
          status: SystemStatus;
          note: string;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          updated_at: string;
        },
        "project_id" | "product_architecture_id"
      >;
      system_architecture_transitions: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          from_status: SystemStatus | null;
          to_status: SystemStatus;
          changed_at: string;
          changed_by: string | null;
          actor: string;
          reason: string;
        },
        "architecture_id" | "to_status" | "reason"
      >;
      system_components: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          name: string;
          purpose: string;
          component_type: import("@/lib/system-architecture/types").SystemComponentType;
          responsibilities: Json;
          dependency_refs: Json;
          status: SystemRecord;
          source: string;
          provenance: string;
          created_at: string;
          updated_at: string;
        },
        "architecture_id" | "project_id" | "human_id" | "name"
      >;
      system_component_requirements: DefaultedTable<
        {
          component_id: string;
          requirement_id: string;
          created_at: string;
        },
        "component_id" | "requirement_id"
      >;
      system_entities: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          name: string;
          purpose: string;
          ownership_field: string;
          rls_expectation: string;
          retention_note: string;
          sensitive_class: SensitiveClassValue;
          status: SystemRecord;
          source: string;
          provenance: string;
          created_at: string;
          updated_at: string;
        },
        "architecture_id" | "project_id" | "human_id" | "name"
      >;
      system_entity_fields: DefaultedTable<
        {
          id: string;
          entity_id: string;
          architecture_id: string;
          project_id: string;
          name: string;
          data_type: string;
          nullable: boolean;
          default_value: string;
          is_pk: boolean;
          is_unique: boolean;
          is_fk: boolean;
          references_entity_id: string | null;
          sensitive_class: SensitiveClassValue;
          note: string;
          position: number;
          created_at: string;
        },
        "entity_id" | "architecture_id" | "project_id" | "name"
      >;
      system_relationships: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          source_entity_id: string;
          target_entity_id: string;
          cardinality: import("@/lib/system-architecture/types").RelationshipCardinality;
          fk_strategy: string;
          delete_behavior: string;
          rationale: string;
          junction_strategy: string;
          status: SystemRecord;
          source: string;
          provenance: string;
          created_at: string;
        },
        "architecture_id" | "project_id" | "human_id" | "source_entity_id" | "target_entity_id" | "cardinality"
      >;
      system_interfaces: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          name: string;
          purpose: string;
          caller: string;
          receiver: string;
          operation: string;
          input_shape: Json;
          output_shape: Json;
          auth_required: boolean;
          failure_behavior: string;
          status: SystemRecord;
          source: string;
          provenance: string;
          created_at: string;
          updated_at: string;
        },
        "architecture_id" | "project_id" | "human_id" | "name"
      >;
      system_interface_requirements: DefaultedTable<
        {
          interface_id: string;
          requirement_id: string;
          created_at: string;
        },
        "interface_id" | "requirement_id"
      >;
      system_data_flows: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          name: string;
          source_label: string;
          process_label: string;
          storage_label: string;
          result_label: string;
          steps: Json;
          component_refs: Json;
          status: SystemRecord;
          source: string;
          provenance: string;
          created_at: string;
        },
        "architecture_id" | "project_id" | "human_id" | "name"
      >;
      system_integrations: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          provider: string;
          purpose: string;
          required: boolean;
          data_exchanged: Json;
          secret_names: Json;
          failure_impact: string;
          fallback_behavior: string;
          cost_note: string;
          status: SystemRecord;
          source: string;
          provenance: string;
          created_at: string;
        },
        "architecture_id" | "project_id" | "human_id" | "provider"
      >;
      system_env_configs: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          variable_name: string;
          purpose: string;
          classification: import("@/lib/system-architecture/types").ConfigClassification;
          required_environments: Json;
          status: SystemRecord;
          created_at: string;
        },
        "architecture_id" | "project_id" | "variable_name"
      >;
      system_technical_risks: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          human_id: string;
          description: string;
          severity: import("@/lib/system-architecture/types").TechRiskSeverity;
          likelihood: string;
          mitigation: string;
          linked_component_refs: Json;
          status: SystemRecord;
          source: string;
          provenance: string;
          created_at: string;
        },
        "architecture_id" | "project_id" | "human_id" | "description"
      >;
      system_technical_constraints: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          statement: string;
          constraint_source: string;
          authoritative: boolean;
          provenance: string;
          created_at: string;
        },
        "architecture_id" | "project_id" | "statement"
      >;
      system_requirement_coverage: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          requirement_id: string;
          coverage: import("@/lib/system-architecture/types").CoverageStatus;
          supporting_refs: Json;
          gap_note: string;
          updated_at: string;
        },
        "architecture_id" | "project_id" | "requirement_id"
      >;
      system_questions: DefaultedTable<
        {
          id: string;
          architecture_id: string;
          project_id: string;
          question: string;
          status: import("@/lib/system-architecture/types").SystemQuestionStatus;
          decision_id: string | null;
          next_action_id: string | null;
          resolution: string;
          created_at: string;
          updated_at: string;
        },
        "architecture_id" | "project_id" | "question"
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
      record_product_architecture_transition: {
        Args: {
          target_architecture_id: string;
          next_status: import("@/lib/product-architect/types").ProductArchitectureStatus;
          transition_reason: string;
          transition_actor?: string;
        };
        Returns: Database["public"]["Tables"]["product_architecture_transitions"]["Row"];
      };
      record_system_architecture_transition: {
        Args: {
          target_architecture_id: string;
          next_status: SystemStatus;
          transition_reason: string;
          transition_actor?: string;
        };
        Returns: Database["public"]["Tables"]["system_architecture_transitions"]["Row"];
      };
    };
  };
};

type ReviewDecisionArg = "APPROVED" | "REJECTED" | "PROJECT_ONLY" | "PENDING";
