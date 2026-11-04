-- Ghost V8 Build Plan part 2: RPC + RLS + grants.
-- Run after 20261006040000_build_plan.sql
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

-- ---------------------------------------------------------------------------
-- Ownership helper + transition RPC
-- ---------------------------------------------------------------------------

create or replace function private.owns_build_plan(target_plan_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.build_plans bp
    where bp.id = target_plan_id
      and (select private.owns_project(bp.project_id))
  );
$$;

revoke all on function private.owns_build_plan(uuid) from public, anon;
grant execute on function private.owns_build_plan(uuid) to authenticated;

create or replace function public.record_build_plan_transition(
  target_plan_id uuid,
  next_status public.build_plan_status,
  transition_reason text,
  transition_actor public.product_actor default 'FOUNDER'
)
returns public.build_plan_transitions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.build_plan_status;
  history public.build_plan_transitions%rowtype;
begin
  if not (select private.owns_build_plan(target_plan_id)) then
    raise exception 'build plan is not visible'
      using errcode = '42501';
  end if;

  if char_length(trim(transition_reason)) < 1 then
    raise exception 'transition reason is required';
  end if;

  select status into current_status
  from public.build_plans
  where id = target_plan_id
  for update;

  if current_status is null then
    raise exception 'build plan is not visible'
      using errcode = '42501';
  end if;

  if current_status = next_status then
    raise exception 'build plan status is already %', next_status;
  end if;

  if not (
    (current_status = 'DRAFT' and next_status in ('PLANNING', 'REVIEW'))
    or (current_status = 'PLANNING' and next_status in ('DRAFT', 'REVIEW'))
    or (current_status = 'REVIEW' and next_status in ('PLANNING', 'APPROVED', 'DRAFT'))
    or (current_status = 'APPROVED' and next_status in ('REVIEW', 'BUILD_PLAN_READY', 'PLANNING'))
    or (current_status = 'BUILD_PLAN_READY' and next_status in ('APPROVED', 'REVIEW'))
  ) then
    raise exception 'illegal build plan transition from % to %', current_status, next_status;
  end if;

  update public.build_plans
  set
    status = next_status,
    approved_at = case
      when next_status in ('APPROVED', 'BUILD_PLAN_READY') then coalesce(approved_at, pg_catalog.now())
      else approved_at
    end,
    approved_by = case
      when next_status in ('APPROVED', 'BUILD_PLAN_READY') and approved_by is null then (select auth.uid())
      else approved_by
    end,
    updated_at = pg_catalog.now()
  where id = target_plan_id;

  insert into public.build_plan_transitions (
    plan_id, from_status, to_status, changed_by, actor, reason
  ) values (
    target_plan_id,
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

revoke all on function public.record_build_plan_transition(uuid, public.build_plan_status, text, public.product_actor) from public, anon;
grant execute on function public.record_build_plan_transition(uuid, public.build_plan_status, text, public.product_actor) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.build_plans enable row level security;
alter table public.build_plans force row level security;
alter table public.build_plan_transitions enable row level security;
alter table public.build_plan_transitions force row level security;
alter table public.build_phases enable row level security;
alter table public.build_phases force row level security;
alter table public.work_packages enable row level security;
alter table public.work_packages force row level security;
alter table public.work_package_dependencies enable row level security;
alter table public.work_package_dependencies force row level security;
alter table public.work_package_requirement_links enable row level security;
alter table public.work_package_requirement_links force row level security;
alter table public.work_package_feature_links enable row level security;
alter table public.work_package_feature_links force row level security;
alter table public.work_package_architecture_links enable row level security;
alter table public.work_package_architecture_links force row level security;
alter table public.work_package_verifications enable row level security;
alter table public.work_package_verifications force row level security;
alter table public.build_manual_actions enable row level security;
alter table public.build_manual_actions force row level security;
alter table public.build_config_requirements enable row level security;
alter table public.build_config_requirements force row level security;
alter table public.build_plan_risks enable row level security;
alter table public.build_plan_risks force row level security;

drop policy if exists build_plans_select on public.build_plans;
create policy build_plans_select on public.build_plans
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists build_plans_insert on public.build_plans;
create policy build_plans_insert on public.build_plans
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists build_plans_update on public.build_plans;
create policy build_plans_update on public.build_plans
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists build_plans_delete on public.build_plans;
create policy build_plans_delete on public.build_plans
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists build_plan_transitions_select on public.build_plan_transitions;
create policy build_plan_transitions_select on public.build_plan_transitions
  for select to authenticated using ((select private.owns_build_plan(plan_id)));
drop policy if exists build_plan_transitions_insert on public.build_plan_transitions;
create policy build_plan_transitions_insert on public.build_plan_transitions
  for insert to authenticated with check ((select private.owns_build_plan(plan_id)));

drop policy if exists build_phases_select on public.build_phases;
create policy build_phases_select on public.build_phases
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists build_phases_insert on public.build_phases;
create policy build_phases_insert on public.build_phases
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists build_phases_update on public.build_phases;
create policy build_phases_update on public.build_phases
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists build_phases_delete on public.build_phases;
create policy build_phases_delete on public.build_phases
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists work_packages_select on public.work_packages;
create policy work_packages_select on public.work_packages
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists work_packages_insert on public.work_packages;
create policy work_packages_insert on public.work_packages
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists work_packages_update on public.work_packages;
create policy work_packages_update on public.work_packages
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists work_packages_delete on public.work_packages;
create policy work_packages_delete on public.work_packages
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists work_package_dependencies_select on public.work_package_dependencies;
create policy work_package_dependencies_select on public.work_package_dependencies
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists work_package_dependencies_insert on public.work_package_dependencies;
create policy work_package_dependencies_insert on public.work_package_dependencies
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists work_package_dependencies_update on public.work_package_dependencies;
create policy work_package_dependencies_update on public.work_package_dependencies
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists work_package_dependencies_delete on public.work_package_dependencies;
create policy work_package_dependencies_delete on public.work_package_dependencies
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists work_package_requirement_links_select on public.work_package_requirement_links;
create policy work_package_requirement_links_select on public.work_package_requirement_links
  for select to authenticated using (
    exists (select 1 from public.work_packages wp where wp.id = work_package_id and (select private.owns_project(wp.project_id)))
  );
drop policy if exists work_package_requirement_links_insert on public.work_package_requirement_links;
create policy work_package_requirement_links_insert on public.work_package_requirement_links
  for insert to authenticated with check (
    exists (select 1 from public.work_packages wp where wp.id = work_package_id and (select private.owns_project(wp.project_id)))
    and exists (select 1 from public.product_requirements r where r.id = requirement_id and (select private.owns_project(r.project_id)))
  );
drop policy if exists work_package_requirement_links_delete on public.work_package_requirement_links;
create policy work_package_requirement_links_delete on public.work_package_requirement_links
  for delete to authenticated using (
    exists (select 1 from public.work_packages wp where wp.id = work_package_id and (select private.owns_project(wp.project_id)))
  );

drop policy if exists work_package_feature_links_select on public.work_package_feature_links;
create policy work_package_feature_links_select on public.work_package_feature_links
  for select to authenticated using (
    exists (select 1 from public.work_packages wp where wp.id = work_package_id and (select private.owns_project(wp.project_id)))
  );
drop policy if exists work_package_feature_links_insert on public.work_package_feature_links;
create policy work_package_feature_links_insert on public.work_package_feature_links
  for insert to authenticated with check (
    exists (select 1 from public.work_packages wp where wp.id = work_package_id and (select private.owns_project(wp.project_id)))
    and exists (select 1 from public.product_features f where f.id = feature_id and (select private.owns_project(f.project_id)))
  );
drop policy if exists work_package_feature_links_delete on public.work_package_feature_links;
create policy work_package_feature_links_delete on public.work_package_feature_links
  for delete to authenticated using (
    exists (select 1 from public.work_packages wp where wp.id = work_package_id and (select private.owns_project(wp.project_id)))
  );

drop policy if exists work_package_architecture_links_select on public.work_package_architecture_links;
create policy work_package_architecture_links_select on public.work_package_architecture_links
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists work_package_architecture_links_insert on public.work_package_architecture_links;
create policy work_package_architecture_links_insert on public.work_package_architecture_links
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists work_package_architecture_links_update on public.work_package_architecture_links;
create policy work_package_architecture_links_update on public.work_package_architecture_links
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists work_package_architecture_links_delete on public.work_package_architecture_links;
create policy work_package_architecture_links_delete on public.work_package_architecture_links
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists work_package_verifications_select on public.work_package_verifications;
create policy work_package_verifications_select on public.work_package_verifications
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists work_package_verifications_insert on public.work_package_verifications;
create policy work_package_verifications_insert on public.work_package_verifications
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists work_package_verifications_update on public.work_package_verifications;
create policy work_package_verifications_update on public.work_package_verifications
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists work_package_verifications_delete on public.work_package_verifications;
create policy work_package_verifications_delete on public.work_package_verifications
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists build_manual_actions_select on public.build_manual_actions;
create policy build_manual_actions_select on public.build_manual_actions
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists build_manual_actions_insert on public.build_manual_actions;
create policy build_manual_actions_insert on public.build_manual_actions
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists build_manual_actions_update on public.build_manual_actions;
create policy build_manual_actions_update on public.build_manual_actions
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists build_manual_actions_delete on public.build_manual_actions;
create policy build_manual_actions_delete on public.build_manual_actions
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists build_config_requirements_select on public.build_config_requirements;
create policy build_config_requirements_select on public.build_config_requirements
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists build_config_requirements_insert on public.build_config_requirements;
create policy build_config_requirements_insert on public.build_config_requirements
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists build_config_requirements_update on public.build_config_requirements;
create policy build_config_requirements_update on public.build_config_requirements
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists build_config_requirements_delete on public.build_config_requirements;
create policy build_config_requirements_delete on public.build_config_requirements
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists build_plan_risks_select on public.build_plan_risks;
create policy build_plan_risks_select on public.build_plan_risks
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists build_plan_risks_insert on public.build_plan_risks;
create policy build_plan_risks_insert on public.build_plan_risks
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists build_plan_risks_update on public.build_plan_risks;
create policy build_plan_risks_update on public.build_plan_risks
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists build_plan_risks_delete on public.build_plan_risks;
create policy build_plan_risks_delete on public.build_plan_risks
  for delete to authenticated using ((select private.owns_project(project_id)));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.build_plans to authenticated;
grant select, insert on public.build_plan_transitions to authenticated;
grant select, insert, update, delete on public.build_phases to authenticated;
grant select, insert, update, delete on public.work_packages to authenticated;
grant select, insert, update, delete on public.work_package_dependencies to authenticated;
grant select, insert, delete on public.work_package_requirement_links to authenticated;
grant select, insert, delete on public.work_package_feature_links to authenticated;
grant select, insert, update, delete on public.work_package_architecture_links to authenticated;
grant select, insert, update, delete on public.work_package_verifications to authenticated;
grant select, insert, update, delete on public.build_manual_actions to authenticated;
grant select, insert, update, delete on public.build_config_requirements to authenticated;
grant select, insert, update, delete on public.build_plan_risks to authenticated;

notify pgrst, 'reload schema';
