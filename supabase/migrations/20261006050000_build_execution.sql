-- Ghost V9 Build Execution.
-- Controlled implementation of a BUILD_PLAN_READY Build Plan.
-- Implementation evidence only — not verification or deployment.
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.build_execution_status as enum (
    'NOT_STARTED',
    'EXECUTING',
    'IMPLEMENTATION_REVIEW',
    'IMPLEMENTED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.package_execution_status as enum (
    'QUEUED',
    'READY',
    'IN_PROGRESS',
    'BLOCKED',
    'IMPLEMENTED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.implementation_evidence_kind as enum (
    'COMMIT',
    'CHANGED_FILE',
    'MIGRATION',
    'DATABASE_OBJECT',
    'API_ROUTE',
    'COMPONENT',
    'CONFIGURATION',
    'MANUAL_RECORD'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.execution_blocker_status as enum (
    'OPEN',
    'RESOLVED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.upstream_change_status as enum (
    'OPEN',
    'RESOLVED',
    'SUPERSEDED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.upstream_artifact_kind as enum (
    'PRODUCT_ARCHITECTURE',
    'SYSTEM_ARCHITECTURE',
    'BUILD_PLAN',
    'WORK_PACKAGE',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Root execution + append-only history
-- ---------------------------------------------------------------------------

create table if not exists public.build_executions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  build_plan_id uuid not null references public.build_plans (id) on delete restrict,
  product_architecture_id uuid not null references public.product_architectures (id) on delete restrict,
  system_architecture_id uuid not null references public.system_architectures (id) on delete restrict,
  summary text not null default '',
  status public.build_execution_status not null default 'NOT_STARTED',
  note text not null default '',
  implemented_at timestamptz,
  implemented_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint build_executions_one_per_project unique (project_id),
  constraint build_executions_one_per_plan unique (build_plan_id),
  constraint build_executions_summary_length check (char_length(summary) <= 8000),
  constraint build_executions_note_length check (char_length(note) <= 4000)
);

create index if not exists build_executions_plan_idx on public.build_executions (build_plan_id);
create index if not exists build_executions_status_idx on public.build_executions (status, updated_at desc);

comment on table public.build_executions is
  'Authoritative Build Execution for a BUILD_PLAN_READY plan. IMPLEMENTED means evidence-backed implementation only — not verified or deployed.';

create table if not exists public.build_execution_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  execution_id uuid not null references public.build_executions (id) on delete cascade,
  from_status public.build_execution_status,
  to_status public.build_execution_status not null,
  changed_at timestamptz not null default pg_catalog.now(),
  changed_by uuid references auth.users (id) on delete set null,
  actor public.product_actor not null default 'FOUNDER',
  reason text not null,
  constraint build_execution_transitions_reason_present check (char_length(trim(reason)) between 1 and 2000)
);

create index if not exists build_execution_transitions_exec_idx
  on public.build_execution_transitions (execution_id, changed_at desc);

create or replace function private.guard_build_execution_transition_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'build execution transitions are append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists build_execution_transitions_no_update on public.build_execution_transitions;
create trigger build_execution_transitions_no_update
  before update on public.build_execution_transitions
  for each row execute function private.guard_build_execution_transition_immutable();

drop trigger if exists build_execution_transitions_no_delete on public.build_execution_transitions;
create trigger build_execution_transitions_no_delete
  before delete on public.build_execution_transitions
  for each row execute function private.guard_build_execution_transition_immutable();

-- ---------------------------------------------------------------------------
-- Package execution (maps 1:1 to V8 work packages)
-- ---------------------------------------------------------------------------

create table if not exists public.work_package_executions (
  id uuid primary key default extensions.gen_random_uuid(),
  execution_id uuid not null references public.build_executions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  work_package_id uuid not null references public.work_packages (id) on delete restrict,
  status public.package_execution_status not null default 'QUEUED',
  implementation_notes text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  started_by uuid references auth.users (id) on delete set null,
  completed_by uuid references auth.users (id) on delete set null,
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint work_package_executions_unique unique (execution_id, work_package_id),
  constraint work_package_executions_notes_length check (char_length(implementation_notes) <= 8000)
);

create index if not exists work_package_executions_exec_idx
  on public.work_package_executions (execution_id, status);
create index if not exists work_package_executions_wp_idx
  on public.work_package_executions (work_package_id);

-- ---------------------------------------------------------------------------
-- Implementation evidence (references only — no secret values)
-- ---------------------------------------------------------------------------

create table if not exists public.implementation_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  package_execution_id uuid not null references public.work_package_executions (id) on delete cascade,
  execution_id uuid not null references public.build_executions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.implementation_evidence_kind not null,
  reference text not null,
  summary text not null default '',
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint implementation_evidence_reference_present check (char_length(trim(reference)) between 1 and 1000),
  constraint implementation_evidence_summary_length check (char_length(summary) <= 4000)
);

create index if not exists implementation_evidence_pkg_idx
  on public.implementation_evidence (package_execution_id, created_at desc);
create index if not exists implementation_evidence_exec_idx
  on public.implementation_evidence (execution_id);

-- ---------------------------------------------------------------------------
-- Execution blockers (append-friendly; resolve in place, never delete history)
-- ---------------------------------------------------------------------------

create table if not exists public.execution_blockers (
  id uuid primary key default extensions.gen_random_uuid(),
  package_execution_id uuid not null references public.work_package_executions (id) on delete cascade,
  execution_id uuid not null references public.build_executions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  description text not null,
  status public.execution_blocker_status not null default 'OPEN',
  resolution text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  source text not null default 'founder',
  provenance text not null default 'founder',
  constraint execution_blockers_description_present check (char_length(trim(description)) between 1 and 4000),
  constraint execution_blockers_resolution_length check (char_length(resolution) <= 4000)
);

create index if not exists execution_blockers_pkg_idx
  on public.execution_blockers (package_execution_id, status);
create index if not exists execution_blockers_open_idx
  on public.execution_blockers (execution_id)
  where status = 'OPEN';

-- ---------------------------------------------------------------------------
-- Upstream change protection (do not silently rewrite V6–V8)
-- ---------------------------------------------------------------------------

create table if not exists public.execution_upstream_changes (
  id uuid primary key default extensions.gen_random_uuid(),
  execution_id uuid not null references public.build_executions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  package_execution_id uuid references public.work_package_executions (id) on delete set null,
  artifact_kind public.upstream_artifact_kind not null,
  artifact_ref text not null default '',
  issue text not null,
  status public.upstream_change_status not null default 'OPEN',
  decision_id uuid references public.project_decisions (id) on delete set null,
  resolution text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  resolved_at timestamptz,
  source text not null default 'founder',
  provenance text not null default 'founder',
  constraint execution_upstream_changes_issue_present check (char_length(trim(issue)) between 1 and 4000),
  constraint execution_upstream_changes_resolution_length check (char_length(resolution) <= 4000)
);

create index if not exists execution_upstream_changes_exec_idx
  on public.execution_upstream_changes (execution_id, status);

-- ---------------------------------------------------------------------------
-- Decision Inbox link
-- ---------------------------------------------------------------------------

alter table public.project_decisions
  add column if not exists build_execution_id uuid references public.build_executions (id) on delete set null;

create index if not exists project_decisions_build_execution_idx
  on public.project_decisions (build_execution_id)
  where build_execution_id is not null;
