-- Ghost V9 Build Execution part 2: RPC + RLS + grants.
-- Run after 20261006050000_build_execution.sql
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

-- ---------------------------------------------------------------------------
-- Ownership helper + transition RPC
-- ---------------------------------------------------------------------------

create or replace function private.owns_build_execution(target_execution_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.build_executions be
    where be.id = target_execution_id
      and (select private.owns_project(be.project_id))
  );
$$;

revoke all on function private.owns_build_execution(uuid) from public, anon;
grant execute on function private.owns_build_execution(uuid) to authenticated;

create or replace function public.record_build_execution_transition(
  target_execution_id uuid,
  next_status public.build_execution_status,
  transition_reason text,
  transition_actor public.product_actor default 'FOUNDER'
)
returns public.build_execution_transitions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.build_execution_status;
  history public.build_execution_transitions%rowtype;
begin
  if not (select private.owns_build_execution(target_execution_id)) then
    raise exception 'build execution is not visible'
      using errcode = '42501';
  end if;

  if char_length(trim(transition_reason)) < 1 then
    raise exception 'transition reason is required';
  end if;

  select status into current_status
  from public.build_executions
  where id = target_execution_id
  for update;

  if current_status is null then
    raise exception 'build execution is not visible'
      using errcode = '42501';
  end if;

  if current_status = next_status then
    raise exception 'build execution status is already %', next_status;
  end if;

  if not (
    (current_status = 'NOT_STARTED' and next_status in ('EXECUTING'))
    or (current_status = 'EXECUTING' and next_status in ('IMPLEMENTATION_REVIEW', 'NOT_STARTED'))
    or (current_status = 'IMPLEMENTATION_REVIEW' and next_status in ('EXECUTING', 'IMPLEMENTED'))
    or (current_status = 'IMPLEMENTED' and next_status in ('IMPLEMENTATION_REVIEW', 'EXECUTING'))
  ) then
    raise exception 'illegal build execution transition from % to %', current_status, next_status;
  end if;

  update public.build_executions
  set
    status = next_status,
    implemented_at = case
      when next_status = 'IMPLEMENTED' then coalesce(implemented_at, pg_catalog.now())
      else implemented_at
    end,
    implemented_by = case
      when next_status = 'IMPLEMENTED' and implemented_by is null then (select auth.uid())
      else implemented_by
    end,
    updated_at = pg_catalog.now()
  where id = target_execution_id;

  insert into public.build_execution_transitions (
    execution_id, from_status, to_status, changed_by, actor, reason
  ) values (
    target_execution_id,
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

revoke all on function public.record_build_execution_transition(uuid, public.build_execution_status, text, public.product_actor) from public, anon;
grant execute on function public.record_build_execution_transition(uuid, public.build_execution_status, text, public.product_actor) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.build_executions enable row level security;
alter table public.build_executions force row level security;
alter table public.build_execution_transitions enable row level security;
alter table public.build_execution_transitions force row level security;
alter table public.work_package_executions enable row level security;
alter table public.work_package_executions force row level security;
alter table public.implementation_evidence enable row level security;
alter table public.implementation_evidence force row level security;
alter table public.execution_blockers enable row level security;
alter table public.execution_blockers force row level security;
alter table public.execution_upstream_changes enable row level security;
alter table public.execution_upstream_changes force row level security;

drop policy if exists build_executions_select on public.build_executions;
create policy build_executions_select on public.build_executions
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists build_executions_insert on public.build_executions;
create policy build_executions_insert on public.build_executions
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists build_executions_update on public.build_executions;
create policy build_executions_update on public.build_executions
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists build_executions_delete on public.build_executions;
create policy build_executions_delete on public.build_executions
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists build_execution_transitions_select on public.build_execution_transitions;
create policy build_execution_transitions_select on public.build_execution_transitions
  for select to authenticated using ((select private.owns_build_execution(execution_id)));
drop policy if exists build_execution_transitions_insert on public.build_execution_transitions;
create policy build_execution_transitions_insert on public.build_execution_transitions
  for insert to authenticated with check ((select private.owns_build_execution(execution_id)));

drop policy if exists work_package_executions_select on public.work_package_executions;
create policy work_package_executions_select on public.work_package_executions
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists work_package_executions_insert on public.work_package_executions;
create policy work_package_executions_insert on public.work_package_executions
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists work_package_executions_update on public.work_package_executions;
create policy work_package_executions_update on public.work_package_executions
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists work_package_executions_delete on public.work_package_executions;
create policy work_package_executions_delete on public.work_package_executions
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists implementation_evidence_select on public.implementation_evidence;
create policy implementation_evidence_select on public.implementation_evidence
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists implementation_evidence_insert on public.implementation_evidence;
create policy implementation_evidence_insert on public.implementation_evidence
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists implementation_evidence_update on public.implementation_evidence;
create policy implementation_evidence_update on public.implementation_evidence
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists implementation_evidence_delete on public.implementation_evidence;
create policy implementation_evidence_delete on public.implementation_evidence
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists execution_blockers_select on public.execution_blockers;
create policy execution_blockers_select on public.execution_blockers
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists execution_blockers_insert on public.execution_blockers;
create policy execution_blockers_insert on public.execution_blockers
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists execution_blockers_update on public.execution_blockers;
create policy execution_blockers_update on public.execution_blockers
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists execution_blockers_delete on public.execution_blockers;
create policy execution_blockers_delete on public.execution_blockers
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists execution_upstream_changes_select on public.execution_upstream_changes;
create policy execution_upstream_changes_select on public.execution_upstream_changes
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists execution_upstream_changes_insert on public.execution_upstream_changes;
create policy execution_upstream_changes_insert on public.execution_upstream_changes
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists execution_upstream_changes_update on public.execution_upstream_changes;
create policy execution_upstream_changes_update on public.execution_upstream_changes
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists execution_upstream_changes_delete on public.execution_upstream_changes;
create policy execution_upstream_changes_delete on public.execution_upstream_changes
  for delete to authenticated using ((select private.owns_project(project_id)));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.build_executions to authenticated;
grant select, insert on public.build_execution_transitions to authenticated;
grant select, insert, update, delete on public.work_package_executions to authenticated;
grant select, insert, update, delete on public.implementation_evidence to authenticated;
grant select, insert, update, delete on public.execution_blockers to authenticated;
grant select, insert, update, delete on public.execution_upstream_changes to authenticated;

notify pgrst, 'reload schema';
