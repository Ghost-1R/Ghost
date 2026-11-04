-- Founder Action Authorizations (Build 09.2) — LOCAL ONLY until founder-gated apply.
-- Distinct from project_decisions (judgment) and memory_proposals (memory trust).
-- Approval never executes an action. Executors must revalidate before use.
-- Do not apply to hosted Supabase without separate founder authorization.

do $$ begin
  create type public.founder_authorization_status as enum (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'REVOKED',
    'EXPIRED',
    'CONSUMED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.founder_authorization_reuse as enum (
    'ONE_TIME',
    'BOUNDED'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.founder_action_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  environment_label text not null default 'UNKNOWN'
    constraint founder_action_authorizations_environment_length check (
      char_length(trim(environment_label)) between 1 and 80
    ),
  decision_id uuid references public.project_decisions (id) on delete set null,
  action_type text not null
    constraint founder_action_authorizations_action_type_length check (
      char_length(trim(action_type)) between 1 and 120
    ),
  action_scope text not null
    constraint founder_action_authorizations_action_scope_length check (
      char_length(trim(action_scope)) between 1 and 2000
    ),
  scope_fingerprint text not null
    constraint founder_action_authorizations_fingerprint_length check (
      char_length(scope_fingerprint) = 64
    ),
  reason text not null
    constraint founder_action_authorizations_reason_length check (
      char_length(trim(reason)) between 1 and 4000
    ),
  evidence jsonb not null default '[]'::jsonb,
  side_effects text not null default '',
  estimated_cost text not null default 'UNKNOWN',
  status public.founder_authorization_status not null default 'PENDING',
  reuse_policy public.founder_authorization_reuse not null default 'ONE_TIME',
  max_uses integer,
  use_count integer not null default 0,
  expires_at timestamptz not null,
  requested_at timestamptz not null default pg_catalog.now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text not null default '',
  consumed_at timestamptz,
  idempotency_key text not null
    constraint founder_action_authorizations_idempotency_length check (
      char_length(trim(idempotency_key)) between 8 and 200
    ),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint founder_action_authorizations_owner_idempotency unique (owner_id, idempotency_key),
  constraint founder_action_authorizations_max_uses_check check (
    (reuse_policy = 'ONE_TIME' and max_uses is null)
    or (reuse_policy = 'BOUNDED' and max_uses is not null and max_uses >= 1 and max_uses <= 100)
  ),
  constraint founder_action_authorizations_use_count_nonneg check (use_count >= 0),
  constraint founder_action_authorizations_side_effects_length check (char_length(side_effects) <= 4000),
  constraint founder_action_authorizations_cost_length check (char_length(estimated_cost) <= 200),
  constraint founder_action_authorizations_revoke_reason_length check (char_length(revoke_reason) <= 2000)
);

comment on table public.founder_action_authorizations is
  'Executable action authorizations. Distinct from project_decisions. Approval does not execute; revalidate before use.';

create index if not exists founder_action_authorizations_owner_status_idx
  on public.founder_action_authorizations (owner_id, status, requested_at desc);

create index if not exists founder_action_authorizations_project_idx
  on public.founder_action_authorizations (project_id, status, requested_at desc);

create index if not exists founder_action_authorizations_expires_idx
  on public.founder_action_authorizations (expires_at)
  where status in ('PENDING', 'APPROVED');

create table if not exists public.founder_authorization_events (
  id uuid primary key default extensions.gen_random_uuid(),
  authorization_id uuid not null references public.founder_action_authorizations (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null
    constraint founder_authorization_events_type_length check (
      char_length(trim(event_type)) between 1 and 80
    ),
  detail text not null default '',
  scope_fingerprint text not null default '',
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint founder_authorization_events_detail_length check (char_length(detail) <= 4000)
);

comment on table public.founder_authorization_events is
  'Append-only audit history for founder action authorizations. Never stores secrets or prompts.';

create index if not exists founder_authorization_events_auth_idx
  on public.founder_authorization_events (authorization_id, created_at desc);

drop trigger if exists founder_action_authorizations_set_updated_at on public.founder_action_authorizations;
create trigger founder_action_authorizations_set_updated_at
  before update on public.founder_action_authorizations
  for each row execute function private.set_updated_at();

alter table public.founder_action_authorizations enable row level security;
alter table public.founder_action_authorizations force row level security;
alter table public.founder_authorization_events enable row level security;
alter table public.founder_authorization_events force row level security;

drop policy if exists founder_action_authorizations_select on public.founder_action_authorizations;
create policy founder_action_authorizations_select on public.founder_action_authorizations
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

drop policy if exists founder_action_authorizations_insert on public.founder_action_authorizations;
create policy founder_action_authorizations_insert on public.founder_action_authorizations
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

drop policy if exists founder_action_authorizations_update on public.founder_action_authorizations;
create policy founder_action_authorizations_update on public.founder_action_authorizations
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

-- No delete policy: authorizations and history are durable.

drop policy if exists founder_authorization_events_select on public.founder_authorization_events;
create policy founder_authorization_events_select on public.founder_authorization_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists founder_authorization_events_insert on public.founder_authorization_events;
create policy founder_authorization_events_insert on public.founder_authorization_events
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

grant select, insert, update on public.founder_action_authorizations to authenticated;
grant select, insert on public.founder_authorization_events to authenticated;
