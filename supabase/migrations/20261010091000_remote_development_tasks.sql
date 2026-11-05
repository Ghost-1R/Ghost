-- Remote development task foundation (Build 09.10) — LOCAL ONLY until founder-gated apply.
-- Orchestration contracts only. No real cloud task dispatch. No automatic deployment.
-- Do not apply to hosted Supabase without separate founder authorization.
-- Never store secrets in task records.

do $$ begin
  create type public.remote_dev_task_status as enum (
    'AWAITING_APPROVAL',
    'QUEUED',
    'RUNNING',
    'BLOCKED',
    'FAILED',
    'AWAITING_FOUNDER_REVIEW',
    'VERIFIED',
    'CANCELLED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.remote_provider_kind as enum (
    'FAKE',
    'CURSOR_CLOUD',
    'GITHUB_ACTIONS'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.remote_development_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  objective text not null
    constraint remote_development_tasks_objective_length check (
      char_length(trim(objective)) between 8 and 4000
    ),
  status public.remote_dev_task_status not null default 'AWAITING_APPROVAL',
  authorization_id uuid not null references public.founder_action_authorizations (id) on delete restrict,
  authorization_kind text not null
    constraint remote_development_tasks_kind_check check (authorization_kind in ('DEVELOPMENT', 'DEPLOYMENT')),
  action_type text not null
    constraint remote_development_tasks_action_type_length check (
      char_length(trim(action_type)) between 1 and 120
    ),
  action_scope text not null
    constraint remote_development_tasks_action_scope_length check (
      char_length(trim(action_scope)) between 4 and 2000
    ),
  environment_label text not null default 'REMOTE_DEV',
  scope_fingerprint text not null
    constraint remote_development_tasks_fingerprint_length check (char_length(scope_fingerprint) = 64),
  repository text not null
    constraint remote_development_tasks_repository_length check (
      char_length(trim(repository)) between 3 and 200
    ),
  approved_base_branch text not null
    constraint remote_development_tasks_base_branch_length check (
      char_length(trim(approved_base_branch)) between 1 and 200
    ),
  base_commit_sha text,
  task_branch text,
  provider_kind public.remote_provider_kind not null default 'FAKE',
  external_job_id text,
  requires_independent_review boolean not null default true,
  deployment_authorized boolean not null default false
    constraint remote_development_tasks_no_deploy check (deployment_authorized = false),
  max_estimated_cost_usd numeric(10,2),
  max_duration_ms integer not null default 3600000
    constraint remote_development_tasks_duration_check check (
      max_duration_ms >= 60000 and max_duration_ms <= 86400000
    ),
  evidence jsonb,
  last_error jsonb,
  idempotency_key text not null
    constraint remote_development_tasks_idempotency_length check (
      char_length(trim(idempotency_key)) between 8 and 200
    ),
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint remote_development_tasks_owner_idempotency unique (owner_id, idempotency_key)
);

comment on table public.remote_development_tasks is
  'Remote development orchestration tasks. Development auth only. No auto-deploy. LOCAL ONLY until founder gate.';

create index if not exists remote_development_tasks_owner_status_idx
  on public.remote_development_tasks (owner_id, status, updated_at desc);

create table if not exists public.remote_provider_webhook_events (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null,
  external_job_id text not null,
  provider_kind public.remote_provider_kind not null,
  payload_hash text not null
    constraint remote_provider_webhook_events_hash_length check (char_length(payload_hash) = 64),
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.now(),
  constraint remote_provider_webhook_events_event_unique unique (owner_id, event_id)
);

comment on table public.remote_provider_webhook_events is
  'Idempotent webhook receipts for remote providers. Never stores secrets.';

create or replace function private.guard_remote_dev_task_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
    or new.project_id is distinct from old.project_id
    or new.authorization_id is distinct from old.authorization_id
    or new.scope_fingerprint is distinct from old.scope_fingerprint
    or new.action_type is distinct from old.action_type
    or new.action_scope is distinct from old.action_scope
    or new.environment_label is distinct from old.environment_label
    or new.authorization_kind is distinct from old.authorization_kind
    or new.repository is distinct from old.repository
    or new.approved_base_branch is distinct from old.approved_base_branch
    or new.idempotency_key is distinct from old.idempotency_key
    or new.deployment_authorized is distinct from false
    or new.authorization_kind is distinct from 'DEVELOPMENT'
  then
    raise exception 'remote development identity/binding fields cannot be rewritten'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists remote_development_tasks_guard_binding on public.remote_development_tasks;
create trigger remote_development_tasks_guard_binding
  before update on public.remote_development_tasks
  for each row execute function private.guard_remote_dev_task_binding();

revoke all on function private.guard_remote_dev_task_binding() from public, anon, authenticated;

drop trigger if exists remote_development_tasks_set_updated_at on public.remote_development_tasks;
create trigger remote_development_tasks_set_updated_at
  before update on public.remote_development_tasks
  for each row execute function private.set_updated_at();

alter table public.remote_development_tasks enable row level security;
alter table public.remote_development_tasks force row level security;
alter table public.remote_provider_webhook_events enable row level security;
alter table public.remote_provider_webhook_events force row level security;

drop policy if exists remote_development_tasks_select on public.remote_development_tasks;
create policy remote_development_tasks_select on public.remote_development_tasks
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

drop policy if exists remote_development_tasks_insert on public.remote_development_tasks;
create policy remote_development_tasks_insert on public.remote_development_tasks
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
    and deployment_authorized = false
    and authorization_kind = 'DEVELOPMENT'
  );

drop policy if exists remote_development_tasks_update on public.remote_development_tasks;
create policy remote_development_tasks_update on public.remote_development_tasks
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
    and deployment_authorized = false
    and authorization_kind = 'DEVELOPMENT'
  );

drop policy if exists remote_provider_webhook_events_select on public.remote_provider_webhook_events;
create policy remote_provider_webhook_events_select on public.remote_provider_webhook_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists remote_provider_webhook_events_insert on public.remote_provider_webhook_events;
create policy remote_provider_webhook_events_insert on public.remote_provider_webhook_events
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

revoke all on table public.remote_development_tasks from anon;
revoke all on table public.remote_provider_webhook_events from anon;
revoke all on table public.remote_development_tasks from authenticated;
revoke all on table public.remote_provider_webhook_events from authenticated;

grant select, insert, update on public.remote_development_tasks to authenticated;
grant select, insert on public.remote_provider_webhook_events to authenticated;
