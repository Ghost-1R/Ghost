-- Build 09.9E — insert/update authorization match for agent_tasks (LOCAL ONLY).
-- Closes SCOPE_MISMATCH_REJECTED: task binding fields must match the referenced
-- founder_action_authorizations row on INSERT and UPDATE.
-- Does not weaken RLS, immutable-identity guards, or one-time consumption.
-- Do not apply to hosted Supabase without separate founder authorization.

create or replace function private.assert_agent_task_matches_authorization()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  auth_owner uuid;
  auth_project uuid;
  auth_action_type text;
  auth_action_scope text;
  auth_environment text;
  auth_fingerprint text;
  expected_kind public.agent_authorization_kind;
begin
  select
    a.owner_id,
    a.project_id,
    a.action_type,
    a.action_scope,
    a.environment_label,
    a.scope_fingerprint
  into
    auth_owner,
    auth_project,
    auth_action_type,
    auth_action_scope,
    auth_environment,
    auth_fingerprint
  from public.founder_action_authorizations a
  where a.id = new.authorization_id;

  if auth_owner is null then
    raise exception 'agent task authorization_id does not reference an existing authorization'
      using errcode = '23503';
  end if;

  if new.owner_id is distinct from auth_owner
    or new.project_id is distinct from auth_project
    or new.action_type is distinct from auth_action_type
    or new.action_scope is distinct from auth_action_scope
    or new.environment_label is distinct from auth_environment
    or new.scope_fingerprint is distinct from auth_fingerprint
  then
    raise exception 'agent task binding does not match authorization identity (owner/project/action/scope/environment/fingerprint)'
      using errcode = '42501';
  end if;

  -- Kind must match the canonical action-type class (development never implies deployment).
  if new.action_type in (
    'agent_task.deploy',
    'agent_task.release'
  ) then
    expected_kind := 'DEPLOYMENT';
  elsif new.action_type in (
    'agent_task.develop',
    'agent_task.implement',
    'agent_task.refactor',
    'agent_task.test',
    'agent_task.inspect'
  ) then
    expected_kind := 'DEVELOPMENT';
  else
    raise exception 'agent task action_type is not an approved DEVELOPMENT or DEPLOYMENT action'
      using errcode = '42501';
  end if;

  if new.authorization_kind is distinct from expected_kind then
    raise exception 'agent task authorization_kind does not match action_type class'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists agent_tasks_match_authorization on public.agent_tasks;
create trigger agent_tasks_match_authorization
  before insert or update on public.agent_tasks
  for each row execute function private.assert_agent_task_matches_authorization();

revoke all on function private.assert_agent_task_matches_authorization() from public, anon, authenticated;

comment on function private.assert_agent_task_matches_authorization() is
  'Fail closed: agent_tasks binding fields must match founder_action_authorizations on INSERT and UPDATE.';
