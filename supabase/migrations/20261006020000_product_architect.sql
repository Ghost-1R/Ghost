-- Ghost V6 Product Architect.
-- Authoritative product specification for a project after Strategy.
-- Does not reset data. Append-only architecture status history.
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.product_architecture_status as enum (
  'DRAFT',
  'DEFINING',
  'REVIEW',
  'APPROVED',
  'BUILD_READY'
);

create type public.product_actor as enum (
  'FOUNDER',
  'GHOST_RECOMMENDATION',
  'DETERMINISTIC_RULE'
);

create type public.requirement_type as enum (
  'FUNCTIONAL',
  'NON_FUNCTIONAL',
  'SECURITY',
  'PERFORMANCE',
  'UX',
  'OPERATIONAL'
);

create type public.requirement_approval as enum (
  'PROPOSED',
  'ACCEPTED',
  'REJECTED',
  'RETIRED'
);

create type public.feature_status as enum (
  'PROPOSED',
  'APPROVED',
  'BUILD_READY',
  'IN_PROGRESS',
  'VERIFIED'
);

create type public.product_priority as enum (
  'CRITICAL',
  'HIGH',
  'NORMAL',
  'LOW'
);

create type public.product_question_status as enum (
  'OPEN',
  'ESCALATED',
  'RESOLVED',
  'CLOSED'
);

create type public.dependency_kind as enum (
  'FEATURE',
  'REQUIREMENT',
  'DECISION',
  'EXTERNAL',
  'ARCHITECTURE_WORK'
);

create type public.dependency_status as enum (
  'PROPOSED',
  'CONFIRMED',
  'UNRESOLVED'
);

-- ---------------------------------------------------------------------------
-- Product architectures (one per project)
-- ---------------------------------------------------------------------------

create table public.product_architectures (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  idea_id uuid references public.ideas (id) on delete set null,
  strategy_id uuid references public.idea_strategies (id) on delete set null,
  what text not null default '',
  why text not null default '',
  who text not null default '',
  outcome text not null default '',
  non_goals jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  constraints_json jsonb not null default '[]'::jsonb,
  status public.product_architecture_status not null default 'DRAFT',
  note text not null default '',
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_architectures_one_per_project unique (project_id),
  constraint product_architectures_what_length check (char_length(what) <= 4000),
  constraint product_architectures_why_length check (char_length(why) <= 4000),
  constraint product_architectures_who_length check (char_length(who) <= 2000),
  constraint product_architectures_outcome_length check (char_length(outcome) <= 4000),
  constraint product_architectures_note_length check (char_length(note) <= 4000)
);

create index product_architectures_project_idx on public.product_architectures (project_id);
create index product_architectures_status_idx on public.product_architectures (status, updated_at desc);

comment on table public.product_architectures is
  'Authoritative Product Architect record for a project. AI proposals are not approved until founder action.';

create table public.product_architecture_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.product_architectures (id) on delete cascade,
  from_status public.product_architecture_status,
  to_status public.product_architecture_status not null,
  changed_at timestamptz not null default pg_catalog.now(),
  changed_by uuid references auth.users (id) on delete set null,
  actor public.product_actor not null default 'FOUNDER',
  reason text not null,
  constraint product_architecture_transitions_reason_present check (char_length(trim(reason)) between 1 and 2000)
);

create index product_architecture_transitions_arch_idx
  on public.product_architecture_transitions (architecture_id, changed_at desc);

create or replace function private.guard_product_architecture_transition_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'product architecture transitions are append-only'
    using errcode = '42501';
end;
$$;

create trigger product_architecture_transitions_no_update
  before update on public.product_architecture_transitions
  for each row execute function private.guard_product_architecture_transition_immutable();

create trigger product_architecture_transitions_no_delete
  before delete on public.product_architecture_transitions
  for each row execute function private.guard_product_architecture_transition_immutable();

-- ---------------------------------------------------------------------------
-- Requirements / features / flows / questions / dependencies
-- ---------------------------------------------------------------------------

create table public.product_requirements (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.product_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  title text not null,
  description text not null default '',
  req_type public.requirement_type not null default 'FUNCTIONAL',
  priority public.product_priority not null default 'NORMAL',
  approval_status public.requirement_approval not null default 'PROPOSED',
  acceptance_criteria jsonb not null default '[]'::jsonb,
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_requirements_human_id_format check (human_id ~ '^REQ-[0-9]{3,}$'),
  constraint product_requirements_human_unique unique (architecture_id, human_id),
  constraint product_requirements_title_present check (char_length(trim(title)) between 1 and 200),
  constraint product_requirements_description_length check (char_length(description) <= 8000),
  constraint product_requirements_source_length check (char_length(trim(source)) between 1 and 200),
  constraint product_requirements_provenance_length check (char_length(trim(provenance)) between 1 and 200)
);

create index product_requirements_arch_status_idx
  on public.product_requirements (architecture_id, approval_status, created_at desc);
create index product_requirements_project_idx
  on public.product_requirements (project_id, approval_status);

create table public.product_features (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.product_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  name text not null,
  purpose text not null default '',
  priority public.product_priority not null default 'NORMAL',
  status public.feature_status not null default 'PROPOSED',
  acceptance_criteria jsonb not null default '[]'::jsonb,
  source text not null default 'founder',
  provenance text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_features_human_id_format check (human_id ~ '^FEAT-[0-9]{3,}$'),
  constraint product_features_human_unique unique (architecture_id, human_id),
  constraint product_features_name_present check (char_length(trim(name)) between 1 and 200),
  constraint product_features_purpose_length check (char_length(purpose) <= 4000),
  constraint product_features_source_length check (char_length(trim(source)) between 1 and 200),
  constraint product_features_provenance_length check (char_length(trim(provenance)) between 1 and 200)
);

create index product_features_arch_status_idx
  on public.product_features (architecture_id, status, created_at desc);

create table public.product_feature_requirements (
  feature_id uuid not null references public.product_features (id) on delete cascade,
  requirement_id uuid not null references public.product_requirements (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (feature_id, requirement_id)
);

create table public.product_flows (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.product_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  human_id text not null,
  name text not null,
  actor text not null default '',
  starting_condition text not null default '',
  steps jsonb not null default '[]'::jsonb,
  expected_outcome text not null default '',
  edge_cases jsonb not null default '[]'::jsonb,
  feature_id uuid references public.product_features (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_flows_human_id_format check (human_id ~ '^FLOW-[0-9]{3,}$'),
  constraint product_flows_human_unique unique (architecture_id, human_id),
  constraint product_flows_name_present check (char_length(trim(name)) between 1 and 200)
);

create index product_flows_arch_idx on public.product_flows (architecture_id, created_at desc);

create table public.product_questions (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.product_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  question text not null,
  status public.product_question_status not null default 'OPEN',
  decision_id uuid references public.project_decisions (id) on delete set null,
  next_action_id uuid references public.next_actions (id) on delete set null,
  resolution text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_questions_question_present check (char_length(trim(question)) between 1 and 2000),
  constraint product_questions_resolution_length check (char_length(resolution) <= 4000)
);

create index product_questions_arch_status_idx
  on public.product_questions (architecture_id, status, created_at desc);

create table public.product_dependencies (
  id uuid primary key default extensions.gen_random_uuid(),
  architecture_id uuid not null references public.product_architectures (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  from_kind public.dependency_kind not null,
  from_ref text not null,
  to_kind public.dependency_kind not null,
  to_ref text not null,
  status public.dependency_status not null default 'PROPOSED',
  note text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  constraint product_dependencies_from_ref_present check (char_length(trim(from_ref)) between 1 and 200),
  constraint product_dependencies_to_ref_present check (char_length(trim(to_ref)) between 1 and 200),
  constraint product_dependencies_note_length check (char_length(note) <= 2000)
);

create index product_dependencies_arch_idx on public.product_dependencies (architecture_id, created_at desc);

-- Optional Decision Inbox link for product-architecture decisions.
alter table public.project_decisions
  add column if not exists product_architecture_id uuid references public.product_architectures (id) on delete set null;

create index if not exists project_decisions_product_architecture_idx
  on public.project_decisions (product_architecture_id)
  where product_architecture_id is not null;

-- ---------------------------------------------------------------------------
-- Ownership helper + transition RPC
-- ---------------------------------------------------------------------------

create or replace function private.owns_product_architecture(target_architecture_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.product_architectures pa
    where pa.id = target_architecture_id
      and (select private.owns_project(pa.project_id))
  );
$$;

revoke all on function private.owns_product_architecture(uuid) from public, anon;
grant execute on function private.owns_product_architecture(uuid) to authenticated;

create or replace function public.record_product_architecture_transition(
  target_architecture_id uuid,
  next_status public.product_architecture_status,
  transition_reason text,
  transition_actor public.product_actor default 'FOUNDER'
)
returns public.product_architecture_transitions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.product_architecture_status;
  history public.product_architecture_transitions%rowtype;
begin
  if not (select private.owns_product_architecture(target_architecture_id)) then
    raise exception 'product architecture is not visible'
      using errcode = '42501';
  end if;

  if char_length(trim(transition_reason)) < 1 then
    raise exception 'transition reason is required';
  end if;

  select status into current_status
  from public.product_architectures
  where id = target_architecture_id
  for update;

  if current_status is null then
    raise exception 'product architecture is not visible'
      using errcode = '42501';
  end if;

  if current_status = next_status then
    raise exception 'product architecture status is already %', next_status;
  end if;

  if not (
    (current_status = 'DRAFT' and next_status in ('DEFINING', 'REVIEW'))
    or (current_status = 'DEFINING' and next_status in ('DRAFT', 'REVIEW'))
    or (current_status = 'REVIEW' and next_status in ('DEFINING', 'APPROVED', 'DRAFT'))
    or (current_status = 'APPROVED' and next_status in ('REVIEW', 'BUILD_READY', 'DEFINING'))
    or (current_status = 'BUILD_READY' and next_status in ('APPROVED', 'REVIEW'))
  ) then
    raise exception 'illegal product architecture transition from % to %', current_status, next_status;
  end if;

  update public.product_architectures
  set
    status = next_status,
    approved_at = case
      when next_status in ('APPROVED', 'BUILD_READY') then coalesce(approved_at, pg_catalog.now())
      else approved_at
    end,
    approved_by = case
      when next_status in ('APPROVED', 'BUILD_READY') and approved_by is null then (select auth.uid())
      else approved_by
    end,
    updated_at = pg_catalog.now()
  where id = target_architecture_id;

  insert into public.product_architecture_transitions (
    architecture_id, from_status, to_status, changed_by, actor, reason
  ) values (
    target_architecture_id,
    current_status,
    next_status,
    (select auth.uid()),
    transition_actor,
    trim(transition_reason)
  )
  returning * into history;

  return history;
end;
$$;

revoke all on function public.record_product_architecture_transition(uuid, public.product_architecture_status, text, public.product_actor) from public, anon;
grant execute on function public.record_product_architecture_transition(uuid, public.product_architecture_status, text, public.product_actor) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.product_architectures enable row level security;
alter table public.product_architectures force row level security;
alter table public.product_architecture_transitions enable row level security;
alter table public.product_architecture_transitions force row level security;
alter table public.product_requirements enable row level security;
alter table public.product_requirements force row level security;
alter table public.product_features enable row level security;
alter table public.product_features force row level security;
alter table public.product_feature_requirements enable row level security;
alter table public.product_feature_requirements force row level security;
alter table public.product_flows enable row level security;
alter table public.product_flows force row level security;
alter table public.product_questions enable row level security;
alter table public.product_questions force row level security;
alter table public.product_dependencies enable row level security;
alter table public.product_dependencies force row level security;

create policy product_architectures_select on public.product_architectures
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy product_architectures_insert on public.product_architectures
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy product_architectures_update on public.product_architectures
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy product_architectures_delete on public.product_architectures
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy product_architecture_transitions_select on public.product_architecture_transitions
  for select to authenticated
  using ((select private.owns_product_architecture(architecture_id)));

create policy product_architecture_transitions_insert on public.product_architecture_transitions
  for insert to authenticated
  with check ((select private.owns_product_architecture(architecture_id)));

create policy product_requirements_select on public.product_requirements
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy product_requirements_insert on public.product_requirements
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy product_requirements_update on public.product_requirements
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy product_requirements_delete on public.product_requirements
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy product_features_select on public.product_features
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy product_features_insert on public.product_features
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy product_features_update on public.product_features
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy product_features_delete on public.product_features
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy product_feature_requirements_select on public.product_feature_requirements
  for select to authenticated
  using (
    exists (
      select 1 from public.product_features f
      where f.id = feature_id and (select private.owns_project(f.project_id))
    )
  );

create policy product_feature_requirements_insert on public.product_feature_requirements
  for insert to authenticated
  with check (
    exists (
      select 1 from public.product_features f
      where f.id = feature_id and (select private.owns_project(f.project_id))
    )
    and exists (
      select 1 from public.product_requirements r
      where r.id = requirement_id and (select private.owns_project(r.project_id))
    )
  );

create policy product_feature_requirements_delete on public.product_feature_requirements
  for delete to authenticated
  using (
    exists (
      select 1 from public.product_features f
      where f.id = feature_id and (select private.owns_project(f.project_id))
    )
  );

create policy product_flows_select on public.product_flows
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy product_flows_insert on public.product_flows
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy product_flows_update on public.product_flows
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy product_flows_delete on public.product_flows
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy product_questions_select on public.product_questions
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy product_questions_insert on public.product_questions
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy product_questions_update on public.product_questions
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy product_questions_delete on public.product_questions
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy product_dependencies_select on public.product_dependencies
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy product_dependencies_insert on public.product_dependencies
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy product_dependencies_update on public.product_dependencies
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy product_dependencies_delete on public.product_dependencies
  for delete to authenticated
  using ((select private.owns_project(project_id)));

revoke all on public.product_architectures from public, anon;
revoke all on public.product_architecture_transitions from public, anon;
revoke all on public.product_requirements from public, anon;
revoke all on public.product_features from public, anon;
revoke all on public.product_feature_requirements from public, anon;
revoke all on public.product_flows from public, anon;
revoke all on public.product_questions from public, anon;
revoke all on public.product_dependencies from public, anon;

grant select, insert, update, delete on public.product_architectures to authenticated;
grant select, insert on public.product_architecture_transitions to authenticated;
grant select, insert, update, delete on public.product_requirements to authenticated;
grant select, insert, update, delete on public.product_features to authenticated;
grant select, insert, delete on public.product_feature_requirements to authenticated;
grant select, insert, update, delete on public.product_flows to authenticated;
grant select, insert, update, delete on public.product_questions to authenticated;
grant select, insert, update, delete on public.product_dependencies to authenticated;
