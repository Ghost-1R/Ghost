-- Underworld: thin goal/plan/step orchestration over existing assignments + agent_tasks.
-- LIVE gates unchanged. Additive only.

create type public.underworld_goal_status as enum (
  'DRAFT',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED'
);

create type public.underworld_plan_status as enum (
  'DRAFT',
  'PREVIEWED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED'
);

create type public.underworld_step_role as enum (
  'PLANNER',
  'EXECUTOR',
  'REVIEWER'
);

create type public.underworld_step_status as enum (
  'PENDING',
  'READY',
  'CLAIMED',
  'RUNNING',
  'CHECKPOINT',
  'WAITING_REVIEW',
  'WAITING_FOUNDER',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BLOCKED'
);

create type public.underworld_assignee_kind as enum (
  'HUMAN',
  'AI'
);

create table public.underworld_goals (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  objective text not null default '',
  classification text not null default 'INTERNAL'
    check (classification in ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
  budget_cents integer not null default 0 check (budget_cents >= 0),
  stop_condition text not null default 'Founder approval required for consequential actions.',
  status public.underworld_goal_status not null default 'DRAFT',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint underworld_goals_title_length check (char_length(trim(title)) between 1 and 200)
);

create table public.underworld_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.underworld_goals (id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  status public.underworld_plan_status not null default 'DRAFT',
  scope_summary text not null default '',
  scope_fingerprint text not null default '',
  previewed_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint underworld_plans_goal_version unique (goal_id, version)
);

create table public.underworld_steps (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.underworld_plans (id) on delete cascade,
  seq integer not null check (seq >= 1),
  title text not null,
  role public.underworld_step_role not null,
  assignee_kind public.underworld_assignee_kind not null,
  depends_on uuid[] not null default '{}'::uuid[],
  assignment_id uuid,
  agent_task_id uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  status public.underworld_step_status not null default 'PENDING',
  stop_condition text not null default '',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  last_error text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint underworld_steps_plan_seq unique (plan_id, seq),
  constraint underworld_steps_title_length check (char_length(trim(title)) between 1 and 200)
);

create index underworld_goals_project_idx on public.underworld_goals (project_id, created_at desc);
create index underworld_plans_goal_idx on public.underworld_plans (goal_id, version desc);
create index underworld_steps_plan_idx on public.underworld_steps (plan_id, seq);
create index underworld_steps_lease_idx on public.underworld_steps (lease_expires_at)
  where status in ('CLAIMED', 'RUNNING');

create trigger underworld_goals_set_updated_at
  before update on public.underworld_goals
  for each row execute function private.set_updated_at();

create trigger underworld_plans_set_updated_at
  before update on public.underworld_plans
  for each row execute function private.set_updated_at();

create trigger underworld_steps_set_updated_at
  before update on public.underworld_steps
  for each row execute function private.set_updated_at();

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='work_assignments') then
    alter table public.underworld_steps
      add constraint underworld_steps_assignment_fk
      foreign key (assignment_id) references public.work_assignments (id) on delete set null;
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='agent_tasks') then
    alter table public.underworld_steps
      add constraint underworld_steps_agent_task_fk
      foreign key (agent_task_id) references public.agent_tasks (id) on delete set null;
  end if;
end
$$;

-- Atomic claim with expiring lease (returns claimed step id or null).
create or replace function public.claim_underworld_step(
  p_step_id uuid,
  p_lease_owner text,
  p_lease_seconds integer default 120
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_lease_owner is null or char_length(trim(p_lease_owner)) < 1 then
    raise exception 'lease owner required';
  end if;

  update public.underworld_steps as step
  set
    status = 'CLAIMED',
    lease_owner = p_lease_owner,
    lease_expires_at = pg_catalog.now() + make_interval(secs => greatest(p_lease_seconds, 30)),
    attempt_count = step.attempt_count + 1,
    updated_at = pg_catalog.now()
  where step.id = p_step_id
    and step.status in ('READY', 'CHECKPOINT')
    and step.attempt_count < step.max_attempts
    and (
      step.lease_expires_at is null
      or step.lease_expires_at < pg_catalog.now()
      or step.lease_owner = p_lease_owner
    )
  returning step.id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_underworld_step(uuid, text, integer) from public, anon;
grant execute on function public.claim_underworld_step(uuid, text, integer) to authenticated;

alter table public.underworld_goals enable row level security;
alter table public.underworld_plans enable row level security;
alter table public.underworld_steps enable row level security;

create policy underworld_goals_select on public.underworld_goals
  for select to authenticated
  using ((select private.can_select_project(project_id)));

create policy underworld_goals_owner_write on public.underworld_goals
  for all to authenticated
  using ((select private.can_admin_project(project_id)))
  with check ((select private.can_admin_project(project_id)));

create policy underworld_plans_select on public.underworld_plans
  for select to authenticated
  using (
    exists (
      select 1 from public.underworld_goals g
      where g.id = goal_id and (select private.can_select_project(g.project_id))
    )
  );

create policy underworld_plans_admin_write on public.underworld_plans
  for all to authenticated
  using (
    exists (
      select 1 from public.underworld_goals g
      where g.id = goal_id and (select private.can_admin_project(g.project_id))
    )
  )
  with check (
    exists (
      select 1 from public.underworld_goals g
      where g.id = goal_id and (select private.can_admin_project(g.project_id))
    )
  );

create policy underworld_steps_select on public.underworld_steps
  for select to authenticated
  using (
    exists (
      select 1
      from public.underworld_plans p
      join public.underworld_goals g on g.id = p.goal_id
      where p.id = plan_id and (select private.can_select_project(g.project_id))
    )
  );

create policy underworld_steps_admin_write on public.underworld_steps
  for all to authenticated
  using (
    exists (
      select 1
      from public.underworld_plans p
      join public.underworld_goals g on g.id = p.goal_id
      where p.id = plan_id and (select private.can_admin_project(g.project_id))
    )
  )
  with check (
    exists (
      select 1
      from public.underworld_plans p
      join public.underworld_goals g on g.id = p.goal_id
      where p.id = plan_id and (select private.can_admin_project(g.project_id))
    )
  );
