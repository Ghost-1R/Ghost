-- Build 09.13 — link remote_development_tasks → agent_tasks (LOCAL ONLY).
-- Unifies orchestration (remote-dev) with execution steps (agent_tasks).
-- Do not apply to hosted Supabase without separate founder authorization.
-- No third task system. Workers remain disabled at the application layer.

-- Nullable 1:1 execution link. Set when remote-dev is queued after durable approval.
alter table public.remote_development_tasks
  add column if not exists agent_task_id uuid
    references public.agent_tasks (id) on delete restrict;

comment on column public.remote_development_tasks.agent_task_id is
  'Optional 1:1 link to agent_tasks execution row. Null until authorized queue. LOCAL ONLY until founder gate.';

create unique index if not exists remote_development_tasks_agent_task_id_uidx
  on public.remote_development_tasks (agent_task_id)
  where agent_task_id is not null;

-- Durable founder review / evidence audit events (append-oriented).
create table if not exists public.remote_development_review_events (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  remote_development_task_id uuid not null
    references public.remote_development_tasks (id) on delete cascade,
  agent_task_id uuid references public.agent_tasks (id) on delete restrict,
  authorization_id uuid not null
    references public.founder_action_authorizations (id) on delete restrict,
  event_type text not null
    constraint remote_development_review_events_type_length check (
      char_length(trim(event_type)) between 2 and 80
    ),
  detail text not null default ''
    constraint remote_development_review_events_detail_length check (
      char_length(detail) <= 4000
    ),
  scope_fingerprint text not null
    constraint remote_development_review_events_fp_length check (char_length(scope_fingerprint) = 64),
  created_at timestamptz not null default pg_catalog.now()
);

comment on table public.remote_development_review_events is
  'Append-oriented remote-dev review/audit events. LOCAL ONLY until founder gate. Never stores secrets.';

create index if not exists remote_development_review_events_task_idx
  on public.remote_development_review_events (owner_id, remote_development_task_id, created_at desc);

-- Prevent orphan / cross-tenant links: agent task must share owner, project, authorization.
create or replace function private.guard_remote_dev_agent_task_link()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  agent_owner uuid;
  agent_project uuid;
  agent_auth uuid;
  agent_kind text;
begin
  if new.agent_task_id is null then
    return new;
  end if;

  select owner_id, project_id, authorization_id, authorization_kind
    into agent_owner, agent_project, agent_auth, agent_kind
  from public.agent_tasks
  where id = new.agent_task_id;

  if agent_owner is null then
    raise exception 'remote development agent_task_id does not reference an existing agent task'
      using errcode = '23503';
  end if;

  if agent_owner is distinct from new.owner_id
    or agent_project is distinct from new.project_id
    or agent_auth is distinct from new.authorization_id
  then
    raise exception 'remote development agent_task_id must match owner, project, and authorization'
      using errcode = '42501';
  end if;

  if agent_kind is distinct from 'DEVELOPMENT' then
    raise exception 'remote development cannot link to a DEPLOYMENT agent task'
      using errcode = '42501';
  end if;

  -- Binding identity remains immutable once set.
  if tg_op = 'UPDATE'
    and old.agent_task_id is not null
    and new.agent_task_id is distinct from old.agent_task_id
  then
    raise exception 'remote development agent_task_id cannot be reassigned'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists remote_development_tasks_guard_agent_link on public.remote_development_tasks;
create trigger remote_development_tasks_guard_agent_link
  before insert or update of agent_task_id on public.remote_development_tasks
  for each row execute function private.guard_remote_dev_agent_task_link();

revoke all on function private.guard_remote_dev_agent_task_link() from public, anon, authenticated;

alter table public.remote_development_review_events enable row level security;
alter table public.remote_development_review_events force row level security;

drop policy if exists remote_development_review_events_select on public.remote_development_review_events;
create policy remote_development_review_events_select on public.remote_development_review_events
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

drop policy if exists remote_development_review_events_insert on public.remote_development_review_events;
create policy remote_development_review_events_insert on public.remote_development_review_events
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

revoke all on table public.remote_development_review_events from anon;
revoke all on table public.remote_development_review_events from authenticated;
grant select, insert on public.remote_development_review_events to authenticated;
