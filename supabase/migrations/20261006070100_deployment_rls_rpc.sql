-- Ghost V11 Deployment / Release part 2: RPC + RLS + grants.
-- Run after 20261006070000_deployment.sql
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

create or replace function private.owns_release(target_release_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.releases r
    where r.id = target_release_id
      and (select private.owns_project(r.project_id))
  );
$$;

revoke all on function private.owns_release(uuid) from public, anon;
grant execute on function private.owns_release(uuid) to authenticated;

create or replace function public.record_release_transition(
  target_release_id uuid,
  next_status public.release_status,
  transition_reason text,
  transition_actor public.product_actor default 'FOUNDER'
)
returns public.release_transitions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.release_status;
  history public.release_transitions%rowtype;
begin
  if not (select private.owns_release(target_release_id)) then
    raise exception 'release is not visible'
      using errcode = '42501';
  end if;

  if char_length(trim(transition_reason)) < 1 then
    raise exception 'transition reason is required';
  end if;

  select status into current_status
  from public.releases
  where id = target_release_id
  for update;

  if current_status is null then
    raise exception 'release is not visible'
      using errcode = '42501';
  end if;

  if current_status = next_status then
    raise exception 'release status is already %', next_status;
  end if;

  if not (
    (current_status = 'DRAFT' and next_status in ('DEPLOYMENT_READY'))
    or (current_status = 'DEPLOYMENT_READY' and next_status in ('DEPLOYING', 'DRAFT'))
    or (current_status = 'DEPLOYING' and next_status in ('DEPLOYED', 'DEPLOYMENT_READY'))
    or (current_status = 'DEPLOYED' and next_status in ('PRODUCTION_VERIFICATION', 'DEPLOYING'))
    or (current_status = 'PRODUCTION_VERIFICATION' and next_status in ('PRODUCTION_VERIFIED', 'DEPLOYED'))
    or (current_status = 'PRODUCTION_VERIFIED' and next_status in ('PRODUCTION_VERIFICATION', 'DEPLOYED'))
  ) then
    raise exception 'illegal release transition from % to %', current_status, next_status;
  end if;

  update public.releases
  set
    status = next_status,
    deployed_at = case
      when next_status = 'DEPLOYED' then coalesce(deployed_at, pg_catalog.now())
      else deployed_at
    end,
    production_verified_at = case
      when next_status = 'PRODUCTION_VERIFIED' then coalesce(production_verified_at, pg_catalog.now())
      else production_verified_at
    end,
    production_verified_by = case
      when next_status = 'PRODUCTION_VERIFIED' and production_verified_by is null then (select auth.uid())
      else production_verified_by
    end,
    updated_at = pg_catalog.now()
  where id = target_release_id;

  insert into public.release_transitions (
    release_id, from_status, to_status, changed_by, actor, reason
  ) values (
    target_release_id,
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

revoke all on function public.record_release_transition(uuid, public.release_status, text, public.product_actor) from public, anon;
grant execute on function public.record_release_transition(uuid, public.release_status, text, public.product_actor) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.deployment_environments enable row level security;
alter table public.deployment_environments force row level security;
alter table public.releases enable row level security;
alter table public.releases force row level security;
alter table public.release_transitions enable row level security;
alter table public.release_transitions force row level security;
alter table public.release_config_requirements enable row level security;
alter table public.release_config_requirements force row level security;
alter table public.release_migrations enable row level security;
alter table public.release_migrations force row level security;
alter table public.deployments enable row level security;
alter table public.deployments force row level security;
alter table public.deployment_evidence enable row level security;
alter table public.deployment_evidence force row level security;
alter table public.deployment_health_checks enable row level security;
alter table public.deployment_health_checks force row level security;
alter table public.deployment_manual_actions enable row level security;
alter table public.deployment_manual_actions force row level security;
alter table public.release_rollbacks enable row level security;
alter table public.release_rollbacks force row level security;

drop policy if exists deployment_environments_select on public.deployment_environments;
create policy deployment_environments_select on public.deployment_environments
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists deployment_environments_insert on public.deployment_environments;
create policy deployment_environments_insert on public.deployment_environments
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists deployment_environments_update on public.deployment_environments;
create policy deployment_environments_update on public.deployment_environments
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists deployment_environments_delete on public.deployment_environments;
create policy deployment_environments_delete on public.deployment_environments
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists releases_select on public.releases;
create policy releases_select on public.releases
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists releases_insert on public.releases;
create policy releases_insert on public.releases
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists releases_update on public.releases;
create policy releases_update on public.releases
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists releases_delete on public.releases;
create policy releases_delete on public.releases
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists release_transitions_select on public.release_transitions;
create policy release_transitions_select on public.release_transitions
  for select to authenticated using ((select private.owns_release(release_id)));
drop policy if exists release_transitions_insert on public.release_transitions;
create policy release_transitions_insert on public.release_transitions
  for insert to authenticated with check ((select private.owns_release(release_id)));

drop policy if exists release_config_select on public.release_config_requirements;
create policy release_config_select on public.release_config_requirements
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists release_config_insert on public.release_config_requirements;
create policy release_config_insert on public.release_config_requirements
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists release_config_update on public.release_config_requirements;
create policy release_config_update on public.release_config_requirements
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists release_config_delete on public.release_config_requirements;
create policy release_config_delete on public.release_config_requirements
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists release_migrations_select on public.release_migrations;
create policy release_migrations_select on public.release_migrations
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists release_migrations_insert on public.release_migrations;
create policy release_migrations_insert on public.release_migrations
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists release_migrations_update on public.release_migrations;
create policy release_migrations_update on public.release_migrations
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists release_migrations_delete on public.release_migrations;
create policy release_migrations_delete on public.release_migrations
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists deployments_select on public.deployments;
create policy deployments_select on public.deployments
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists deployments_insert on public.deployments;
create policy deployments_insert on public.deployments
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists deployments_update on public.deployments;
create policy deployments_update on public.deployments
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists deployments_delete on public.deployments;
create policy deployments_delete on public.deployments
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists deployment_evidence_select on public.deployment_evidence;
create policy deployment_evidence_select on public.deployment_evidence
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists deployment_evidence_insert on public.deployment_evidence;
create policy deployment_evidence_insert on public.deployment_evidence
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists deployment_evidence_update on public.deployment_evidence;
create policy deployment_evidence_update on public.deployment_evidence
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists deployment_evidence_delete on public.deployment_evidence;
create policy deployment_evidence_delete on public.deployment_evidence
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists deployment_health_select on public.deployment_health_checks;
create policy deployment_health_select on public.deployment_health_checks
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists deployment_health_insert on public.deployment_health_checks;
create policy deployment_health_insert on public.deployment_health_checks
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists deployment_health_update on public.deployment_health_checks;
create policy deployment_health_update on public.deployment_health_checks
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists deployment_health_delete on public.deployment_health_checks;
create policy deployment_health_delete on public.deployment_health_checks
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists deployment_manual_select on public.deployment_manual_actions;
create policy deployment_manual_select on public.deployment_manual_actions
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists deployment_manual_insert on public.deployment_manual_actions;
create policy deployment_manual_insert on public.deployment_manual_actions
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists deployment_manual_update on public.deployment_manual_actions;
create policy deployment_manual_update on public.deployment_manual_actions
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists deployment_manual_delete on public.deployment_manual_actions;
create policy deployment_manual_delete on public.deployment_manual_actions
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists release_rollbacks_select on public.release_rollbacks;
create policy release_rollbacks_select on public.release_rollbacks
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists release_rollbacks_insert on public.release_rollbacks;
create policy release_rollbacks_insert on public.release_rollbacks
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists release_rollbacks_update on public.release_rollbacks;
create policy release_rollbacks_update on public.release_rollbacks
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists release_rollbacks_delete on public.release_rollbacks;
create policy release_rollbacks_delete on public.release_rollbacks
  for delete to authenticated using ((select private.owns_project(project_id)));

grant select, insert, update, delete on public.deployment_environments to authenticated;
grant select, insert, update, delete on public.releases to authenticated;
grant select, insert on public.release_transitions to authenticated;
grant select, insert, update, delete on public.release_config_requirements to authenticated;
grant select, insert, update, delete on public.release_migrations to authenticated;
grant select, insert, update, delete on public.deployments to authenticated;
grant select, insert, update, delete on public.deployment_evidence to authenticated;
grant select, insert, update, delete on public.deployment_health_checks to authenticated;
grant select, insert, update, delete on public.deployment_manual_actions to authenticated;
grant select, insert, update, delete on public.release_rollbacks to authenticated;

notify pgrst, 'reload schema';
