-- Fix ambiguous selected_option in resolve_project_decision.
-- Parameter names collided with column names in the UPDATE SET clause.

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
