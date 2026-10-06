-- Ghost V10 Verification part 2: RPC + RLS + grants.
-- Run after 20261006060000_verification.sql
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

create or replace function private.owns_verification_program(target_program_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.verification_programs vp
    where vp.id = target_program_id
      and (select private.owns_project(vp.project_id))
  );
$$;

revoke all on function private.owns_verification_program(uuid) from public, anon;
grant execute on function private.owns_verification_program(uuid) to authenticated;

create or replace function public.record_verification_program_transition(
  target_program_id uuid,
  next_status public.verification_program_status,
  transition_reason text,
  transition_actor public.product_actor default 'FOUNDER'
)
returns public.verification_program_transitions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.verification_program_status;
  history public.verification_program_transitions%rowtype;
begin
  if not (select private.owns_verification_program(target_program_id)) then
    raise exception 'verification program is not visible'
      using errcode = '42501';
  end if;

  if char_length(trim(transition_reason)) < 1 then
    raise exception 'transition reason is required';
  end if;

  select status into current_status
  from public.verification_programs
  where id = target_program_id
  for update;

  if current_status is null then
    raise exception 'verification program is not visible'
      using errcode = '42501';
  end if;

  if current_status = next_status then
    raise exception 'verification program status is already %', next_status;
  end if;

  if not (
    (current_status = 'NOT_STARTED' and next_status in ('TESTING'))
    or (current_status = 'TESTING' and next_status in ('VERIFICATION_REVIEW', 'NOT_STARTED'))
    or (current_status = 'VERIFICATION_REVIEW' and next_status in ('TESTING', 'VERIFIED'))
    or (current_status = 'VERIFIED' and next_status in ('VERIFICATION_REVIEW', 'TESTING'))
  ) then
    raise exception 'illegal verification program transition from % to %', current_status, next_status;
  end if;

  update public.verification_programs
  set
    status = next_status,
    verified_at = case
      when next_status = 'VERIFIED' then coalesce(verified_at, pg_catalog.now())
      else verified_at
    end,
    verified_by = case
      when next_status = 'VERIFIED' and verified_by is null then (select auth.uid())
      else verified_by
    end,
    updated_at = pg_catalog.now()
  where id = target_program_id;

  insert into public.verification_program_transitions (
    program_id, from_status, to_status, changed_by, actor, reason
  ) values (
    target_program_id,
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

revoke all on function public.record_verification_program_transition(uuid, public.verification_program_status, text, public.product_actor) from public, anon;
grant execute on function public.record_verification_program_transition(uuid, public.verification_program_status, text, public.product_actor) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.verification_programs enable row level security;
alter table public.verification_programs force row level security;
alter table public.verification_program_transitions enable row level security;
alter table public.verification_program_transitions force row level security;
alter table public.verification_cases enable row level security;
alter table public.verification_cases force row level security;
alter table public.verification_evidence enable row level security;
alter table public.verification_evidence force row level security;
alter table public.verification_defects enable row level security;
alter table public.verification_defects force row level security;
alter table public.verification_retest_events enable row level security;
alter table public.verification_retest_events force row level security;

drop policy if exists verification_programs_select on public.verification_programs;
create policy verification_programs_select on public.verification_programs
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists verification_programs_insert on public.verification_programs;
create policy verification_programs_insert on public.verification_programs
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists verification_programs_update on public.verification_programs;
create policy verification_programs_update on public.verification_programs
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists verification_programs_delete on public.verification_programs;
create policy verification_programs_delete on public.verification_programs
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists verification_program_transitions_select on public.verification_program_transitions;
create policy verification_program_transitions_select on public.verification_program_transitions
  for select to authenticated using ((select private.owns_verification_program(program_id)));
drop policy if exists verification_program_transitions_insert on public.verification_program_transitions;
create policy verification_program_transitions_insert on public.verification_program_transitions
  for insert to authenticated with check ((select private.owns_verification_program(program_id)));

drop policy if exists verification_cases_select on public.verification_cases;
create policy verification_cases_select on public.verification_cases
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists verification_cases_insert on public.verification_cases;
create policy verification_cases_insert on public.verification_cases
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists verification_cases_update on public.verification_cases;
create policy verification_cases_update on public.verification_cases
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists verification_cases_delete on public.verification_cases;
create policy verification_cases_delete on public.verification_cases
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists verification_evidence_select on public.verification_evidence;
create policy verification_evidence_select on public.verification_evidence
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists verification_evidence_insert on public.verification_evidence;
create policy verification_evidence_insert on public.verification_evidence
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists verification_evidence_update on public.verification_evidence;
create policy verification_evidence_update on public.verification_evidence
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists verification_evidence_delete on public.verification_evidence;
create policy verification_evidence_delete on public.verification_evidence
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists verification_defects_select on public.verification_defects;
create policy verification_defects_select on public.verification_defects
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists verification_defects_insert on public.verification_defects;
create policy verification_defects_insert on public.verification_defects
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists verification_defects_update on public.verification_defects;
create policy verification_defects_update on public.verification_defects
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists verification_defects_delete on public.verification_defects;
create policy verification_defects_delete on public.verification_defects
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists verification_retest_events_select on public.verification_retest_events;
create policy verification_retest_events_select on public.verification_retest_events
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists verification_retest_events_insert on public.verification_retest_events;
create policy verification_retest_events_insert on public.verification_retest_events
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists verification_retest_events_update on public.verification_retest_events;
create policy verification_retest_events_update on public.verification_retest_events
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists verification_retest_events_delete on public.verification_retest_events;
create policy verification_retest_events_delete on public.verification_retest_events
  for delete to authenticated using ((select private.owns_project(project_id)));

grant select, insert, update, delete on public.verification_programs to authenticated;
grant select, insert on public.verification_program_transitions to authenticated;
grant select, insert, update, delete on public.verification_cases to authenticated;
grant select, insert, update, delete on public.verification_evidence to authenticated;
grant select, insert, update, delete on public.verification_defects to authenticated;
grant select, insert, update, delete on public.verification_retest_events to authenticated;

notify pgrst, 'reload schema';
