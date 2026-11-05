-- Ghost Allowance reconcile/release + durable codegen dispatch identity.
-- LOCAL / DISPOSABLE ONLY. Do not apply to hosted Supabase without founder authorization.

create or replace function private.reconcile_project_ai_allowance(
  p_owner_id uuid,
  p_reservation_id uuid,
  p_actual_cents bigint,
  p_idempotency_key text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res public.project_ai_allowance_reservations%rowtype;
begin
  if p_actual_cents is null or p_actual_cents < 0 then
    raise exception 'INVALID_ACTUAL';
  end if;

  if exists (
    select 1 from public.project_ai_usage_events
    where owner_id = p_owner_id and idempotency_key = p_idempotency_key
  ) then
    return true;
  end if;

  select * into v_res
  from public.project_ai_allowance_reservations
  where id = p_reservation_id and owner_id = p_owner_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_res.status <> 'OPEN' then
    raise exception 'NOT_OPEN';
  end if;
  if p_actual_cents > v_res.estimated_cents then
    raise exception 'ACTUAL_EXCEEDS_RESERVATION';
  end if;

  update public.project_ai_allowances a
  set reserved_cents = a.reserved_cents - v_res.estimated_cents,
      charged_cents = a.charged_cents + p_actual_cents,
      updated_at = now()
  where a.project_id = v_res.project_id and a.owner_id = p_owner_id;

  update public.project_ai_allowance_reservations
  set status = 'RECONCILED', closed_at = now()
  where id = v_res.id;

  insert into public.project_ai_usage_events (
    project_id, owner_id, reservation_id, event_type, amount_cents, detail, idempotency_key
  ) values (
    v_res.project_id, p_owner_id, v_res.id, 'CHARGE', p_actual_cents,
    'Reconciled provider usage against reservation', p_idempotency_key
  );

  return true;
end;
$$;

create or replace function private.release_project_ai_allowance(
  p_owner_id uuid,
  p_reservation_id uuid,
  p_idempotency_key text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res public.project_ai_allowance_reservations%rowtype;
begin
  if exists (
    select 1 from public.project_ai_usage_events
    where owner_id = p_owner_id and idempotency_key = p_idempotency_key
  ) then
    return true;
  end if;

  select * into v_res
  from public.project_ai_allowance_reservations
  where id = p_reservation_id and owner_id = p_owner_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_res.status <> 'OPEN' then
    raise exception 'NOT_OPEN';
  end if;

  update public.project_ai_allowances a
  set reserved_cents = a.reserved_cents - v_res.estimated_cents,
      updated_at = now()
  where a.project_id = v_res.project_id and a.owner_id = p_owner_id;

  update public.project_ai_allowance_reservations
  set status = 'RELEASED', closed_at = now()
  where id = v_res.id;

  insert into public.project_ai_usage_events (
    project_id, owner_id, reservation_id, event_type, amount_cents, detail, idempotency_key
  ) values (
    v_res.project_id, p_owner_id, v_res.id, 'RELEASE', v_res.estimated_cents,
    'Released unused reservation', p_idempotency_key
  );

  return true;
end;
$$;

-- Public RPC wrappers (PostgREST-callable). Owner must match auth.uid().
create or replace function public.reserve_project_ai_allowance(
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
begin
  if p_owner_id is distinct from auth.uid() then
    raise exception 'OWNER_MISMATCH';
  end if;
  return private.reserve_project_ai_allowance(
    p_owner_id, p_project_id, p_task_key, p_estimated_cents, p_idempotency_key
  );
end;
$$;

create or replace function public.reconcile_project_ai_allowance(
  p_owner_id uuid,
  p_reservation_id uuid,
  p_actual_cents bigint,
  p_idempotency_key text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_owner_id is distinct from auth.uid() then
    raise exception 'OWNER_MISMATCH';
  end if;
  return private.reconcile_project_ai_allowance(
    p_owner_id, p_reservation_id, p_actual_cents, p_idempotency_key
  );
end;
$$;

create or replace function public.release_project_ai_allowance(
  p_owner_id uuid,
  p_reservation_id uuid,
  p_idempotency_key text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_owner_id is distinct from auth.uid() then
    raise exception 'OWNER_MISMATCH';
  end if;
  return private.release_project_ai_allowance(
    p_owner_id, p_reservation_id, p_idempotency_key
  );
end;
$$;

revoke all on function public.reserve_project_ai_allowance(uuid, uuid, text, bigint, text) from public;
revoke all on function public.reconcile_project_ai_allowance(uuid, uuid, bigint, text) from public;
revoke all on function public.release_project_ai_allowance(uuid, uuid, text) from public;
grant execute on function public.reserve_project_ai_allowance(uuid, uuid, text, bigint, text) to authenticated;
grant execute on function public.reconcile_project_ai_allowance(uuid, uuid, bigint, text) to authenticated;
grant execute on function public.release_project_ai_allowance(uuid, uuid, text) to authenticated;

revoke all on function private.reconcile_project_ai_allowance(uuid, uuid, bigint, text) from public;
revoke all on function private.release_project_ai_allowance(uuid, uuid, text) from public;
grant execute on function private.reconcile_project_ai_allowance(uuid, uuid, bigint, text) to authenticated;
grant execute on function private.release_project_ai_allowance(uuid, uuid, text) to authenticated;

-- Durable provider dispatch identity (duplicate-dispatch protection across restarts)
create table if not exists public.codegen_provider_dispatches (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  remote_development_task_id uuid not null references public.remote_development_tasks (id) on delete cascade,
  reservation_id uuid references public.project_ai_allowance_reservations (id) on delete set null,
  provider_id text not null,
  model text not null,
  mode text not null
    constraint codegen_dispatches_mode_check check (mode in ('MOCK_GENERATION', 'LIVE_PROVIDER')),
  status text not null
    constraint codegen_dispatches_status_check check (
      status in ('STARTED', 'SUCCEEDED', 'FAILED', 'RELEASED')
    ),
  idempotency_key text not null
    constraint codegen_dispatches_idem_len check (char_length(trim(idempotency_key)) between 8 and 200),
  detail text not null default ''
    constraint codegen_dispatches_detail_len check (char_length(detail) <= 4000),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint codegen_dispatches_owner_idem unique (owner_id, idempotency_key)
);

create index if not exists codegen_dispatches_task_idx
  on public.codegen_provider_dispatches (remote_development_task_id, created_at desc);

alter table public.codegen_provider_dispatches enable row level security;
alter table public.codegen_provider_dispatches force row level security;

drop policy if exists codegen_dispatches_owner_all on public.codegen_provider_dispatches;
create policy codegen_dispatches_owner_all on public.codegen_provider_dispatches
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.codegen_provider_dispatches from anon, authenticated;
grant select, insert, update on public.codegen_provider_dispatches to authenticated;
