-- Freeze exact action identity after a request is recorded (Build 09.5 / Approval Center V1).
-- LOCAL ONLY until founder-gated apply. Prevents silent scope/fingerprint rewrites.
-- Do not apply to hosted Supabase without separate founder authorization.

create or replace function private.guard_founder_authorization_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
    or new.project_id is distinct from old.project_id
    or new.environment_label is distinct from old.environment_label
    or new.action_type is distinct from old.action_type
    or new.action_scope is distinct from old.action_scope
    or new.scope_fingerprint is distinct from old.scope_fingerprint
    or new.idempotency_key is distinct from old.idempotency_key
    or new.requested_at is distinct from old.requested_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'authorization identity fields cannot be rewritten'
      using errcode = '42501';
  end if;

  if old.status <> 'PENDING'
    and new.status is distinct from old.status
    and old.status in ('REJECTED', 'REVOKED', 'EXPIRED', 'CONSUMED')
  then
    raise exception 'terminal authorization status cannot change'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists founder_action_authorizations_guard_identity
  on public.founder_action_authorizations;
create trigger founder_action_authorizations_guard_identity
  before update on public.founder_action_authorizations
  for each row execute function private.guard_founder_authorization_identity();

revoke all on function private.guard_founder_authorization_identity() from public, anon, authenticated;
