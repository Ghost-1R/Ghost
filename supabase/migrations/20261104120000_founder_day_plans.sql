-- Founder day plans for Arrange my day (local-first).
-- Do not apply to production without separate founder approval.

create table if not exists public.founder_day_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  plan_date date not null,
  items jsonb not null default '[]'::jsonb,
  saved_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint founder_day_plans_owner_date unique (owner_id, plan_date),
  constraint founder_day_plans_items_is_array check (jsonb_typeof(items) = 'array')
);

comment on table public.founder_day_plans is
  'Per-founder ordered day plan for a calendar date. Items reference existing tasks/actions/decisions — Ghost does not invent work.';

drop trigger if exists founder_day_plans_set_updated_at on public.founder_day_plans;
create trigger founder_day_plans_set_updated_at
  before update on public.founder_day_plans
  for each row execute function private.set_updated_at();

alter table public.founder_day_plans enable row level security;
alter table public.founder_day_plans force row level security;

drop policy if exists founder_day_plans_select on public.founder_day_plans;
create policy founder_day_plans_select on public.founder_day_plans
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists founder_day_plans_insert on public.founder_day_plans;
create policy founder_day_plans_insert on public.founder_day_plans
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists founder_day_plans_update on public.founder_day_plans;
create policy founder_day_plans_update on public.founder_day_plans
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists founder_day_plans_delete on public.founder_day_plans;
create policy founder_day_plans_delete on public.founder_day_plans
  for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.founder_day_plans to authenticated;
