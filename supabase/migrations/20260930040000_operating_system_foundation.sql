-- Ghost V4 operating system foundation.
-- Lifecycle history, next-action provenance, founder decisions, and repository association.
-- Does not reset data. Does not rewrite history. Append-only where history matters.
-- Target project: Ghost-1R wzwrrleqfylhuxfbukfu.
-- Apply with: supabase db push --linked (Ghost org credentials) or the Supabase SQL editor.
-- This file alone does not mutate production until it is applied.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.lifecycle_stage as enum (
  'IDEA',
  'STRATEGY',
  'DESIGN',
  'BUILD',
  'TEST',
  'DEPLOY',
  'LEARN',
  'COMPLETED'
);

create type public.lifecycle_actor as enum (
  'FOUNDER',
  'DETERMINISTIC_RULE',
  'SYSTEM_SEED'
);

create type public.action_priority as enum (
  'HIGH',
  'NORMAL',
  'LOW'
);

create type public.action_provenance as enum (
  'FACT',
  'RECOMMENDATION',
  'FOUNDER_APPROVED_ACTION'
);

create type public.decision_status as enum (
  'OPEN',
  'RESOLVED',
  'CANCELLED'
);

alter type public.action_status add value if not exists 'IN_PROGRESS';
alter type public.action_status add value if not exists 'BLOCKED';

-- ---------------------------------------------------------------------------
-- Project lifecycle stage (current) + append-only history
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists lifecycle_stage public.lifecycle_stage not null default 'IDEA';

comment on column public.projects.lifecycle_stage is
  'Authoritative lifecycle stage. Changed only through record_lifecycle_transition. Never guessed by a model.';

create table public.lifecycle_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  from_stage public.lifecycle_stage,
  to_stage public.lifecycle_stage not null,
  changed_at timestamptz not null default pg_catalog.now(),
  changed_by uuid references auth.users (id) on delete set null,
  actor public.lifecycle_actor not null,
  reason text not null,
  evidence_kind text,
  evidence_id uuid,
  constraint lifecycle_transitions_reason_present check (char_length(trim(reason)) between 1 and 1000),
  constraint lifecycle_transitions_evidence_kind_length check (
    evidence_kind is null or char_length(trim(evidence_kind)) between 1 and 80
  ),
  constraint lifecycle_transitions_changed check (from_stage is distinct from to_stage)
);

create index lifecycle_transitions_project_changed_idx
  on public.lifecycle_transitions (project_id, changed_at desc);

comment on table public.lifecycle_transitions is
  'Append-only lifecycle history. Rows are never updated or deleted by the application.';

create or replace function private.reject_lifecycle_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'lifecycle history is append-only'
    using errcode = '42501';
end;
$$;

revoke all on function private.reject_lifecycle_history_mutation() from public, anon, authenticated, service_role;

create trigger lifecycle_transitions_append_only
  before update or delete on public.lifecycle_transitions
  for each row execute function private.reject_lifecycle_history_mutation();

create trigger lifecycle_transitions_no_truncate
  before truncate on public.lifecycle_transitions
  for each statement execute function private.reject_lifecycle_history_mutation();

-- Seed current stage from the existing operational status without inventing progress.
update public.projects
set lifecycle_stage = case status
  when 'IDEA' then 'IDEA'::public.lifecycle_stage
  when 'PLANNING' then 'STRATEGY'::public.lifecycle_stage
  when 'READY' then 'DESIGN'::public.lifecycle_stage
  when 'BUILDING' then 'BUILD'::public.lifecycle_stage
  when 'READY_FOR_INSPECTION' then 'TEST'::public.lifecycle_stage
  when 'VERIFIED' then 'TEST'::public.lifecycle_stage
  when 'DEPLOYED' then 'DEPLOY'::public.lifecycle_stage
  when 'COMPLETED' then 'COMPLETED'::public.lifecycle_stage
  when 'BLOCKED' then 'BUILD'::public.lifecycle_stage
  when 'NEEDS_DECISION' then 'BUILD'::public.lifecycle_stage
  when 'ON_HOLD' then 'BUILD'::public.lifecycle_stage
  else 'IDEA'::public.lifecycle_stage
end
where true;

insert into public.lifecycle_transitions (project_id, from_stage, to_stage, actor, reason, evidence_kind)
select
  project.id,
  null,
  project.lifecycle_stage,
  'SYSTEM_SEED'::public.lifecycle_actor,
  'Seeded from the existing project status at V4 cutover. This is not a founder-approved promotion.',
  'project_status'
from public.projects as project
where not exists (
  select 1 from public.lifecycle_transitions as history where history.project_id = project.id
);

-- ---------------------------------------------------------------------------
-- Next actions: provenance and priority (statuses IN_PROGRESS/BLOCKED added above)
-- ---------------------------------------------------------------------------

alter table public.next_actions
  add column if not exists priority public.action_priority not null default 'NORMAL',
  add column if not exists provenance public.action_provenance not null default 'FOUNDER_APPROVED_ACTION',
  add column if not exists source_kind text not null default 'founder_instruction',
  add column if not exists source_ref text,
  add column if not exists requires_decision boolean not null default false,
  add column if not exists decision_id uuid,
  add column if not exists requirement_id uuid references public.project_knowledge (id) on delete set null;

alter table public.next_actions
  drop constraint if exists next_actions_source_kind_length,
  drop constraint if exists next_actions_source_ref_length,
  drop constraint if exists next_actions_blocked_not_done;

alter table public.next_actions
  add constraint next_actions_source_kind_length check (char_length(trim(source_kind)) between 1 and 80),
  add constraint next_actions_source_ref_length check (
    source_ref is null or char_length(trim(source_ref)) between 1 and 200
  );

comment on column public.next_actions.provenance is
  'FACT is observed truth. RECOMMENDATION is Ghost advice. FOUNDER_APPROVED_ACTION is authoritative work.';

comment on column public.next_actions.requires_decision is
  'When true, the action waits on a founder decision and must not be treated as ready work.';

-- ---------------------------------------------------------------------------
-- Founder decision inbox (first-class; separate from project_knowledge DECISION facts)
-- ---------------------------------------------------------------------------

create table public.project_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  question text not null,
  context text not null default '',
  status public.decision_status not null default 'OPEN',
  options jsonb not null default '[]'::jsonb,
  recommendation text,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  selected_option text,
  founder_response text,
  rationale text,
  constraint project_decisions_title_length check (char_length(trim(title)) between 1 and 200),
  constraint project_decisions_question_present check (char_length(trim(question)) between 1 and 2000),
  constraint project_decisions_context_length check (char_length(context) <= 8000),
  constraint project_decisions_resolved_timestamp check (
    status = 'OPEN' or resolved_at is not null
  ),
  constraint project_decisions_open_has_no_resolution check (
    status <> 'OPEN'
    or (
      resolved_at is null
      and resolved_by is null
      and selected_option is null
      and founder_response is null
    )
  )
);

create index project_decisions_project_status_idx
  on public.project_decisions (project_id, status, created_at desc);

create index project_decisions_open_idx
  on public.project_decisions (project_id)
  where status = 'OPEN';

comment on table public.project_decisions is
  'Founder judgment required. Ghost may recommend. Ghost never chooses. History is preserved on resolve.';

alter table public.next_actions
  drop constraint if exists next_actions_decision_id_fkey;

alter table public.next_actions
  add constraint next_actions_decision_id_fkey
  foreign key (decision_id) references public.project_decisions (id) on delete set null;

-- Protect the original question and options after creation.
create or replace function private.guard_project_decision_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id
    or new.title is distinct from old.title
    or new.question is distinct from old.question
    or new.context is distinct from old.context
    or new.options is distinct from old.options
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by
  then
    raise exception 'decision history fields cannot be rewritten'
      using errcode = '42501';
  end if;
  if old.status <> 'OPEN' and new.status is distinct from old.status then
    raise exception 'resolved or cancelled decisions cannot change status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger project_decisions_guard_history
  before update on public.project_decisions
  for each row execute function private.guard_project_decision_history();

-- ---------------------------------------------------------------------------
-- Repository association (identifiers only; never tokens)
-- ---------------------------------------------------------------------------

create table public.project_repositories (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  provider text not null default 'github',
  owner_login text not null,
  repo_name text not null,
  full_name text not null,
  html_url text not null,
  default_branch text,
  is_primary boolean not null default true,
  associated_at timestamptz not null default pg_catalog.now(),
  associated_by uuid references auth.users (id) on delete set null,
  constraint project_repositories_provider check (provider = 'github'),
  constraint project_repositories_owner_length check (char_length(trim(owner_login)) between 1 and 100),
  constraint project_repositories_name_length check (char_length(trim(repo_name)) between 1 and 100),
  constraint project_repositories_full_name_match check (full_name = owner_login || '/' || repo_name),
  constraint project_repositories_url_length check (char_length(trim(html_url)) between 1 and 300)
);

create unique index project_repositories_one_primary_idx
  on public.project_repositories (project_id)
  where is_primary;

create unique index project_repositories_project_full_name_idx
  on public.project_repositories (project_id, full_name);

comment on table public.project_repositories is
  'Explicit founder/user association of a repository to a project. Names alone never create an association. No credentials are stored.';

create table public.repository_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  repository_id uuid not null references public.project_repositories (id) on delete cascade,
  observed_at timestamptz not null default pg_catalog.now(),
  branch text,
  commit_sha text,
  commit_message text,
  open_pull_requests integer,
  summary text not null default '',
  constraint repository_observations_branch_length check (
    branch is null or char_length(trim(branch)) between 1 and 200
  ),
  constraint repository_observations_commit_length check (
    commit_sha is null or char_length(trim(commit_sha)) between 7 and 80
  ),
  constraint repository_observations_message_length check (
    commit_message is null or char_length(commit_message) <= 2000
  ),
  constraint repository_observations_pr_nonnegative check (
    open_pull_requests is null or open_pull_requests >= 0
  ),
  constraint repository_observations_summary_length check (char_length(summary) <= 4000)
);

create index repository_observations_project_observed_idx
  on public.repository_observations (project_id, observed_at desc);

comment on table public.repository_observations is
  'Read-only GitHub evidence. A commit here is not feature-complete, tested, deployed, or presentation-ready.';

create or replace function private.reject_repository_observation_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'repository observations are append-only'
    using errcode = '42501';
end;
$$;

revoke all on function private.reject_repository_observation_mutation() from public, anon, authenticated, service_role;

create trigger repository_observations_append_only
  before update or delete on public.repository_observations
  for each row execute function private.reject_repository_observation_mutation();

create trigger repository_observations_no_truncate
  before truncate on public.repository_observations
  for each statement execute function private.reject_repository_observation_mutation();

-- ---------------------------------------------------------------------------
-- Transition RPC: founder or documented deterministic rule only
-- ---------------------------------------------------------------------------

create or replace function public.record_lifecycle_transition(
  target_project_id uuid,
  next_stage public.lifecycle_stage,
  transition_reason text,
  transition_actor public.lifecycle_actor default 'FOUNDER',
  evidence_kind text default null,
  evidence_id uuid default null
)
returns public.lifecycle_transitions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_stage public.lifecycle_stage;
  history public.lifecycle_transitions%rowtype;
begin
  if not (select private.owns_project(target_project_id)) then
    raise exception 'project is not visible'
      using errcode = '42501';
  end if;

  if char_length(trim(transition_reason)) < 1 then
    raise exception 'transition reason is required';
  end if;

  if transition_actor = 'SYSTEM_SEED' then
    raise exception 'SYSTEM_SEED is reserved for the V4 cutover';
  end if;

  select lifecycle_stage into current_stage
  from public.projects
  where id = target_project_id
  for update;

  if current_stage is null then
    raise exception 'project is not visible'
      using errcode = '42501';
  end if;

  if current_stage = next_stage then
    raise exception 'lifecycle stage is already %', next_stage;
  end if;

  -- Legal graph. Ghost recommendations still require this RPC with FOUNDER or DETERMINISTIC_RULE.
  if not (
    (current_stage = 'IDEA' and next_stage in ('STRATEGY', 'COMPLETED'))
    or (current_stage = 'STRATEGY' and next_stage in ('IDEA', 'DESIGN', 'COMPLETED'))
    or (current_stage = 'DESIGN' and next_stage in ('STRATEGY', 'BUILD', 'COMPLETED'))
    or (current_stage = 'BUILD' and next_stage in ('DESIGN', 'TEST', 'COMPLETED'))
    or (current_stage = 'TEST' and next_stage in ('BUILD', 'DEPLOY', 'COMPLETED'))
    or (current_stage = 'DEPLOY' and next_stage in ('TEST', 'LEARN', 'COMPLETED'))
    or (current_stage = 'LEARN' and next_stage in ('DEPLOY', 'IDEA', 'STRATEGY', 'COMPLETED'))
    or (current_stage = 'COMPLETED' and next_stage in ('LEARN', 'IDEA'))
  ) then
    raise exception 'illegal lifecycle transition from % to %', current_stage, next_stage;
  end if;

  update public.projects
  set lifecycle_stage = next_stage
  where id = target_project_id;

  insert into public.lifecycle_transitions (
    project_id,
    from_stage,
    to_stage,
    changed_by,
    actor,
    reason,
    evidence_kind,
    evidence_id
  )
  values (
    target_project_id,
    current_stage,
    next_stage,
    (select auth.uid()),
    transition_actor,
    trim(transition_reason),
    evidence_kind,
    evidence_id
  )
  returning * into history;

  return history;
end;
$$;

revoke all on function public.record_lifecycle_transition(uuid, public.lifecycle_stage, text, public.lifecycle_actor, text, uuid)
  from public, anon;
grant execute on function public.record_lifecycle_transition(uuid, public.lifecycle_stage, text, public.lifecycle_actor, text, uuid)
  to authenticated;

-- Resolve a decision without rewriting the original question/options.
create or replace function public.resolve_project_decision(
  target_decision_id uuid,
  next_status public.decision_status,
  selected_option text default null,
  founder_response text default null,
  rationale text default null,
  follow_up_action_title text default null,
  follow_up_action_description text default null
)
returns public.project_decisions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  decision public.project_decisions%rowtype;
  chosen_option text := selected_option;
  founder_reply text := founder_response;
  decision_rationale text := rationale;
  follow_title text := follow_up_action_title;
  follow_description text := follow_up_action_description;
begin
  if next_status not in ('RESOLVED', 'CANCELLED') then
    raise exception 'decision must resolve to RESOLVED or CANCELLED';
  end if;

  select * into decision
  from public.project_decisions
  where id = target_decision_id
  for update;

  if decision.id is null or not (select private.owns_project(decision.project_id)) then
    raise exception 'decision is not visible'
      using errcode = '42501';
  end if;

  if decision.status <> 'OPEN' then
    raise exception 'decision is already %', decision.status;
  end if;

  update public.project_decisions
  set
    status = next_status,
    resolved_at = pg_catalog.now(),
    resolved_by = (select auth.uid()),
    selected_option = case when next_status = 'RESOLVED' then chosen_option else null end,
    founder_response = founder_reply,
    rationale = decision_rationale
  where id = target_decision_id
  returning * into decision;

  -- Explicit workflow only: a RESOLVED decision may mint one founder-approved follow-up action.
  if next_status = 'RESOLVED'
    and follow_title is not null
    and char_length(trim(follow_title)) > 0
  then
    insert into public.next_actions (
      project_id,
      title,
      description,
      status,
      position,
      priority,
      provenance,
      source_kind,
      source_ref,
      requires_decision,
      decision_id
    )
    values (
      decision.project_id,
      trim(follow_title),
      coalesce(follow_description, ''),
      'OPEN',
      coalesce((select max(position) + 1 from public.next_actions where project_id = decision.project_id), 0),
      'HIGH',
      'FOUNDER_APPROVED_ACTION',
      'decision_resolution',
      decision.id::text,
      false,
      decision.id
    );

    update public.next_actions
    set status = 'OPEN',
        requires_decision = false
    where decision_id = decision.id
      and requires_decision = true
      and status in ('OPEN', 'BLOCKED');
  end if;

  return decision;
end;
$$;

revoke all on function public.resolve_project_decision(uuid, public.decision_status, text, text, text, text, text)
  from public, anon;
grant execute on function public.resolve_project_decision(uuid, public.decision_status, text, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.lifecycle_transitions enable row level security;
alter table public.lifecycle_transitions force row level security;
alter table public.project_decisions enable row level security;
alter table public.project_decisions force row level security;
alter table public.project_repositories enable row level security;
alter table public.project_repositories force row level security;
alter table public.repository_observations enable row level security;
alter table public.repository_observations force row level security;

create policy lifecycle_transitions_select on public.lifecycle_transitions
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy lifecycle_transitions_insert on public.lifecycle_transitions
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy project_decisions_select on public.project_decisions
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy project_decisions_insert on public.project_decisions
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy project_decisions_update on public.project_decisions
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy project_repositories_select on public.project_repositories
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy project_repositories_insert on public.project_repositories
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy project_repositories_update on public.project_repositories
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy project_repositories_delete on public.project_repositories
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy repository_observations_select on public.repository_observations
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy repository_observations_insert on public.repository_observations
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

revoke all on public.lifecycle_transitions from public, anon;
revoke all on public.project_decisions from public, anon;
revoke all on public.project_repositories from public, anon;
revoke all on public.repository_observations from public, anon;

grant select, insert on public.lifecycle_transitions to authenticated;
grant select, insert, update on public.project_decisions to authenticated;
grant select, insert, update, delete on public.project_repositories to authenticated;
grant select, insert on public.repository_observations to authenticated;
