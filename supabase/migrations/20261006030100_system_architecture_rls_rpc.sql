-- Ghost V7 System Architecture part 2: RPC + RLS + grants.
-- Run after 20261006030000_system_architecture.sql
-- Target: Ghost-1R wzwrrleqfylhuxfbukfu.

-- ---------------------------------------------------------------------------
-- Ownership helper + transition RPC
-- ---------------------------------------------------------------------------

create or replace function private.owns_system_architecture(target_architecture_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.system_architectures sa
    where sa.id = target_architecture_id
      and (select private.owns_project(sa.project_id))
  );
$$;

revoke all on function private.owns_system_architecture(uuid) from public, anon;
grant execute on function private.owns_system_architecture(uuid) to authenticated;

create or replace function public.record_system_architecture_transition(
  target_architecture_id uuid,
  next_status public.system_architecture_status,
  transition_reason text,
  transition_actor public.product_actor default 'FOUNDER'
)
returns public.system_architecture_transitions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status public.system_architecture_status;
  history public.system_architecture_transitions%rowtype;
begin
  if not (select private.owns_system_architecture(target_architecture_id)) then
    raise exception 'system architecture is not visible'
      using errcode = '42501';
  end if;

  if char_length(trim(transition_reason)) < 1 then
    raise exception 'transition reason is required';
  end if;

  select status into current_status
  from public.system_architectures
  where id = target_architecture_id
  for update;

  if current_status is null then
    raise exception 'system architecture is not visible'
      using errcode = '42501';
  end if;

  if current_status = next_status then
    raise exception 'system architecture status is already %', next_status;
  end if;

  if not (
    (current_status = 'DRAFT' and next_status in ('DESIGNING', 'REVIEW'))
    or (current_status = 'DESIGNING' and next_status in ('DRAFT', 'REVIEW'))
    or (current_status = 'REVIEW' and next_status in ('DESIGNING', 'APPROVED', 'DRAFT'))
    or (current_status = 'APPROVED' and next_status in ('REVIEW', 'ARCHITECTURE_READY', 'DESIGNING'))
    or (current_status = 'ARCHITECTURE_READY' and next_status in ('APPROVED', 'REVIEW'))
  ) then
    raise exception 'illegal system architecture transition from % to %', current_status, next_status;
  end if;

  update public.system_architectures
  set
    status = next_status,
    approved_at = case
      when next_status in ('APPROVED', 'ARCHITECTURE_READY') then coalesce(approved_at, pg_catalog.now())
      else approved_at
    end,
    approved_by = case
      when next_status in ('APPROVED', 'ARCHITECTURE_READY') and approved_by is null then (select auth.uid())
      else approved_by
    end,
    updated_at = pg_catalog.now()
  where id = target_architecture_id;

  insert into public.system_architecture_transitions (
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

revoke all on function public.record_system_architecture_transition(uuid, public.system_architecture_status, text, public.product_actor) from public, anon;
grant execute on function public.record_system_architecture_transition(uuid, public.system_architecture_status, text, public.product_actor) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.system_architectures enable row level security;
alter table public.system_architectures force row level security;
alter table public.system_architecture_transitions enable row level security;
alter table public.system_architecture_transitions force row level security;
alter table public.system_components enable row level security;
alter table public.system_components force row level security;
alter table public.system_component_requirements enable row level security;
alter table public.system_component_requirements force row level security;
alter table public.system_entities enable row level security;
alter table public.system_entities force row level security;
alter table public.system_entity_fields enable row level security;
alter table public.system_entity_fields force row level security;
alter table public.system_relationships enable row level security;
alter table public.system_relationships force row level security;
alter table public.system_interfaces enable row level security;
alter table public.system_interfaces force row level security;
alter table public.system_interface_requirements enable row level security;
alter table public.system_interface_requirements force row level security;
alter table public.system_data_flows enable row level security;
alter table public.system_data_flows force row level security;
alter table public.system_integrations enable row level security;
alter table public.system_integrations force row level security;
alter table public.system_env_configs enable row level security;
alter table public.system_env_configs force row level security;
alter table public.system_technical_risks enable row level security;
alter table public.system_technical_risks force row level security;
alter table public.system_technical_constraints enable row level security;
alter table public.system_technical_constraints force row level security;
alter table public.system_requirement_coverage enable row level security;
alter table public.system_requirement_coverage force row level security;
alter table public.system_questions enable row level security;
alter table public.system_questions force row level security;

drop policy if exists system_architectures_select on public.system_architectures;
create policy system_architectures_select on public.system_architectures
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_architectures_insert on public.system_architectures;
create policy system_architectures_insert on public.system_architectures
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_architectures_update on public.system_architectures;
create policy system_architectures_update on public.system_architectures
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_architectures_delete on public.system_architectures;
create policy system_architectures_delete on public.system_architectures
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_architecture_transitions_select on public.system_architecture_transitions;
create policy system_architecture_transitions_select on public.system_architecture_transitions
  for select to authenticated using ((select private.owns_system_architecture(architecture_id)));
drop policy if exists system_architecture_transitions_insert on public.system_architecture_transitions;
create policy system_architecture_transitions_insert on public.system_architecture_transitions
  for insert to authenticated with check ((select private.owns_system_architecture(architecture_id)));

drop policy if exists system_components_select on public.system_components;
create policy system_components_select on public.system_components
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_components_insert on public.system_components;
create policy system_components_insert on public.system_components
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_components_update on public.system_components;
create policy system_components_update on public.system_components
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_components_delete on public.system_components;
create policy system_components_delete on public.system_components
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_component_requirements_select on public.system_component_requirements;
create policy system_component_requirements_select on public.system_component_requirements
  for select to authenticated using (
    exists (select 1 from public.system_components c where c.id = component_id and (select private.owns_project(c.project_id)))
  );
drop policy if exists system_component_requirements_insert on public.system_component_requirements;
create policy system_component_requirements_insert on public.system_component_requirements
  for insert to authenticated with check (
    exists (select 1 from public.system_components c where c.id = component_id and (select private.owns_project(c.project_id)))
    and exists (select 1 from public.product_requirements r where r.id = requirement_id and (select private.owns_project(r.project_id)))
  );
drop policy if exists system_component_requirements_delete on public.system_component_requirements;
create policy system_component_requirements_delete on public.system_component_requirements
  for delete to authenticated using (
    exists (select 1 from public.system_components c where c.id = component_id and (select private.owns_project(c.project_id)))
  );

drop policy if exists system_entities_select on public.system_entities;
create policy system_entities_select on public.system_entities
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_entities_insert on public.system_entities;
create policy system_entities_insert on public.system_entities
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_entities_update on public.system_entities;
create policy system_entities_update on public.system_entities
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_entities_delete on public.system_entities;
create policy system_entities_delete on public.system_entities
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_entity_fields_select on public.system_entity_fields;
create policy system_entity_fields_select on public.system_entity_fields
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_entity_fields_insert on public.system_entity_fields;
create policy system_entity_fields_insert on public.system_entity_fields
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_entity_fields_update on public.system_entity_fields;
create policy system_entity_fields_update on public.system_entity_fields
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_entity_fields_delete on public.system_entity_fields;
create policy system_entity_fields_delete on public.system_entity_fields
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_relationships_select on public.system_relationships;
create policy system_relationships_select on public.system_relationships
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_relationships_insert on public.system_relationships;
create policy system_relationships_insert on public.system_relationships
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_relationships_update on public.system_relationships;
create policy system_relationships_update on public.system_relationships
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_relationships_delete on public.system_relationships;
create policy system_relationships_delete on public.system_relationships
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_interfaces_select on public.system_interfaces;
create policy system_interfaces_select on public.system_interfaces
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_interfaces_insert on public.system_interfaces;
create policy system_interfaces_insert on public.system_interfaces
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_interfaces_update on public.system_interfaces;
create policy system_interfaces_update on public.system_interfaces
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_interfaces_delete on public.system_interfaces;
create policy system_interfaces_delete on public.system_interfaces
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_interface_requirements_select on public.system_interface_requirements;
create policy system_interface_requirements_select on public.system_interface_requirements
  for select to authenticated using (
    exists (select 1 from public.system_interfaces i where i.id = interface_id and (select private.owns_project(i.project_id)))
  );
drop policy if exists system_interface_requirements_insert on public.system_interface_requirements;
create policy system_interface_requirements_insert on public.system_interface_requirements
  for insert to authenticated with check (
    exists (select 1 from public.system_interfaces i where i.id = interface_id and (select private.owns_project(i.project_id)))
    and exists (select 1 from public.product_requirements r where r.id = requirement_id and (select private.owns_project(r.project_id)))
  );
drop policy if exists system_interface_requirements_delete on public.system_interface_requirements;
create policy system_interface_requirements_delete on public.system_interface_requirements
  for delete to authenticated using (
    exists (select 1 from public.system_interfaces i where i.id = interface_id and (select private.owns_project(i.project_id)))
  );

drop policy if exists system_data_flows_select on public.system_data_flows;
create policy system_data_flows_select on public.system_data_flows
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_data_flows_insert on public.system_data_flows;
create policy system_data_flows_insert on public.system_data_flows
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_data_flows_update on public.system_data_flows;
create policy system_data_flows_update on public.system_data_flows
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_data_flows_delete on public.system_data_flows;
create policy system_data_flows_delete on public.system_data_flows
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_integrations_select on public.system_integrations;
create policy system_integrations_select on public.system_integrations
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_integrations_insert on public.system_integrations;
create policy system_integrations_insert on public.system_integrations
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_integrations_update on public.system_integrations;
create policy system_integrations_update on public.system_integrations
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_integrations_delete on public.system_integrations;
create policy system_integrations_delete on public.system_integrations
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_env_configs_select on public.system_env_configs;
create policy system_env_configs_select on public.system_env_configs
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_env_configs_insert on public.system_env_configs;
create policy system_env_configs_insert on public.system_env_configs
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_env_configs_update on public.system_env_configs;
create policy system_env_configs_update on public.system_env_configs
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_env_configs_delete on public.system_env_configs;
create policy system_env_configs_delete on public.system_env_configs
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_technical_risks_select on public.system_technical_risks;
create policy system_technical_risks_select on public.system_technical_risks
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_technical_risks_insert on public.system_technical_risks;
create policy system_technical_risks_insert on public.system_technical_risks
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_technical_risks_update on public.system_technical_risks;
create policy system_technical_risks_update on public.system_technical_risks
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_technical_risks_delete on public.system_technical_risks;
create policy system_technical_risks_delete on public.system_technical_risks
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_technical_constraints_select on public.system_technical_constraints;
create policy system_technical_constraints_select on public.system_technical_constraints
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_technical_constraints_insert on public.system_technical_constraints;
create policy system_technical_constraints_insert on public.system_technical_constraints
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_technical_constraints_update on public.system_technical_constraints;
create policy system_technical_constraints_update on public.system_technical_constraints
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_technical_constraints_delete on public.system_technical_constraints;
create policy system_technical_constraints_delete on public.system_technical_constraints
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_requirement_coverage_select on public.system_requirement_coverage;
create policy system_requirement_coverage_select on public.system_requirement_coverage
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_requirement_coverage_insert on public.system_requirement_coverage;
create policy system_requirement_coverage_insert on public.system_requirement_coverage
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_requirement_coverage_update on public.system_requirement_coverage;
create policy system_requirement_coverage_update on public.system_requirement_coverage
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_requirement_coverage_delete on public.system_requirement_coverage;
create policy system_requirement_coverage_delete on public.system_requirement_coverage
  for delete to authenticated using ((select private.owns_project(project_id)));

drop policy if exists system_questions_select on public.system_questions;
create policy system_questions_select on public.system_questions
  for select to authenticated using ((select private.owns_project(project_id)));
drop policy if exists system_questions_insert on public.system_questions;
create policy system_questions_insert on public.system_questions
  for insert to authenticated with check ((select private.owns_project(project_id)));
drop policy if exists system_questions_update on public.system_questions;
create policy system_questions_update on public.system_questions
  for update to authenticated using ((select private.owns_project(project_id))) with check ((select private.owns_project(project_id)));
drop policy if exists system_questions_delete on public.system_questions;
create policy system_questions_delete on public.system_questions
  for delete to authenticated using ((select private.owns_project(project_id)));

revoke all on public.system_architectures from public, anon;
revoke all on public.system_architecture_transitions from public, anon;
revoke all on public.system_components from public, anon;
revoke all on public.system_component_requirements from public, anon;
revoke all on public.system_entities from public, anon;
revoke all on public.system_entity_fields from public, anon;
revoke all on public.system_relationships from public, anon;
revoke all on public.system_interfaces from public, anon;
revoke all on public.system_interface_requirements from public, anon;
revoke all on public.system_data_flows from public, anon;
revoke all on public.system_integrations from public, anon;
revoke all on public.system_env_configs from public, anon;
revoke all on public.system_technical_risks from public, anon;
revoke all on public.system_technical_constraints from public, anon;
revoke all on public.system_requirement_coverage from public, anon;
revoke all on public.system_questions from public, anon;

grant select, insert, update, delete on public.system_architectures to authenticated;
grant select, insert on public.system_architecture_transitions to authenticated;
grant select, insert, update, delete on public.system_components to authenticated;
grant select, insert, delete on public.system_component_requirements to authenticated;
grant select, insert, update, delete on public.system_entities to authenticated;
grant select, insert, update, delete on public.system_entity_fields to authenticated;
grant select, insert, update, delete on public.system_relationships to authenticated;
grant select, insert, update, delete on public.system_interfaces to authenticated;
grant select, insert, delete on public.system_interface_requirements to authenticated;
grant select, insert, update, delete on public.system_data_flows to authenticated;
grant select, insert, update, delete on public.system_integrations to authenticated;
grant select, insert, update, delete on public.system_env_configs to authenticated;
grant select, insert, update, delete on public.system_technical_risks to authenticated;
grant select, insert, update, delete on public.system_technical_constraints to authenticated;
grant select, insert, update, delete on public.system_requirement_coverage to authenticated;
grant select, insert, update, delete on public.system_questions to authenticated;

notify pgrst, 'reload schema';
