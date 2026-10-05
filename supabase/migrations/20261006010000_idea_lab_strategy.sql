-- Ghost V5 Idea Lab + Strategy.
-- Durable ideas, validation, evidence, strategy, and promotion into V4 projects.
-- Does not reset data. Append-only idea state history.
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.idea_status as enum (
  'CAPTURED',
  'EXPLORING',
  'VALIDATING',
  'NEEDS_DECISION',
  'APPROVED',
  'REJECTED',
  'ARCHIVED',
  'PROMOTED'
);

create type public.idea_actor as enum (
  'FOUNDER',
  'GHOST_RECOMMENDATION',
  'DETERMINISTIC_RULE'
);

create type public.validation_status as enum (
  'OPEN',
  'IN_PROGRESS',
  'SUPPORTED',
  'REFUTED',
  'INCONCLUSIVE'
);

create type public.idea_evidence_type as enum (
  'OBSERVATION',
  'CUSTOMER_FEEDBACK',
  'TEST_RESULT',
  'METRIC',
  'DOCUMENT',
  'LINK',
  'TECHNICAL_RESULT',
  'FOUNDER_DECISION'
);

create type public.idea_readiness as enum (
  'EARLY',
  'NEEDS_EVIDENCE',
  'DECISION_READY'
);

-- ---------------------------------------------------------------------------
-- Ideas
-- ---------------------------------------------------------------------------

create table public.ideas (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  raw_idea text not null,
  summary text not null default '',
  problem text not null default '',
  target_user text not null default '',
  proposed_solution text not null default '',
  value_proposition text not null default '',
  assumptions jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  opportunities jsonb not null default '[]'::jsonb,
  constraints_json jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  recommendation text,
  status public.idea_status not null default 'CAPTURED',
  readiness public.idea_readiness not null default 'EARLY',
  note text not null default '',
  promoted_project_id uuid references public.projects (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint ideas_title_length check (char_length(trim(title)) between 1 and 200),
  constraint ideas_raw_present check (char_length(trim(raw_idea)) between 1 and 8000),
  constraint ideas_summary_length check (char_length(summary) <= 4000),
  constraint ideas_problem_length check (char_length(problem) <= 4000),
  constraint ideas_target_length check (char_length(target_user) <= 2000),
  constraint ideas_solution_length check (char_length(proposed_solution) <= 4000),
  constraint ideas_value_length check (char_length(value_proposition) <= 4000),
  constraint ideas_note_length check (char_length(note) <= 4000),
  constraint ideas_recommendation_length check (
    recommendation is null or char_length(trim(recommendation)) between 1 and 2000
  )
);

create index ideas_owner_updated_idx on public.ideas (owner_id, updated_at desc);
create index ideas_owner_status_idx on public.ideas (owner_id, status, updated_at desc);

comment on table public.ideas is
  'Founder-owned Idea Lab records. Ghost may recommend structure; founder decisions and promotion are explicit.';

create table public.idea_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  idea_id uuid not null references public.ideas (id) on delete cascade,
  from_status public.idea_status,
  to_status public.idea_status not null,
  changed_at timestamptz not null default pg_catalog.now(),
  changed_by uuid references auth.users (id) on delete set null,
  actor public.idea_actor not null,
  reason text not null,
  constraint idea_transitions_reason_present check (char_length(trim(reason)) between 1 and 1000),
  constraint idea_transitions_changed check (from_status is distinct from to_status)
);

create index idea_transitions_idea_changed_idx
  on public.idea_transitions (idea_id, changed_at desc);

create or replace function private.guard_idea_transition_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'idea transition history cannot be rewritten'
    using errcode = '42501';
end;
$$;

create trigger idea_transitions_no_update
  before update on public.idea_transitions
  for each row execute function private.guard_idea_transition_immutable();

create trigger idea_transitions_no_delete
  before delete on public.idea_transitions
  for each row execute function private.guard_idea_transition_immutable();

-- ---------------------------------------------------------------------------
-- Validation + evidence
-- ---------------------------------------------------------------------------

create table public.idea_validations (
  id uuid primary key default extensions.gen_random_uuid(),
  idea_id uuid not null references public.ideas (id) on delete cascade,
  question text not null,
  reason text not null default '',
  evidence_needed text not null default '',
  status public.validation_status not null default 'OPEN',
  result text not null default '',
  source text not null default 'founder',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint idea_validations_question_present check (char_length(trim(question)) between 1 and 2000),
  constraint idea_validations_reason_length check (char_length(reason) <= 2000),
  constraint idea_validations_evidence_needed_length check (char_length(evidence_needed) <= 2000),
  constraint idea_validations_result_length check (char_length(result) <= 4000),
  constraint idea_validations_source_length check (char_length(trim(source)) between 1 and 200)
);

create index idea_validations_idea_status_idx
  on public.idea_validations (idea_id, status, created_at desc);

create table public.idea_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  idea_id uuid not null references public.ideas (id) on delete cascade,
  evidence_type public.idea_evidence_type not null,
  statement text not null,
  source text not null default '',
  confidence text,
  provenance text not null default 'founder',
  observed_at date,
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint idea_evidence_statement_present check (char_length(trim(statement)) between 1 and 4000),
  constraint idea_evidence_source_length check (char_length(source) <= 2000),
  constraint idea_evidence_confidence_length check (
    confidence is null or char_length(trim(confidence)) between 1 and 80
  ),
  constraint idea_evidence_provenance_length check (char_length(trim(provenance)) between 1 and 200)
);

create index idea_evidence_idea_created_idx
  on public.idea_evidence (idea_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Strategy
-- ---------------------------------------------------------------------------

create table public.idea_strategies (
  id uuid primary key default extensions.gen_random_uuid(),
  idea_id uuid not null references public.ideas (id) on delete cascade,
  vision text not null default '',
  problem text not null default '',
  target_customer text not null default '',
  positioning text not null default '',
  value_proposition text not null default '',
  core_offer text not null default '',
  differentiation text not null default '',
  value_model text not null default '',
  distribution text not null default '',
  key_capabilities jsonb not null default '[]'::jsonb,
  constraints_json jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  success_measures jsonb not null default '[]'::jsonb,
  non_goals jsonb not null default '[]'::jsonb,
  initial_scope text not null default '',
  mvp text not null default '',
  not_building text not null default '',
  open_decisions jsonb not null default '[]'::jsonb,
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint idea_strategies_one_per_idea unique (idea_id)
);

comment on table public.idea_strategies is
  'Strategy drafts for an idea. Founder-approved fields become authoritative; Ghost proposals are drafts until approved.';

-- ---------------------------------------------------------------------------
-- Ownership helpers (must exist before idea-aware decision policies)
-- ---------------------------------------------------------------------------

create or replace function private.owns_idea(target_idea_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.ideas
    where id = target_idea_id
      and owner_id = (select auth.uid())
  );
$$;

revoke all on function private.owns_idea(uuid) from public, anon;
grant execute on function private.owns_idea(uuid) to authenticated;

-- Link V4 project_decisions to ideas/strategies when the decision originates there.
alter table public.project_decisions
  add column if not exists idea_id uuid references public.ideas (id) on delete set null;

alter table public.project_decisions
  add column if not exists strategy_id uuid references public.idea_strategies (id) on delete set null;

-- Idea Lab strategic decisions may exist before a project is promoted.
alter table public.project_decisions
  alter column project_id drop not null;

alter table public.project_decisions
  drop constraint if exists project_decisions_project_or_idea;

alter table public.project_decisions
  add constraint project_decisions_project_or_idea check (
    project_id is not null or idea_id is not null
  );

create index if not exists project_decisions_idea_idx
  on public.project_decisions (idea_id)
  where idea_id is not null;

drop policy if exists project_decisions_select on public.project_decisions;
drop policy if exists project_decisions_insert on public.project_decisions;
drop policy if exists project_decisions_update on public.project_decisions;

create policy project_decisions_select on public.project_decisions
  for select to authenticated
  using (
    (project_id is not null and (select private.owns_project(project_id)))
    or (idea_id is not null and (select private.owns_idea(idea_id)))
  );

create policy project_decisions_insert on public.project_decisions
  for insert to authenticated
  with check (
    (project_id is not null and (select private.owns_project(project_id)))
    or (idea_id is not null and (select private.owns_idea(idea_id)))
  );

create policy project_decisions_update on public.project_decisions
  for update to authenticated
  using (
    (project_id is not null and (select private.owns_project(project_id)))
    or (idea_id is not null and (select private.owns_idea(idea_id)))
  )
  with check (
    (project_id is not null and (select private.owns_project(project_id)))
    or (idea_id is not null and (select private.owns_idea(idea_id)))
  );

-- ---------------------------------------------------------------------------
-- Transition RPC
-- ---------------------------------------------------------------------------

create or replace function public.record_idea_transition(
  target_idea_id uuid,
  next_status public.idea_status,
  transition_reason text,
  transition_actor public.idea_actor default 'FOUNDER'
)
returns public.idea_transitions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.idea_status;
  history public.idea_transitions%rowtype;
begin
  if not (select private.owns_idea(target_idea_id)) then
    raise exception 'idea is not visible'
      using errcode = '42501';
  end if;

  if char_length(trim(transition_reason)) < 1 then
    raise exception 'transition reason is required';
  end if;

  select status into current_status
  from public.ideas
  where id = target_idea_id
  for update;

  if current_status is null then
    raise exception 'idea is not visible'
      using errcode = '42501';
  end if;

  if current_status = next_status then
    raise exception 'idea status is already %', next_status;
  end if;

  if not (
    (current_status = 'CAPTURED' and next_status in ('EXPLORING', 'ARCHIVED', 'REJECTED'))
    or (current_status = 'EXPLORING' and next_status in ('CAPTURED', 'VALIDATING', 'NEEDS_DECISION', 'ARCHIVED', 'REJECTED'))
    or (current_status = 'VALIDATING' and next_status in ('EXPLORING', 'NEEDS_DECISION', 'ARCHIVED', 'REJECTED'))
    or (current_status = 'NEEDS_DECISION' and next_status in ('VALIDATING', 'EXPLORING', 'APPROVED', 'REJECTED', 'ARCHIVED'))
    or (current_status = 'APPROVED' and next_status in ('PROMOTED', 'ARCHIVED', 'EXPLORING'))
    or (current_status = 'REJECTED' and next_status in ('ARCHIVED', 'EXPLORING'))
    or (current_status = 'ARCHIVED' and next_status in ('EXPLORING', 'CAPTURED'))
    or (current_status = 'PROMOTED' and next_status in ('ARCHIVED'))
  ) then
    raise exception 'illegal idea transition from % to %', current_status, next_status;
  end if;

  update public.ideas
  set status = next_status,
      updated_at = pg_catalog.now()
  where id = target_idea_id;

  insert into public.idea_transitions (
    idea_id, from_status, to_status, changed_by, actor, reason
  )
  values (
    target_idea_id,
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

revoke all on function public.record_idea_transition(uuid, public.idea_status, text, public.idea_actor)
  from public, anon;
grant execute on function public.record_idea_transition(uuid, public.idea_status, text, public.idea_actor)
  to authenticated;

-- Seed CAPTURED history on insert
create or replace function private.seed_idea_captured_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.idea_transitions (idea_id, from_status, to_status, changed_by, actor, reason)
  values (
    new.id,
    null,
    'CAPTURED',
    new.owner_id,
    'FOUNDER',
    'Idea captured by founder.'
  );
  return new;
end;
$$;

create trigger ideas_seed_captured
  after insert on public.ideas
  for each row execute function private.seed_idea_captured_transition();

create or replace function private.touch_idea_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create trigger ideas_touch_updated
  before update on public.ideas
  for each row execute function private.touch_idea_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.ideas enable row level security;
alter table public.ideas force row level security;
alter table public.idea_transitions enable row level security;
alter table public.idea_transitions force row level security;
alter table public.idea_validations enable row level security;
alter table public.idea_validations force row level security;
alter table public.idea_evidence enable row level security;
alter table public.idea_evidence force row level security;
alter table public.idea_strategies enable row level security;
alter table public.idea_strategies force row level security;

create policy ideas_select on public.ideas
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy ideas_insert on public.ideas
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy ideas_update on public.ideas
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy ideas_delete on public.ideas
  for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy idea_transitions_select on public.idea_transitions
  for select to authenticated
  using ((select private.owns_idea(idea_id)));

create policy idea_transitions_insert on public.idea_transitions
  for insert to authenticated
  with check ((select private.owns_idea(idea_id)));

create policy idea_validations_select on public.idea_validations
  for select to authenticated
  using ((select private.owns_idea(idea_id)));

create policy idea_validations_insert on public.idea_validations
  for insert to authenticated
  with check ((select private.owns_idea(idea_id)));

create policy idea_validations_update on public.idea_validations
  for update to authenticated
  using ((select private.owns_idea(idea_id)))
  with check ((select private.owns_idea(idea_id)));

create policy idea_validations_delete on public.idea_validations
  for delete to authenticated
  using ((select private.owns_idea(idea_id)));

create policy idea_evidence_select on public.idea_evidence
  for select to authenticated
  using ((select private.owns_idea(idea_id)));

create policy idea_evidence_insert on public.idea_evidence
  for insert to authenticated
  with check ((select private.owns_idea(idea_id)));

create policy idea_evidence_update on public.idea_evidence
  for update to authenticated
  using ((select private.owns_idea(idea_id)))
  with check ((select private.owns_idea(idea_id)));

create policy idea_evidence_delete on public.idea_evidence
  for delete to authenticated
  using ((select private.owns_idea(idea_id)));

create policy idea_strategies_select on public.idea_strategies
  for select to authenticated
  using ((select private.owns_idea(idea_id)));

create policy idea_strategies_insert on public.idea_strategies
  for insert to authenticated
  with check ((select private.owns_idea(idea_id)));

create policy idea_strategies_update on public.idea_strategies
  for update to authenticated
  using ((select private.owns_idea(idea_id)))
  with check ((select private.owns_idea(idea_id)));

create policy idea_strategies_delete on public.idea_strategies
  for delete to authenticated
  using ((select private.owns_idea(idea_id)));

revoke all on public.ideas from public, anon;
revoke all on public.idea_transitions from public, anon;
revoke all on public.idea_validations from public, anon;
revoke all on public.idea_evidence from public, anon;
revoke all on public.idea_strategies from public, anon;

grant select, insert, update, delete on public.ideas to authenticated;
grant select, insert on public.idea_transitions to authenticated;
grant select, insert, update, delete on public.idea_validations to authenticated;
grant select, insert, update, delete on public.idea_evidence to authenticated;
grant select, insert, update, delete on public.idea_strategies to authenticated;

-- Idea-aware decision resolution (also includes the selected_option ambiguity fix).
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
  owns boolean := false;
begin
  if next_status not in ('RESOLVED', 'CANCELLED') then
    raise exception 'decision must resolve to RESOLVED or CANCELLED';
  end if;

  select * into decision
  from public.project_decisions
  where id = target_decision_id
  for update;

  if decision.id is null then
    raise exception 'decision is not visible'
      using errcode = '42501';
  end if;

  owns :=
    (decision.project_id is not null and (select private.owns_project(decision.project_id)))
    or (decision.idea_id is not null and (select private.owns_idea(decision.idea_id)));

  if not owns then
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

  if next_status = 'RESOLVED'
    and decision.project_id is not null
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

  -- Reflect resolved strategic choices back into the strategy draft when linked.
  if next_status = 'RESOLVED' and decision.strategy_id is not null then
    update public.idea_strategies
    set
      open_decisions = coalesce((
        select jsonb_agg(to_jsonb(item))
        from jsonb_array_elements_text(coalesce(open_decisions, '[]'::jsonb)) as item
        where item is distinct from decision.title
          and item is distinct from decision.question
      ), '[]'::jsonb),
      updated_at = pg_catalog.now()
    where id = decision.strategy_id;
  end if;

  return decision;
end;
$$;
