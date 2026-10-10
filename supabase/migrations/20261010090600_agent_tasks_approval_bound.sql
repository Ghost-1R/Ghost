-- Approval-bound agent tasks (Build 09.6) — LOCAL ONLY until founder-gated apply.
-- Binds each agent task to a founder_action_authorization with immutable scope identity.
-- Development and deployment authorization kinds are explicitly separated.
-- Approval never starts workers. Executors must revalidate on claim and every step.
-- Do not apply to hosted Supabase without separate founder authorization.
-- Do not store credentials or API keys in task records.

do $$ begin
  create type public.agent_authorization_kind as enum (
    'DEVELOPMENT',
    'DEPLOYMENT'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.agent_task_status as enum (
    'QUEUED',
    'CLAIMED',
    'RUNNING',
    'CHECKPOINT',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'BLOCKED'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.agent_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  status public.agent_task_status not null default 'QUEUED',
  authorization_id uuid not null references public.founder_action_authorizations (id) on delete restrict,
  authorization_kind public.agent_authorization_kind not null,
  action_type text not null
    constraint agent_tasks_action_type_length check (
      char_length(trim(action_type)) between 1 and 120
    ),
  action_scope text not null
    constraint agent_tasks_action_scope_length check (
      char_length(trim(action_scope)) between 1 and 2000
    ),
  environment_label text not null default 'UNKNOWN'
    constraint agent_tasks_environment_length check (
      char_length(trim(environment_label)) between 1 and 80
    ),
  scope_fingerprint text not null
    constraint agent_tasks_fingerprint_length check (
      char_length(scope_fingerprint) = 64
    ),
  lease_holder_id text,
  lease_token text,
  lease_expires_at timestamptz,
  checkpoint_sequence integer not null default 0
    constraint agent_tasks_checkpoint_sequence_nonneg check (checkpoint_sequence >= 0),
  last_checkpoint_id uuid,
  last_step_idempotency_key text not null default ''
    constraint agent_tasks_step_idempotency_length check (
      char_length(last_step_idempotency_key) <= 200
    ),
  idempotency_key text not null
    constraint agent_tasks_idempotency_length check (
      char_length(trim(idempotency_key)) between 8 and 200
    ),
  block_reason text not null default ''
    constraint agent_tasks_block_reason_length check (char_length(block_reason) <= 2000),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint agent_tasks_owner_idempotency unique (owner_id, idempotency_key),
  constraint agent_tasks_lease_consistency check (
    (lease_holder_id is null and lease_token is null and lease_expires_at is null)
    or (lease_holder_id is not null and lease_token is not null and lease_expires_at is not null)
  )
);

comment on table public.agent_tasks is
  'Approval-bound agent tasks. Bound to founder_action_authorizations. Workers disabled in Build 09.6. Never stores secrets.';

create index if not exists agent_tasks_owner_status_idx
  on public.agent_tasks (owner_id, status, created_at desc);

create index if not exists agent_tasks_project_idx
  on public.agent_tasks (project_id, status, created_at desc);

create index if not exists agent_tasks_authorization_idx
  on public.agent_tasks (authorization_id);

create table if not exists public.agent_task_events (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.agent_tasks (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null
    constraint agent_task_events_type_length check (
      char_length(trim(event_type)) between 1 and 80
    ),
  detail text not null default '',
  authorization_id uuid not null,
  scope_fingerprint text not null default '',
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint agent_task_events_detail_length check (char_length(detail) <= 4000)
);

comment on table public.agent_task_events is
  'Append-only authorization and lifecycle audit for agent tasks. Never stores secrets or prompts.';

create index if not exists agent_task_events_task_idx
  on public.agent_task_events (task_id, created_at desc);

create table if not exists public.agent_task_checkpoints (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.agent_tasks (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  sequence integer not null
    constraint agent_task_checkpoints_sequence_positive check (sequence >= 1),
  label text not null
    constraint agent_task_checkpoints_label_length check (
      char_length(trim(label)) between 1 and 200
    ),
  progress_ref text not null default ''
    constraint agent_task_checkpoints_progress_length check (char_length(progress_ref) <= 500),
  authorization_id uuid not null,
  scope_fingerprint text not null
    constraint agent_task_checkpoints_fingerprint_length check (
      char_length(scope_fingerprint) = 64
    ),
  created_at timestamptz not null default pg_catalog.now(),
  constraint agent_task_checkpoints_task_sequence unique (task_id, sequence)
);

comment on table public.agent_task_checkpoints is
  'Durable non-secret progress checkpoints for approval-bound agent tasks.';

create index if not exists agent_task_checkpoints_task_idx
  on public.agent_task_checkpoints (task_id, sequence desc);

-- Freeze authorization binding identity after insert (fail closed on silent rewrite).
create or replace function private.guard_agent_task_authorization_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
    or new.project_id is distinct from old.project_id
    or new.authorization_id is distinct from old.authorization_id
    or new.authorization_kind is distinct from old.authorization_kind
    or new.action_type is distinct from old.action_type
    or new.action_scope is distinct from old.action_scope
    or new.environment_label is distinct from old.environment_label
    or new.scope_fingerprint is distinct from old.scope_fingerprint
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_at is distinct from old.created_at
  then
    raise exception 'agent task authorization binding fields cannot be rewritten'
      using errcode = '42501';
  end if;

  if old.status in ('SUCCEEDED', 'FAILED', 'CANCELLED')
    and new.status is distinct from old.status
  then
    raise exception 'terminal agent task status cannot change'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists agent_tasks_guard_binding on public.agent_tasks;
create trigger agent_tasks_guard_binding
  before update on public.agent_tasks
  for each row execute function private.guard_agent_task_authorization_binding();

revoke all on function private.guard_agent_task_authorization_binding() from public, anon, authenticated;

drop trigger if exists agent_tasks_set_updated_at on public.agent_tasks;
create trigger agent_tasks_set_updated_at
  before update on public.agent_tasks
  for each row execute function private.set_updated_at();

alter table public.agent_tasks enable row level security;
alter table public.agent_tasks force row level security;
alter table public.agent_task_events enable row level security;
alter table public.agent_task_events force row level security;
alter table public.agent_task_checkpoints enable row level security;
alter table public.agent_task_checkpoints force row level security;

drop policy if exists agent_tasks_select on public.agent_tasks;
create policy agent_tasks_select on public.agent_tasks
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

drop policy if exists agent_tasks_insert on public.agent_tasks;
create policy agent_tasks_insert on public.agent_tasks
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

drop policy if exists agent_tasks_update on public.agent_tasks;
create policy agent_tasks_update on public.agent_tasks
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

-- No delete policy: agent tasks and audit history are durable.

drop policy if exists agent_task_events_select on public.agent_task_events;
create policy agent_task_events_select on public.agent_task_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists agent_task_events_insert on public.agent_task_events;
create policy agent_task_events_insert on public.agent_task_events
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists agent_task_checkpoints_select on public.agent_task_checkpoints;
create policy agent_task_checkpoints_select on public.agent_task_checkpoints
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists agent_task_checkpoints_insert on public.agent_task_checkpoints;
create policy agent_task_checkpoints_insert on public.agent_task_checkpoints
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

revoke all on table public.agent_tasks from anon;
revoke all on table public.agent_task_events from anon;
revoke all on table public.agent_task_checkpoints from anon;

revoke all on table public.agent_tasks from authenticated;
revoke all on table public.agent_task_events from authenticated;
revoke all on table public.agent_task_checkpoints from authenticated;

grant select, insert, update on public.agent_tasks to authenticated;
grant select, insert on public.agent_task_events to authenticated;
grant select, insert on public.agent_task_checkpoints to authenticated;
