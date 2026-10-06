-- Ghost V11 Deployment / Release.
-- Authoritative release of a VERIFIED Verification Program.
-- DEPLOYED ≠ PRODUCTION_VERIFIED. VERIFIED ≠ DEPLOYED.
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.release_status as enum (
    'DRAFT',
    'DEPLOYMENT_READY',
    'DEPLOYING',
    'DEPLOYED',
    'PRODUCTION_VERIFICATION',
    'PRODUCTION_VERIFIED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.deployment_attempt_status as enum (
    'QUEUED',
    'IN_PROGRESS',
    'SUCCEEDED',
    'FAILED',
    'ROLLED_BACK',
    'CANCELLED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.deployment_environment_type as enum (
    'LOCAL',
    'PREVIEW',
    'STAGING',
    'PRODUCTION'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.config_presence_status as enum (
    'PRESENT',
    'MISSING',
    'UNKNOWN'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.release_migration_status as enum (
    'PENDING',
    'APPLIED',
    'FAILED',
    'NOT_REQUIRED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.deployment_health_status as enum (
    'PENDING',
    'PASSED',
    'FAILED',
    'SKIPPED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.rollback_status as enum (
    'AVAILABLE',
    'REQUESTED',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.deployment_manual_action_status as enum (
    'PENDING',
    'COMPLETED',
    'BLOCKED',
    'SKIPPED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.deployment_evidence_kind as enum (
    'PROVIDER_STATUS',
    'HEALTH_RESPONSE',
    'LIVE_SHA',
    'INSPECTOR_RUN',
    'PRESENTATION_GATE',
    'MANUAL_OBSERVATION',
    'COMMAND_RESULT',
    'MIGRATION_CONFIRMATION'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Environments
-- ---------------------------------------------------------------------------

create table if not exists public.deployment_environments (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  environment_type public.deployment_environment_type not null,
  provider text not null default '',
  application_url text not null default '',
  health_endpoint text not null default '',
  service_identity text not null default '',
  is_active boolean not null default true,
  note text not null default '',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint deployment_environments_name_present check (char_length(trim(name)) between 1 and 120),
  constraint deployment_environments_provider_length check (char_length(provider) <= 120),
  constraint deployment_environments_url_length check (char_length(application_url) <= 500),
  constraint deployment_environments_health_length check (char_length(health_endpoint) <= 500),
  constraint deployment_environments_service_length check (char_length(service_identity) <= 200),
  constraint deployment_environments_note_length check (char_length(note) <= 4000),
  constraint deployment_environments_unique_name unique (project_id, name)
);

create index if not exists deployment_environments_project_idx
  on public.deployment_environments (project_id, environment_type);

comment on table public.deployment_environments is
  'Safe deployment environment metadata. Never stores secret values.';

-- ---------------------------------------------------------------------------
-- Releases + append-only history
-- ---------------------------------------------------------------------------

create table if not exists public.releases (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  verification_program_id uuid not null references public.verification_programs (id) on delete restrict,
  build_execution_id uuid not null references public.build_executions (id) on delete restrict,
  build_plan_id uuid not null references public.build_plans (id) on delete restrict,
  product_architecture_id uuid not null references public.product_architectures (id) on delete restrict,
  system_architecture_id uuid not null references public.system_architectures (id) on delete restrict,
  environment_id uuid references public.deployment_environments (id) on delete set null,
  human_id text not null,
  summary text not null default '',
  status public.release_status not null default 'DRAFT',
  source_branch text not null default '',
  source_commit_sha text not null default '',
  release_version text not null default '',
  deployment_sequence text[] not null default '{}',
  rollback_strategy text not null default '',
  rollback_target_release_id uuid references public.releases (id) on delete set null,
  rollback_target_commit_sha text not null default '',
  note text not null default '',
  deployed_at timestamptz,
  production_verified_at timestamptz,
  production_verified_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint releases_human_id_format check (human_id ~ '^REL-[0-9]{3,}$'),
  constraint releases_human_unique unique (project_id, human_id),
  constraint releases_summary_length check (char_length(summary) <= 8000),
  constraint releases_branch_length check (char_length(source_branch) <= 200),
  constraint releases_sha_length check (char_length(source_commit_sha) <= 80),
  constraint releases_version_length check (char_length(release_version) <= 120),
  constraint releases_rollback_strategy_length check (char_length(rollback_strategy) <= 4000),
  constraint releases_rollback_sha_length check (char_length(rollback_target_commit_sha) <= 80),
  constraint releases_note_length check (char_length(note) <= 4000)
);

create index if not exists releases_project_idx on public.releases (project_id, status, created_at desc);
create index if not exists releases_verification_idx on public.releases (verification_program_id);
create index if not exists releases_sha_idx on public.releases (project_id, source_commit_sha);

comment on table public.releases is
  'Authoritative release candidate for a VERIFIED Verification Program. VERIFIED ≠ DEPLOYED ≠ PRODUCTION_VERIFIED.';

create table if not exists public.release_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete cascade,
  from_status public.release_status,
  to_status public.release_status not null,
  changed_at timestamptz not null default pg_catalog.now(),
  changed_by uuid references auth.users (id) on delete set null,
  actor public.product_actor not null default 'FOUNDER',
  reason text not null,
  constraint release_transitions_reason_present check (char_length(trim(reason)) between 1 and 2000)
);

create index if not exists release_transitions_release_idx
  on public.release_transitions (release_id, changed_at desc);

create or replace function public.prevent_release_transition_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'release_transitions is append-only';
end;
$$;

drop trigger if exists release_transitions_no_update on public.release_transitions;
create trigger release_transitions_no_update
  before update on public.release_transitions
  for each row execute function public.prevent_release_transition_mutation();

drop trigger if exists release_transitions_no_delete on public.release_transitions;
create trigger release_transitions_no_delete
  before delete on public.release_transitions
  for each row execute function public.prevent_release_transition_mutation();

-- ---------------------------------------------------------------------------
-- Configuration presence (never secret values)
-- ---------------------------------------------------------------------------

create table if not exists public.release_config_requirements (
  id uuid primary key default extensions.gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  environment_id uuid references public.deployment_environments (id) on delete set null,
  variable_name text not null,
  is_required boolean not null default true,
  is_secret boolean not null default true,
  presence public.config_presence_status not null default 'UNKNOWN',
  verified_at timestamptz,
  note text not null default '',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint release_config_variable_present check (char_length(trim(variable_name)) between 1 and 200),
  constraint release_config_variable_no_value check (variable_name !~ '='),
  constraint release_config_note_length check (char_length(note) <= 2000),
  constraint release_config_unique unique (release_id, variable_name)
);

create index if not exists release_config_release_idx
  on public.release_config_requirements (release_id, presence);

comment on table public.release_config_requirements is
  'Required configuration presence only (PRESENT/MISSING/UNKNOWN). Never stores secret values.';

-- ---------------------------------------------------------------------------
-- Migration tracking
-- ---------------------------------------------------------------------------

create table if not exists public.release_migrations (
  id uuid primary key default extensions.gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  environment_id uuid references public.deployment_environments (id) on delete set null,
  migration_path text not null,
  is_required boolean not null default true,
  status public.release_migration_status not null default 'PENDING',
  applied_at timestamptz,
  evidence_ref text not null default '',
  note text not null default '',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint release_migrations_path_present check (char_length(trim(migration_path)) between 1 and 500),
  constraint release_migrations_evidence_length check (char_length(evidence_ref) <= 500),
  constraint release_migrations_note_length check (char_length(note) <= 2000),
  constraint release_migrations_unique unique (release_id, migration_path)
);

create index if not exists release_migrations_release_idx
  on public.release_migrations (release_id, status);

comment on table public.release_migrations is
  'Required migrations for a release. Committed ≠ applied.';

-- ---------------------------------------------------------------------------
-- Deployments
-- ---------------------------------------------------------------------------

create table if not exists public.deployments (
  id uuid primary key default extensions.gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  environment_id uuid not null references public.deployment_environments (id) on delete restrict,
  human_id text not null,
  status public.deployment_attempt_status not null default 'QUEUED',
  provider text not null default '',
  provider_deployment_id text not null default '',
  expected_commit_sha text not null default '',
  live_commit_sha text not null default '',
  deployment_url text not null default '',
  failure_reason text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  inspector_result text not null default '',
  presentation_result text not null default '',
  note text not null default '',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint deployments_human_id_format check (human_id ~ '^DEP-[0-9]{3,}$'),
  constraint deployments_human_unique unique (release_id, human_id),
  constraint deployments_provider_length check (char_length(provider) <= 120),
  constraint deployments_provider_id_length check (char_length(provider_deployment_id) <= 200),
  constraint deployments_sha_length check (char_length(expected_commit_sha) <= 80 and char_length(live_commit_sha) <= 80),
  constraint deployments_url_length check (char_length(deployment_url) <= 500),
  constraint deployments_failure_length check (char_length(failure_reason) <= 4000),
  constraint deployments_inspector_length check (char_length(inspector_result) <= 120),
  constraint deployments_presentation_length check (char_length(presentation_result) <= 120),
  constraint deployments_note_length check (char_length(note) <= 4000)
);

create index if not exists deployments_release_idx on public.deployments (release_id, created_at desc);
create index if not exists deployments_project_idx on public.deployments (project_id, status, created_at desc);

comment on table public.deployments is
  'Deployment attempts for a release. SUCCEEDED requires deployment evidence. Failed attempts preserve history.';

create table if not exists public.deployment_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  deployment_id uuid not null references public.deployments (id) on delete cascade,
  release_id uuid not null references public.releases (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.deployment_evidence_kind not null,
  reference text not null,
  summary text not null default '',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint deployment_evidence_reference_present check (char_length(trim(reference)) between 1 and 500),
  constraint deployment_evidence_summary_length check (char_length(summary) <= 2000)
);

create index if not exists deployment_evidence_deployment_idx
  on public.deployment_evidence (deployment_id, created_at desc);

create table if not exists public.deployment_health_checks (
  id uuid primary key default extensions.gen_random_uuid(),
  deployment_id uuid not null references public.deployments (id) on delete cascade,
  release_id uuid not null references public.releases (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  check_name text not null,
  status public.deployment_health_status not null default 'PENDING',
  expected_value text not null default '',
  observed_value text not null default '',
  evidence_ref text not null default '',
  checked_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint deployment_health_name_present check (char_length(trim(check_name)) between 1 and 200),
  constraint deployment_health_value_length check (
    char_length(expected_value) <= 500 and char_length(observed_value) <= 500
  ),
  constraint deployment_health_evidence_length check (char_length(evidence_ref) <= 500),
  constraint deployment_health_note_length check (char_length(note) <= 2000)
);

create index if not exists deployment_health_deployment_idx
  on public.deployment_health_checks (deployment_id, status);

create table if not exists public.deployment_manual_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  deployment_id uuid references public.deployments (id) on delete set null,
  title text not null,
  instruction text not null default '',
  is_required boolean not null default true,
  status public.deployment_manual_action_status not null default 'PENDING',
  evidence_ref text not null default '',
  completed_at timestamptz,
  note text not null default '',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint deployment_manual_title_present check (char_length(trim(title)) between 1 and 200),
  constraint deployment_manual_instruction_length check (char_length(instruction) <= 4000),
  constraint deployment_manual_evidence_length check (char_length(evidence_ref) <= 500),
  constraint deployment_manual_note_length check (char_length(note) <= 2000)
);

create index if not exists deployment_manual_release_idx
  on public.deployment_manual_actions (release_id, status);

create table if not exists public.release_rollbacks (
  id uuid primary key default extensions.gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  target_release_id uuid references public.releases (id) on delete set null,
  target_commit_sha text not null default '',
  status public.rollback_status not null default 'AVAILABLE',
  reason text not null default '',
  evidence_ref text not null default '',
  requested_at timestamptz,
  completed_at timestamptz,
  note text not null default '',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint release_rollbacks_sha_length check (char_length(target_commit_sha) <= 80),
  constraint release_rollbacks_reason_length check (char_length(reason) <= 4000),
  constraint release_rollbacks_evidence_length check (char_length(evidence_ref) <= 500),
  constraint release_rollbacks_note_length check (char_length(note) <= 2000)
);

create index if not exists release_rollbacks_release_idx
  on public.release_rollbacks (release_id, status);

-- ---------------------------------------------------------------------------
-- Decision Inbox link
-- ---------------------------------------------------------------------------

alter table public.project_decisions
  add column if not exists release_id uuid references public.releases (id) on delete set null;

alter table public.project_decisions
  add column if not exists deployment_id uuid references public.deployments (id) on delete set null;

create index if not exists project_decisions_release_idx
  on public.project_decisions (release_id)
  where release_id is not null;

create index if not exists project_decisions_deployment_idx
  on public.project_decisions (deployment_id)
  where deployment_id is not null;
