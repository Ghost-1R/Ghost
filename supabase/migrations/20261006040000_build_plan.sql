-- Ghost V8 Build Plan.
-- Executable implementation blueprint for an ARCHITECTURE_READY System Architecture.
-- Planning only — does not implement, migrate, or deploy target products.
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.build_plan_status as enum (
    'DRAFT',
    'PLANNING',
    'REVIEW',
    'APPROVED',
    'BUILD_PLAN_READY'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.work_package_status as enum (
    'PLANNED',
    'READY',
    'BLOCKED',
    'IN_PROGRESS',
    'IMPLEMENTED',
    'VERIFIED',
    'DEPLOYED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.work_package_priority as enum (
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.dependency_edge_kind as enum (
    'DEPENDS_ON',
    'BLOCKS',
    'CAN_RUN_WITH'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.path_certainty as enum (
    'CONFIRMED_PATH',
    'EXPECTED_AREA',
    'UNKNOWN'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.architecture_link_kind as enum (
    'COMPONENT',
    'ENTITY',
    'INTERFACE',
    'DATA_FLOW',
    'INTEGRATION',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.verification_kind as enum (
    'UNIT',
    'INTEGRATION',
    'SECURITY',
    'RLS',
    'PROVIDER',
    'E2E',
    'RESPONSIVE',
    'BUILD',
    'PRODUCTION',
    'MANUAL'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.manual_action_status as enum (
    'REQUIRED',
    'NOT_REQUIRED',
    'PENDING',
    'DONE'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.build_risk_severity as enum (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Root build plan + append-only history
-- ---------------------------------------------------------------------------

create table if not exists public.build_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  product_architecture_id uuid not null references public.product_architectures (id) on delete restrict,
  system_architecture_id uuid not null references public.system_architectures (id) on delete restrict,
  summary text not null default '',
  deployment_sequence jsonb not null default '[]'::jsonb,
  rollback_summary text not null default '',
  status public.build_plan_status not null default 'DRAFT',
  note text not null default '',
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint build_plans_one_per_project unique (project_id),
  constraint build_plans_summary_length check (char_length(summary) <= 8000),
  constraint build_plans_rollback_length check (char_length(rollback_summary) <= 4000),
  constraint build_plans_note_length check (char_length(note) <= 4000)
);

create index if not exists build_plans_system_idx on public.build_plans (system_architecture_id);
create index if not exists build_plans_product_idx on public.build_plans (product_architecture_id);
create index if not exists build_plans_status_idx on public.build_plans (status, updated_at desc);

comment on table public.build_plans is
  'Authoritative Build Plan for a project. Planning only — not implementation or deployment.';

create table if not exists public.build_plan_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.build_plans (id) on delete cascade,
  from_status public.build_plan_status,
  to_status public.build_plan_status not null,
  changed_at timestamptz not null default pg_catalog.now(),
  changed_by uuid references auth.users (id) on delete set null,
  actor public.product_actor not null default 'FOUNDER',
  reason text not null,
  constraint build_plan_transitions_reason_present check (char_length(trim(reason)) between 1 and 2000)
);

create index if not exists build_plan_transitions_plan_idx
  on public.build_plan_transitions (plan_id, changed_at desc);

create or replace function private.guard_build_plan_transition_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'build plan transitions are append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists build_plan_transitions_no_update on public.build_plan_transitions;
create trigger build_plan_transitions_no_update
  before update on public.build_plan_transitions
  for each row execute function private.guard_build_plan_transition_immutable();

drop trigger if exists build_plan_transitions_no_delete on public.build_plan_transitions;
create trigger build_plan_transitions_no_delete
  before delete on public.build_plan_transitions
  for each row execute function private.guard_build_plan_transition_immutable();

-- ---------------------------------------------------------------------------
-- Phases
-- ---------------------------------------------------------------------------

create table if not exists public.build_phases (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.build_plans (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  name text not null,
  objective text not null default '',
  position integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint build_phases_human_id_format check (human_id ~ '^PHASE-[0-9]{3,}$'),
  constraint build_phases_human_unique unique (plan_id, human_id),
  constraint build_phases_name_present check (char_length(trim(name)) between 1 and 200),
  constraint build_phases_objective_length check (char_length(objective) <= 4000),
  constraint build_phases_note_length check (char_length(note) <= 2000)
);

create index if not exists build_phases_plan_idx on public.build_phases (plan_id, position, human_id);

-- ---------------------------------------------------------------------------
-- Work packages
-- ---------------------------------------------------------------------------

create table if not exists public.work_packages (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.build_plans (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  phase_id uuid references public.build_phases (id) on delete set null,
  human_id text not null,
  title text not null,
  objective text not null default '',
  description text not null default '',
  status public.work_package_status not null default 'PLANNED',
  priority public.work_package_priority not null default 'MEDIUM',
  likely_code_areas jsonb not null default '[]'::jsonb,
  path_certainty public.path_certainty not null default 'UNKNOWN',
  database_impact text not null default '',
  integration_impact text not null default '',
  security_impact text not null default '',
  definition_of_done jsonb not null default '[]'::jsonb,
  acceptance_criteria jsonb not null default '[]'::jsonb,
  rollback_consideration text not null default '',
  irreversible boolean not null default false,
  risk_note text not null default '',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint work_packages_human_id_format check (human_id ~ '^WP-[0-9]{3,}$'),
  constraint work_packages_human_unique unique (plan_id, human_id),
  constraint work_packages_title_present check (char_length(trim(title)) between 1 and 200),
  constraint work_packages_objective_length check (char_length(objective) <= 4000),
  constraint work_packages_description_length check (char_length(description) <= 8000),
  constraint work_packages_db_impact_length check (char_length(database_impact) <= 4000),
  constraint work_packages_integration_length check (char_length(integration_impact) <= 4000),
  constraint work_packages_security_length check (char_length(security_impact) <= 4000),
  constraint work_packages_rollback_length check (char_length(rollback_consideration) <= 4000),
  constraint work_packages_risk_length check (char_length(risk_note) <= 4000)
);

create index if not exists work_packages_plan_idx on public.work_packages (plan_id, human_id);
create index if not exists work_packages_phase_idx on public.work_packages (phase_id);
create index if not exists work_packages_status_idx on public.work_packages (plan_id, status);

-- ---------------------------------------------------------------------------
-- Dependencies
-- ---------------------------------------------------------------------------

create table if not exists public.work_package_dependencies (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.build_plans (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  from_package_id uuid not null references public.work_packages (id) on delete cascade,
  to_package_id uuid not null references public.work_packages (id) on delete cascade,
  edge_kind public.dependency_edge_kind not null default 'DEPENDS_ON',
  note text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  constraint work_package_dependencies_no_self check (from_package_id <> to_package_id),
  constraint work_package_dependencies_unique unique (from_package_id, to_package_id, edge_kind),
  constraint work_package_dependencies_note_length check (char_length(note) <= 2000)
);

create index if not exists work_package_dependencies_plan_idx on public.work_package_dependencies (plan_id);
create index if not exists work_package_dependencies_from_idx on public.work_package_dependencies (from_package_id);
create index if not exists work_package_dependencies_to_idx on public.work_package_dependencies (to_package_id);

-- ---------------------------------------------------------------------------
-- Coverage links
-- ---------------------------------------------------------------------------

create table if not exists public.work_package_requirement_links (
  work_package_id uuid not null references public.work_packages (id) on delete cascade,
  requirement_id uuid not null references public.product_requirements (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (work_package_id, requirement_id)
);

create table if not exists public.work_package_feature_links (
  work_package_id uuid not null references public.work_packages (id) on delete cascade,
  feature_id uuid not null references public.product_features (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (work_package_id, feature_id)
);

create table if not exists public.work_package_architecture_links (
  id uuid primary key default extensions.gen_random_uuid(),
  work_package_id uuid not null references public.work_packages (id) on delete cascade,
  plan_id uuid not null references public.build_plans (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  link_kind public.architecture_link_kind not null,
  record_ref text not null,
  note text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  constraint work_package_architecture_links_ref_present check (char_length(trim(record_ref)) between 1 and 200),
  constraint work_package_architecture_links_unique unique (work_package_id, link_kind, record_ref),
  constraint work_package_architecture_links_note_length check (char_length(note) <= 2000)
);

create index if not exists work_package_architecture_links_plan_idx
  on public.work_package_architecture_links (plan_id);

-- ---------------------------------------------------------------------------
-- Verification plans
-- ---------------------------------------------------------------------------

create table if not exists public.work_package_verifications (
  id uuid primary key default extensions.gen_random_uuid(),
  work_package_id uuid not null references public.work_packages (id) on delete cascade,
  plan_id uuid not null references public.build_plans (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.verification_kind not null,
  description text not null,
  observable_signal text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  constraint work_package_verifications_description_present check (char_length(trim(description)) between 1 and 2000),
  constraint work_package_verifications_signal_length check (char_length(observable_signal) <= 2000)
);

create index if not exists work_package_verifications_wp_idx
  on public.work_package_verifications (work_package_id, position);

-- ---------------------------------------------------------------------------
-- Manual actions, config names, risks
-- ---------------------------------------------------------------------------

create table if not exists public.build_manual_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.build_plans (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  work_package_id uuid references public.work_packages (id) on delete set null,
  human_id text not null,
  title text not null,
  description text not null default '',
  status public.manual_action_status not null default 'REQUIRED',
  evidence_note text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint build_manual_actions_human_id_format check (human_id ~ '^MAN-[0-9]{3,}$'),
  constraint build_manual_actions_human_unique unique (plan_id, human_id),
  constraint build_manual_actions_title_present check (char_length(trim(title)) between 1 and 200),
  constraint build_manual_actions_description_length check (char_length(description) <= 4000)
);

create index if not exists build_manual_actions_plan_idx on public.build_manual_actions (plan_id, human_id);

create table if not exists public.build_config_requirements (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.build_plans (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  work_package_id uuid references public.work_packages (id) on delete set null,
  variable_name text not null,
  purpose text not null default '',
  environment text not null default 'production',
  classification public.config_classification not null default 'SERVER_SECRET',
  founder_action_required boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  constraint build_config_requirements_name_format check (variable_name ~ '^[A-Za-z_][A-Za-z0-9_]{0,127}$'),
  constraint build_config_requirements_name_unique unique (plan_id, variable_name),
  constraint build_config_requirements_purpose_length check (char_length(purpose) <= 2000)
);

create index if not exists build_config_requirements_plan_idx on public.build_config_requirements (plan_id);

create table if not exists public.build_plan_risks (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.build_plans (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  work_package_id uuid references public.work_packages (id) on delete set null,
  human_id text not null,
  description text not null,
  severity public.build_risk_severity not null default 'MEDIUM',
  mitigation text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  constraint build_plan_risks_human_id_format check (human_id ~ '^BRISK-[0-9]{3,}$'),
  constraint build_plan_risks_human_unique unique (plan_id, human_id),
  constraint build_plan_risks_description_present check (char_length(trim(description)) between 1 and 4000),
  constraint build_plan_risks_mitigation_length check (char_length(mitigation) <= 4000)
);

create index if not exists build_plan_risks_plan_idx on public.build_plan_risks (plan_id, human_id);

-- ---------------------------------------------------------------------------
-- Decision Inbox link
-- ---------------------------------------------------------------------------

alter table public.project_decisions
  add column if not exists build_plan_id uuid references public.build_plans (id) on delete set null;

create index if not exists project_decisions_build_plan_idx
  on public.project_decisions (build_plan_id)
  where build_plan_id is not null;
