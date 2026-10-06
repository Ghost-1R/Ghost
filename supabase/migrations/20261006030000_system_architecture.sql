-- Ghost V7 System Architecture.
-- Technical blueprint for a BUILD_READY Product Architecture.
-- Design only - does not implement, migrate, or deploy target products.
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.system_architecture_status as enum (
  'DRAFT',
  'DESIGNING',
  'REVIEW',
  'APPROVED',
  'ARCHITECTURE_READY'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.system_component_type as enum (
  'WEB_APPLICATION',
  'API_SERVER',
  'DATABASE',
  'AUTH',
  'STORAGE',
  'BACKGROUND_WORKER',
  'AI_PROVIDER',
  'PAYMENT_PROVIDER',
  'EMAIL',
  'EXTERNAL_INTEGRATION',
  'OTHER'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.system_record_status as enum (
  'PROPOSED',
  'APPROVED',
  'REJECTED',
  'RETIRED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.relationship_cardinality as enum (
  'ONE_TO_ONE',
  'ONE_TO_MANY',
  'MANY_TO_MANY'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.coverage_status as enum (
  'COVERED',
  'PARTIALLY_COVERED',
  'NOT_COVERED',
  'NOT_APPLICABLE'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sensitive_class as enum (
  'NONE',
  'PII',
  'SECRET',
  'FINANCIAL',
  'HEALTH',
  'CREDENTIAL'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.config_classification as enum (
  'PUBLIC',
  'SERVER_SECRET',
  'DATABASE',
  'PROVIDER',
  'RUNTIME'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.tech_risk_severity as enum (
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.system_question_status as enum (
  'OPEN',
  'ESCALATED',
  'RESOLVED',
  'CLOSED'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Root architecture + append-only history
-- ---------------------------------------------------------------------------

create table if not exists public.system_architectures (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  product_architecture_id uuid not null references public.product_architectures (id) on delete restrict,
  summary text not null default '',
  auth_summary text not null default '',
  authorization_summary text not null default '',
  runtime_topology jsonb not null default '[]'::jsonb,
  status public.system_architecture_status not null default 'DRAFT',
  note text not null default '',
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint system_architectures_one_per_project unique (project_id),
  constraint system_architectures_summary_length check (char_length(summary) <= 8000),
  constraint system_architectures_auth_length check (char_length(auth_summary) <= 4000),
  constraint system_architectures_authz_length check (char_length(authorization_summary) <= 4000),
  constraint system_architectures_note_length check (char_length(note) <= 4000)
);

create index if not exists system_architectures_product_idx on public.system_architectures (product_architecture_id);
create index if not exists system_architectures_status_idx on public.system_architectures (status, updated_at desc);

comment on table public.system_architectures is
  'Authoritative System Architecture for a project. Proposed design is not implementation or deployment.';

create table if not exists public.system_architecture_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  from_status public.system_architecture_status,
  to_status public.system_architecture_status not null,
  changed_at timestamptz not null default pg_catalog.now(),
  changed_by uuid references auth.users (id) on delete set null,
  actor public.product_actor not null default 'FOUNDER',
  reason text not null,
  constraint system_architecture_transitions_reason_present check (char_length(trim(reason)) between 1 and 2000)
);

create index if not exists system_architecture_transitions_arch_idx
  on public.system_architecture_transitions (architecture_id, changed_at desc);

create or replace function private.guard_system_architecture_transition_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'system architecture transitions are append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists system_architecture_transitions_no_update on public.system_architecture_transitions;
create trigger system_architecture_transitions_no_update
  before update on public.system_architecture_transitions
  for each row execute function private.guard_system_architecture_transition_immutable();

drop trigger if exists system_architecture_transitions_no_delete on public.system_architecture_transitions;
create trigger system_architecture_transitions_no_delete
  before delete on public.system_architecture_transitions
  for each row execute function private.guard_system_architecture_transition_immutable();

-- ---------------------------------------------------------------------------
-- Components
-- ---------------------------------------------------------------------------

create table if not exists public.system_components (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  name text not null,
  purpose text not null default '',
  component_type public.system_component_type not null default 'OTHER',
  responsibilities jsonb not null default '[]'::jsonb,
  dependency_refs jsonb not null default '[]'::jsonb,
  status public.system_record_status not null default 'PROPOSED',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint system_components_human_id_format check (human_id ~ '^COMP-[0-9]{3,}$'),
  constraint system_components_human_unique unique (architecture_id, human_id),
  constraint system_components_name_present check (char_length(trim(name)) between 1 and 200),
  constraint system_components_purpose_length check (char_length(purpose) <= 4000)
);

create index if not exists system_components_arch_idx on public.system_components (architecture_id, status);

create table if not exists public.system_component_requirements (
  component_id uuid not null references public.system_components (id) on delete cascade,
  requirement_id uuid not null references public.product_requirements (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (component_id, requirement_id)
);

-- ---------------------------------------------------------------------------
-- Database entities, fields, relationships
-- ---------------------------------------------------------------------------

create table if not exists public.system_entities (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  name text not null,
  purpose text not null default '',
  ownership_field text not null default '',
  rls_expectation text not null default '',
  retention_note text not null default '',
  sensitive_class public.sensitive_class not null default 'NONE',
  status public.system_record_status not null default 'PROPOSED',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint system_entities_human_id_format check (human_id ~ '^ENT-[0-9]{3,}$'),
  constraint system_entities_human_unique unique (architecture_id, human_id),
  constraint system_entities_name_present check (char_length(trim(name)) between 1 and 120)
);

create index if not exists system_entities_arch_idx on public.system_entities (architecture_id, status);

create table if not exists public.system_entity_fields (
  id uuid primary key default extensions.gen_random_uuid(),
  entity_id uuid not null references public.system_entities (id) on delete cascade,
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  data_type text not null default 'text',
  nullable boolean not null default true,
  default_value text not null default '',
  is_pk boolean not null default false,
  is_unique boolean not null default false,
  is_fk boolean not null default false,
  references_entity_id uuid references public.system_entities (id) on delete set null,
  sensitive_class public.sensitive_class not null default 'NONE',
  note text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  constraint system_entity_fields_name_present check (char_length(trim(name)) between 1 and 120),
  constraint system_entity_fields_unique_name unique (entity_id, name)
);

create index if not exists system_entity_fields_entity_idx on public.system_entity_fields (entity_id, position);

create table if not exists public.system_relationships (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  source_entity_id uuid not null references public.system_entities (id) on delete cascade,
  target_entity_id uuid not null references public.system_entities (id) on delete cascade,
  cardinality public.relationship_cardinality not null,
  fk_strategy text not null default '',
  delete_behavior text not null default '',
  rationale text not null default '',
  junction_strategy text not null default '',
  status public.system_record_status not null default 'PROPOSED',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  constraint system_relationships_human_id_format check (human_id ~ '^REL-[0-9]{3,}$'),
  constraint system_relationships_human_unique unique (architecture_id, human_id),
  constraint system_relationships_rationale_length check (char_length(rationale) <= 4000)
);

create index if not exists system_relationships_arch_idx on public.system_relationships (architecture_id);

-- ---------------------------------------------------------------------------
-- Interfaces, flows, integrations, config
-- ---------------------------------------------------------------------------

create table if not exists public.system_interfaces (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  name text not null,
  purpose text not null default '',
  caller text not null default '',
  receiver text not null default '',
  operation text not null default '',
  input_shape jsonb not null default '{}'::jsonb,
  output_shape jsonb not null default '{}'::jsonb,
  auth_required boolean not null default true,
  failure_behavior text not null default '',
  status public.system_record_status not null default 'PROPOSED',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint system_interfaces_human_id_format check (human_id ~ '^API-[0-9]{3,}$'),
  constraint system_interfaces_human_unique unique (architecture_id, human_id),
  constraint system_interfaces_name_present check (char_length(trim(name)) between 1 and 200)
);

create index if not exists system_interfaces_arch_idx on public.system_interfaces (architecture_id, status);

create table if not exists public.system_interface_requirements (
  interface_id uuid not null references public.system_interfaces (id) on delete cascade,
  requirement_id uuid not null references public.product_requirements (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (interface_id, requirement_id)
);

create table if not exists public.system_data_flows (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  name text not null,
  source_label text not null default '',
  process_label text not null default '',
  storage_label text not null default '',
  result_label text not null default '',
  steps jsonb not null default '[]'::jsonb,
  component_refs jsonb not null default '[]'::jsonb,
  status public.system_record_status not null default 'PROPOSED',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  constraint system_data_flows_human_id_format check (human_id ~ '^DFLOW-[0-9]{3,}$'),
  constraint system_data_flows_human_unique unique (architecture_id, human_id),
  constraint system_data_flows_name_present check (char_length(trim(name)) between 1 and 200)
);

create index if not exists system_data_flows_arch_idx on public.system_data_flows (architecture_id);

create table if not exists public.system_integrations (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  provider text not null,
  purpose text not null default '',
  required boolean not null default true,
  data_exchanged jsonb not null default '[]'::jsonb,
  secret_names jsonb not null default '[]'::jsonb,
  failure_impact text not null default '',
  fallback_behavior text not null default '',
  cost_note text not null default '',
  status public.system_record_status not null default 'PROPOSED',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  constraint system_integrations_human_id_format check (human_id ~ '^INTG-[0-9]{3,}$'),
  constraint system_integrations_human_unique unique (architecture_id, human_id),
  constraint system_integrations_provider_present check (char_length(trim(provider)) between 1 and 200)
);

create index if not exists system_integrations_arch_idx on public.system_integrations (architecture_id);

create table if not exists public.system_env_configs (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  variable_name text not null,
  purpose text not null default '',
  classification public.config_classification not null default 'SERVER_SECRET',
  required_environments jsonb not null default '["production"]'::jsonb,
  status public.system_record_status not null default 'PROPOSED',
  created_at timestamptz not null default pg_catalog.now(),
  constraint system_env_configs_name_present check (char_length(trim(variable_name)) between 1 and 200),
  constraint system_env_configs_unique unique (architecture_id, variable_name),
  constraint system_env_configs_no_value_like check (variable_name !~* '(sk-|gsk_|eyJ)')
);

-- ---------------------------------------------------------------------------
-- Risks, constraints, coverage, questions
-- ---------------------------------------------------------------------------

create table if not exists public.system_technical_risks (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  description text not null,
  severity public.tech_risk_severity not null default 'MEDIUM',
  likelihood text not null default 'UNKNOWN',
  mitigation text not null default '',
  linked_component_refs jsonb not null default '[]'::jsonb,
  status public.system_record_status not null default 'PROPOSED',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  constraint system_technical_risks_human_id_format check (human_id ~ '^RISK-[0-9]{3,}$'),
  constraint system_technical_risks_human_unique unique (architecture_id, human_id),
  constraint system_technical_risks_description_present check (char_length(trim(description)) between 1 and 2000)
);

create index if not exists system_technical_risks_arch_idx on public.system_technical_risks (architecture_id, severity);

create table if not exists public.system_technical_constraints (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  statement text not null,
  constraint_source text not null default 'founder',
  authoritative boolean not null default false,
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  constraint system_technical_constraints_statement_present check (char_length(trim(statement)) between 1 and 2000)
);

create table if not exists public.system_requirement_coverage (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  requirement_id uuid not null references public.product_requirements (id) on delete cascade,
  coverage public.coverage_status not null default 'NOT_COVERED',
  supporting_refs jsonb not null default '[]'::jsonb,
  gap_note text not null default '',
  updated_at timestamptz not null default pg_catalog.now(),
  constraint system_requirement_coverage_unique unique (architecture_id, requirement_id)
);

create index if not exists system_requirement_coverage_arch_idx
  on public.system_requirement_coverage (architecture_id, coverage);

create table if not exists public.system_questions (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.system_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  question text not null,
  status public.system_question_status not null default 'OPEN',
  decision_id uuid references public.project_decisions (id) on delete set null,
  next_action_id uuid references public.next_actions (id) on delete set null,
  resolution text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint system_questions_question_present check (char_length(trim(question)) between 1 and 2000)
);

create index if not exists system_questions_arch_status_idx on public.system_questions (architecture_id, status);

alter table public.project_decisions
  add column if not exists system_architecture_id uuid references public.system_architectures (id) on delete set null;

create index if not exists project_decisions_system_architecture_idx
  on public.project_decisions (system_architecture_id)
  where system_architecture_id is not null;
