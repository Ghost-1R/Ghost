-- Invitation accept/preview RPCs.
-- An invitee is not yet a company member, so RLS (owner-only writes on
-- company_memberships / project_memberships / team_invitations) blocks a
-- direct accept. These security-definer functions validate the token and the
-- caller's verified email, then perform the grant atomically.
-- LIVE gates unchanged; this migration does not enable paid AI.

create or replace function public.get_team_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  inv public.team_invitations;
  v_company_name text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into inv from public.team_invitations where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select name into v_company_name from public.companies where id = inv.company_id;

  return jsonb_build_object(
    'ok', true,
    'company_id', inv.company_id,
    'company_name', coalesce(v_company_name, ''),
    'email', inv.email,
    'role', inv.role,
    'status', case
      when inv.status = 'PENDING' and inv.expires_at < pg_catalog.now() then 'EXPIRED'
      else inv.status::text
    end,
    'expires_at', inv.expires_at,
    'project_count', coalesce(pg_catalog.cardinality(inv.project_ids), 0),
    'email_matches', lower(inv.email) = v_email
  );
end;
$$;

create or replace function public.accept_team_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  inv public.team_invitations;
  v_membership_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into inv from public.team_invitations where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if inv.status <> 'PENDING' then
    return jsonb_build_object('ok', false, 'error', pg_catalog.lower(inv.status::text));
  end if;

  if inv.expires_at < pg_catalog.now() then
    update public.team_invitations set status = 'EXPIRED' where id = inv.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if lower(inv.email) <> v_email then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;

  insert into public.company_memberships (company_id, user_id, role, invited_by)
  values (inv.company_id, v_uid, inv.role, inv.invited_by)
  on conflict (company_id, user_id) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        revoked_at = null
  returning id into v_membership_id;

  insert into public.project_memberships (project_id, user_id, role, company_membership_id)
  select project.id, v_uid, inv.role, v_membership_id
  from public.projects as project
  where project.company_id = inv.company_id
    and project.id = any (inv.project_ids)
  on conflict (project_id, user_id) do update
    set role = excluded.role,
        company_membership_id = excluded.company_membership_id,
        revoked_at = null;

  update public.team_invitations
  set status = 'ACCEPTED',
      accepted_by = v_uid,
      accepted_at = pg_catalog.now()
  where id = inv.id;

  insert into public.project_activity_events (
    company_id, project_id, actor_kind, actor_user_id, action, summary, record_type, record_id
  ) values (
    inv.company_id, null, 'PERSON', v_uid, 'invitation.accepted',
    'Teammate accepted an invitation as ' || pg_catalog.replace(inv.role::text, '_', ' '),
    'team_invitation', inv.id
  );

  return jsonb_build_object('ok', true, 'company_id', inv.company_id, 'role', inv.role);
end;
$$;

revoke all on function public.get_team_invitation(text) from public, anon;
revoke all on function public.accept_team_invitation(text) from public, anon;
grant execute on function public.get_team_invitation(text) to authenticated;
grant execute on function public.accept_team_invitation(text) to authenticated;
