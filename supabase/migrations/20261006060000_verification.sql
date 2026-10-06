-- Ghost V10 Verification / Test.
-- Authoritative verification of an IMPLEMENTED Build Execution.
-- VERIFIED means verification gate passed — not deployed.
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.verification_program_status as enum (
    'NOT_STARTED',
    'TESTING',
    'VERIFICATION_REVIEW',
    'VERIFIED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.verification_case_status as enum (
    'PLANNED',
    'READY',
    'RUNNING',
    'PASSED',
    'FAILED',
    'BLOCKED',
    'NOT_APPLICABLE'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.verification_case_kind as enum (
    'AUTOMATED',
    'MANUAL_FUNCTIONAL',
    'INTEGRATION',
    'REGRESSION',
    'SECURITY',
    'RESPONSIVE',
    'DATABASE_RLS',
    'ACCEPTANCE'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.verification_evidence_kind as enum (
    'AUTOMATED_RESULT',
    'COMMAND_RESULT',
    'INSPECTOR_EVIDENCE',
    'SCREENSHOT_REF',
    'MANUAL_OBSERVATION',
    'API_RESPONSE_SUMMARY',
    'RLS_PROBE',
    'BROWSER_QA',
    'SECURITY_SCAN'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.verification_defect_status as enum (
    'OPEN',
    'IN_PROGRESS',
    'RESOLVED',
    'RETEST_REQUIRED',
    'CLOSED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.verification_defect_severity as enum (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Root verification program + append-only history
-- ---------------------------------------------------------------------------

create table if not exists public.verification_programs (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  build_execution_id uuid not null references public.build_executions (id) on delete restrict,
  build_plan_id uuid not null references public.build_plans (id) on delete restrict,
  product_architecture_id uuid not null references public.product_architectures (id) on delete restrict,
  system_architecture_id uuid not null references public.system_architectures (id) on delete restrict,
  summary text not null default '',
  status public.verification_program_status not null default 'NOT_STARTED',
  note text not null default '',
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint verification_programs_one_per_project unique (project_id),
  constraint verification_programs_one_per_execution unique (build_execution_id),
  constraint verification_programs_summary_length check (char_length(summary) <= 8000),
  constraint verification_programs_note_length check (char_length(note) <= 4000)
);

create index if not exists verification_programs_execution_idx on public.verification_programs (build_execution_id);
create index if not exists verification_programs_status_idx on public.verification_programs (status, updated_at desc);

comment on table public.verification_programs is
  'Authoritative Verification program for an IMPLEMENTED Build Execution. VERIFIED ≠ DEPLOYED.';

create table if not exists public.verification_program_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  program_id uuid not null references public.verification_programs (id) on delete cascade,
  from_status public.verification_program_status,
  to_status public.verification_program_status not null,
  changed_at timestamptz not null default pg_catalog.now(),
  changed_by uuid references auth.users (id) on delete set null,
  actor public.product_actor not null default 'FOUNDER',
  reason text not null,
  constraint verification_program_transitions_reason_present check (char_length(trim(reason)) between 1 and 2000)
);

create index if not exists verification_program_transitions_prog_idx
  on public.verification_program_transitions (program_id, changed_at desc);

create or replace function private.guard_verification_program_transition_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'verification program transitions are append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists verification_program_transitions_no_update on public.verification_program_transitions;
create trigger verification_program_transitions_no_update
  before update on public.verification_program_transitions
  for each row execute function private.guard_verification_program_transition_immutable();

drop trigger if exists verification_program_transitions_no_delete on public.verification_program_transitions;
create trigger verification_program_transitions_no_delete
  before delete on public.verification_program_transitions
  for each row execute function private.guard_verification_program_transition_immutable();

-- ---------------------------------------------------------------------------
-- Test cases
-- ---------------------------------------------------------------------------

create table if not exists public.verification_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  program_id uuid not null references public.verification_programs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  title text not null,
  purpose text not null default '',
  case_kind public.verification_case_kind not null default 'MANUAL_FUNCTIONAL',
  is_automated boolean not null default false,
  is_required boolean not null default true,
  is_regression boolean not null default false,
  status public.verification_case_status not null default 'PLANNED',
  preconditions text not null default '',
  expected_result text not null default '',
  actual_result text not null default '',
  work_package_id uuid references public.work_packages (id) on delete set null,
  package_execution_id uuid references public.work_package_executions (id) on delete set null,
  plan_verification_id uuid references public.work_package_verifications (id) on delete set null,
  requirement_id uuid references public.product_requirements (id) on delete set null,
  feature_id uuid references public.product_features (id) on delete set null,
  source text not null default 'founder',
  provenance text not null default 'founder',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint verification_cases_human_id_format check (human_id ~ '^TC-[0-9]{3,}$'),
  constraint verification_cases_human_unique unique (program_id, human_id),
  constraint verification_cases_title_present check (char_length(trim(title)) between 1 and 200),
  constraint verification_cases_purpose_length check (char_length(purpose) <= 4000),
  constraint verification_cases_expected_length check (char_length(expected_result) <= 4000),
  constraint verification_cases_actual_length check (char_length(actual_result) <= 8000)
);

create index if not exists verification_cases_program_idx on public.verification_cases (program_id, status);
create index if not exists verification_cases_wp_idx on public.verification_cases (work_package_id);

-- ---------------------------------------------------------------------------
-- Verification evidence (references/summaries only — no secrets)
-- ---------------------------------------------------------------------------

create table if not exists public.verification_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  case_id uuid not null references public.verification_cases (id) on delete cascade,
  program_id uuid not null references public.verification_programs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.verification_evidence_kind not null,
  reference text not null,
  summary text not null default '',
  is_automated boolean not null default false,
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint verification_evidence_reference_present check (char_length(trim(reference)) between 1 and 1000),
  constraint verification_evidence_summary_length check (char_length(summary) <= 4000)
);

create index if not exists verification_evidence_case_idx
  on public.verification_evidence (case_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Defects + retest history
-- ---------------------------------------------------------------------------

create table if not exists public.verification_defects (
  id uuid primary key default extensions.gen_random_uuid(),
  program_id uuid not null references public.verification_programs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  case_id uuid not null references public.verification_cases (id) on delete restrict,
  human_id text not null,
  title text not null,
  description text not null default '',
  severity public.verification_defect_severity not null default 'MEDIUM',
  blocking boolean not null default false,
  status public.verification_defect_status not null default 'OPEN',
  resolution text not null default '',
  package_execution_id uuid references public.work_package_executions (id) on delete set null,
  requirement_id uuid references public.product_requirements (id) on delete set null,
  feature_id uuid references public.product_features (id) on delete set null,
  retest_case_id uuid references public.verification_cases (id) on delete set null,
  discovered_at timestamptz not null default pg_catalog.now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint verification_defects_human_id_format check (human_id ~ '^DEF-[0-9]{3,}$'),
  constraint verification_defects_human_unique unique (program_id, human_id),
  constraint verification_defects_title_present check (char_length(trim(title)) between 1 and 200),
  constraint verification_defects_description_length check (char_length(description) <= 8000),
  constraint verification_defects_resolution_length check (char_length(resolution) <= 4000)
);

create index if not exists verification_defects_program_idx on public.verification_defects (program_id, status);
create index if not exists verification_defects_blocking_idx
  on public.verification_defects (program_id)
  where blocking = true and status in ('OPEN', 'IN_PROGRESS', 'RETEST_REQUIRED');

-- When HIGH/CRITICAL, default blocking true via application; also enforce CRITICAL always blocking at insert/update via trigger optional — keep in app.

create table if not exists public.verification_retest_events (
  id uuid primary key default extensions.gen_random_uuid(),
  defect_id uuid not null references public.verification_defects (id) on delete cascade,
  program_id uuid not null references public.verification_programs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  case_id uuid not null references public.verification_cases (id) on delete restrict,
  result_status public.verification_case_status not null,
  evidence_id uuid references public.verification_evidence (id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint verification_retest_events_result_check check (result_status in ('PASSED', 'FAILED', 'BLOCKED')),
  constraint verification_retest_events_note_length check (char_length(note) <= 4000)
);

create index if not exists verification_retest_events_defect_idx
  on public.verification_retest_events (defect_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Decision Inbox link
-- ---------------------------------------------------------------------------

alter table public.project_decisions
  add column if not exists verification_program_id uuid references public.verification_programs (id) on delete set null;

create index if not exists project_decisions_verification_program_idx
  on public.project_decisions (verification_program_id)
  where verification_program_id is not null;
