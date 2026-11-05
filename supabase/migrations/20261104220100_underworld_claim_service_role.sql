-- Allow atomic step claims from service role (auth.uid null) used by workers/tests.
-- Authenticated founders still claim via the same function. LIVE unchanged.

create or replace function public.claim_underworld_step(
  p_step_id uuid,
  p_lease_owner text,
  p_lease_seconds integer default 120
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_lease_owner is null or char_length(trim(p_lease_owner)) < 1 then
    raise exception 'lease owner required';
  end if;

  update public.underworld_steps as step
  set
    status = 'CLAIMED',
    lease_owner = p_lease_owner,
    lease_expires_at = pg_catalog.now() + make_interval(secs => greatest(p_lease_seconds, 30)),
    attempt_count = step.attempt_count + 1,
    updated_at = pg_catalog.now()
  where step.id = p_step_id
    and step.status in ('READY', 'CHECKPOINT')
    and step.attempt_count < step.max_attempts
    and (
      step.lease_expires_at is null
      or step.lease_expires_at < pg_catalog.now()
      or step.lease_owner = p_lease_owner
    )
  returning step.id into v_id;

  return v_id;
end;
$$;
