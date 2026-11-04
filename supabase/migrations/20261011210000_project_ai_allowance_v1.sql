-- Ghost Allowance V1 — LOCAL / DISPOSABLE ONLY until founder-gated hosted apply.
-- Integer USD cents. Internal spending authorization — not bank custody.
-- Do not apply to hosted Supabase without separate founder authorization.

create table if not exists public.project_ai_allowances (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  allowance_cents bigint not null default 0
    constraint project_ai_allowances_nonneg check (allowance_cents >= 0),
  reserved_cents bigint not null default 0
    constraint project_ai_allowances_reserved_nonneg check (reserved_cents >= 0),
  charged_cents bigint not null default 0
    constraint project_ai_allowances_charged_nonneg check (charged_cents >= 0),
  currency text not null default 'USD'
    constraint project_ai_allowances_currency check (currency = 'USD'),
  alert_warning_bps integer not null default 2000
    constraint project_ai_allowances_warning_bps check (alert_warning_bps between 0 and 10000),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint project_ai_allowances_reserved_le_allowance check (reserved_cents + charged_cents <= allowance_cents)
);

create table if not exists public.project_ai_allowance_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.project_ai_allowances (project_id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  task_key text not null
    constraint project_ai_reservations_task_key_len check (char_length(trim(task_key)) between 8 and 200),
  estimated_cents bigint not null
    constraint project_ai_reservations_est_pos check (estimated_cents > 0),
  status text not null default 'OPEN'
    constraint project_ai_reservations_status check (status in ('OPEN', 'RECONCILED', 'RELEASED')),
  idempotency_key text not null
    constraint project_ai_reservations_idem_len check (char_length(trim(idempotency_key)) between 8 and 200),
  created_at timestamptz not null default pg_catalog.now(),
  closed_at timestamptz,
  constraint project_ai_reservations_owner_idem unique (owner_id, idempotency_key)
);

create unique index if not exists project_ai_reservations_one_open_task
  on public.project_ai_allowance_reservations (project_id, task_key)
  where status = 'OPEN';

create table if not exists public.project_ai_usage_events (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.project_ai_allowances (project_id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  reservation_id uuid references public.project_ai_allowance_reservations (id) on delete set null,
  event_type text not null
    constraint project_ai_usage_event_type check (
      event_type in ('RESERVE', 'CHARGE', 'RELEASE', 'ADJUST_ALLOWANCE', 'ALERT')
    ),
  amount_cents bigint not null,
  detail text not null default ''
    constraint project_ai_usage_detail_len check (char_length(detail) <= 2000),
  idempotency_key text not null
    constraint project_ai_usage_idem_len check (char_length(trim(idempotency_key)) between 8 and 200),
  created_at timestamptz not null default pg_catalog.now(),
  constraint project_ai_usage_owner_idem unique (owner_id, idempotency_key)
);

alter table public.project_ai_allowances enable row level security;
alter table public.project_ai_allowances force row level security;
alter table public.project_ai_allowance_reservations enable row level security;
alter table public.project_ai_allowance_reservations force row level security;
alter table public.project_ai_usage_events enable row level security;
alter table public.project_ai_usage_events force row level security;

drop policy if exists project_ai_allowances_owner_all on public.project_ai_allowances;
create policy project_ai_allowances_owner_all on public.project_ai_allowances
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists project_ai_reservations_owner_all on public.project_ai_allowance_reservations;
create policy project_ai_reservations_owner_all on public.project_ai_allowance_reservations
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists project_ai_usage_owner_select on public.project_ai_usage_events;
create policy project_ai_usage_owner_select on public.project_ai_usage_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.project_ai_allowances from anon, authenticated;
revoke all on public.project_ai_allowance_reservations from anon, authenticated;
revoke all on public.project_ai_usage_events from anon, authenticated;
grant select, insert, update on public.project_ai_allowances to authenticated;
grant select, insert, update on public.project_ai_allowance_reservations to authenticated;
grant select, insert on public.project_ai_usage_events to authenticated;

-- Atomic reserve: fail closed when available < estimate.
create or replace function private.reserve_project_ai_allowance(
  p_owner_id uuid,
  p_project_id uuid,
  p_task_key text,
  p_estimated_cents bigint,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_available bigint;
begin
  if p_estimated_cents is null or p_estimated_cents <= 0 then
    raise exception 'INVALID_ESTIMATE';
  end if;

  select id into v_id
  from public.project_ai_allowance_reservations
  where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
  if v_id is not null then
    return v_id;
  end if;

  update public.project_ai_allowances a
  set reserved_cents = a.reserved_cents + p_estimated_cents,
      updated_at = now()
  where a.project_id = p_project_id
    and a.owner_id = p_owner_id
    and (a.allowance_cents - a.charged_cents - a.reserved_cents) >= p_estimated_cents
  returning (a.allowance_cents - a.charged_cents - a.reserved_cents) into v_available;

  if not found then
    raise exception 'INSUFFICIENT_ALLOWANCE';
  end if;

  insert into public.project_ai_allowance_reservations (
    project_id, owner_id, task_key, estimated_cents, status, idempotency_key
  ) values (
    p_project_id, p_owner_id, p_task_key, p_estimated_cents, 'OPEN', p_idempotency_key
  ) returning id into v_id;

  insert into public.project_ai_usage_events (
    project_id, owner_id, reservation_id, event_type, amount_cents, detail, idempotency_key
  ) values (
    p_project_id, p_owner_id, v_id, 'RESERVE', p_estimated_cents,
    'Reserved for in-flight AI task', p_idempotency_key || ':event'
  );

  return v_id;
end;
$$;

revoke all on function private.reserve_project_ai_allowance(uuid, uuid, text, bigint, text) from public;
grant execute on function private.reserve_project_ai_allowance(uuid, uuid, text, bigint, text) to authenticated;
