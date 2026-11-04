-- Pilot 01 / Build 09.9F follow-up — reject NEW agent_task bindings against
-- revoked, rejected, expired, or time-expired authorizations (LOCAL ONLY).
-- Additive: replaces assert_agent_task_matches_authorization while preserving
-- field-match and kind checks from 20261011092000.
-- INSERT-only lifecycle gate: existing bound tasks may still UPDATE non-binding
-- fields (checkpoints/status) so in-flight recovery and auditability remain.
-- CONSUMED remains allowed (queue consumes ONE_TIME then inserts the task).
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
  auth_status public.founder_authorization_status;
  auth_expires_at timestamptz;
  expected_kind public.agent_authorization_kind;
begin
  select
    a.owner_id,
    a.project_id,
    a.action_type,
    a.action_scope,
    a.environment_label,
    a.scope_fingerprint,
    a.status,
    a.expires_at
  into
    auth_owner,
    auth_project,
    auth_action_type,
    auth_action_scope,
    auth_environment,
    auth_fingerprint,
    auth_status,
    auth_expires_at
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

  -- New bindings only: fail closed on revoked / rejected / expired authorizations.
  -- Does not rewrite historical rows; execution-time revalidation remains required.
  if tg_op = 'INSERT' then
    if auth_status in ('REVOKED', 'REJECTED', 'EXPIRED') then
      raise exception 'agent task cannot bind to revoked, rejected, or expired authorization'
        using errcode = '42501';
    end if;

    if auth_expires_at is null or auth_expires_at <= pg_catalog.now() then
      raise exception 'agent task cannot bind to time-expired authorization'
        using errcode = '42501';
    end if;

    if auth_status not in ('APPROVED', 'CONSUMED') then
      raise exception 'agent task can only bind to APPROVED or CONSUMED authorization'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.assert_agent_task_matches_authorization() is
  'Fail closed: match authorization identity on INSERT/UPDATE; reject revoked/expired NEW bindings on INSERT only.';
