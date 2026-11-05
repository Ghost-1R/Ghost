-- Companies + Team + dual assignments + activity + company-scoped sales map.
-- Extends single-owner companies without duplicating projects.
-- LIVE gates unchanged; this migration does not enable paid AI.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.company_kind as enum (
  'OPERATING',
  'INTERNAL'
);

create type public.team_role as enum (
  'PROJECT_ADMIN',
  'TEAM_MEMBER'
);

create type public.invitation_status as enum (
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED'
);

create type public.assignment_kind as enum (
  'HUMAN',
  'AI'
);

create type public.assignment_status as enum (
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'IN_REVIEW',
  'COMPLETED',
  'CANCELLED'
);

create type public.activity_actor_kind as enum (
  'PERSON',
  'AI',
  'SYSTEM'
);

create type public.order_fulfillment as enum (
  'SHIPPED',
  'PICKUP',
  'UNKNOWN'
);

create type public.order_payment_state as enum (
  'PAID',
  'REFUNDED',
  'PARTIAL_REFUND'
);

-- ---------------------------------------------------------------------------
-- Companies: operating vs internal catalog metadata
-- ---------------------------------------------------------------------------

alter table public.companies
  add column if not exists kind public.company_kind not null default 'OPERATING',
  add column if not exists site_url text,
  add column if not exists is_catalog boolean not null default false;
-- Note: PG allows multiple ADD COLUMN clauses separated by commas (above).

comment on column public.companies.is_catalog is
  'True for founder catalog companies (Ivoire Market, IM Distributors, Badger United, Internal).';

create table public.company_site_links (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  label text not null,
  url text not null,
  connected boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  constraint company_site_links_label_length check (char_length(trim(label)) between 1 and 120),
  constraint company_site_links_url_present check (char_length(trim(url)) > 0)
);

create index company_site_links_company_id_idx on public.company_site_links (company_id);

-- ---------------------------------------------------------------------------
-- Team: company membership + project scope + invitations
-- ---------------------------------------------------------------------------

create table public.company_memberships (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.team_role not null,
  invited_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint company_memberships_unique_active unique (company_id, user_id)
);

create index company_memberships_user_id_idx on public.company_memberships (user_id)
  where revoked_at is null;
create index company_memberships_company_id_idx on public.company_memberships (company_id)
  where revoked_at is null;

create trigger company_memberships_set_updated_at
  before update on public.company_memberships
  for each row execute function private.set_updated_at();

create table public.project_memberships (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.team_role not null,
  company_membership_id uuid references public.company_memberships (id) on delete cascade,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint project_memberships_unique_active unique (project_id, user_id)
);

create index project_memberships_user_id_idx on public.project_memberships (user_id)
  where revoked_at is null;
create index project_memberships_project_id_idx on public.project_memberships (project_id)
  where revoked_at is null;

create trigger project_memberships_set_updated_at
  before update on public.project_memberships
  for each row execute function private.set_updated_at();

create table public.team_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  role public.team_role not null,
  project_ids uuid[] not null default '{}'::uuid[],
  token text not null,
  status public.invitation_status not null default 'PENDING',
  invited_by uuid not null references auth.users (id) on delete cascade,
  preview_role public.team_role,
  expires_at timestamptz not null default (pg_catalog.now() + interval '14 days'),
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint team_invitations_email_format check (position('@' in email) > 1),
  constraint team_invitations_token_length check (char_length(token) >= 24)
);

create unique index team_invitations_token_uidx on public.team_invitations (token);
create index team_invitations_company_id_idx on public.team_invitations (company_id);
create index team_invitations_email_idx on public.team_invitations (lower(email));

-- ---------------------------------------------------------------------------
-- Work assignments (human | AI)
-- ---------------------------------------------------------------------------

create table public.work_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  next_action_id uuid references public.next_actions (id) on delete set null,
  agent_task_id uuid,
  kind public.assignment_kind not null,
  status public.assignment_status not null default 'ASSIGNED',
  title text not null,
  instructions text not null default '',
  due_at timestamptz,
  assignee_user_id uuid references auth.users (id) on delete set null,
  assigned_by uuid not null references auth.users (id) on delete cascade,
  progress_note text not null default '',
  submission_note text not null default '',
  submitted_at timestamptz,
  review_note text not null default '',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  handed_off_from_assignment_id uuid references public.work_assignments (id) on delete set null,
  map_scope jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint work_assignments_title_length check (char_length(trim(title)) between 1 and 200),
  constraint work_assignments_human_has_assignee check (
    kind <> 'HUMAN' or assignee_user_id is not null
  ),
  constraint work_assignments_ai_no_human_assignee check (
    kind <> 'AI' or assignee_user_id is null
  )
);

create index work_assignments_project_id_idx on public.work_assignments (project_id);
create index work_assignments_assignee_idx on public.work_assignments (assignee_user_id)
  where assignee_user_id is not null;
create index work_assignments_company_id_idx on public.work_assignments (company_id);

create trigger work_assignments_set_updated_at
  before update on public.work_assignments
  for each row execute function private.set_updated_at();

-- Optional FK to agent_tasks when that table exists.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'agent_tasks'
  ) then
    alter table public.work_assignments
      add constraint work_assignments_agent_task_fk
      foreign key (agent_task_id) references public.agent_tasks (id) on delete set null;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Activity timeline + session presence
-- ---------------------------------------------------------------------------

create table public.project_activity_events (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  actor_kind public.activity_actor_kind not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_label text not null default '',
  action text not null,
  summary text not null,
  record_type text,
  record_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  external_unconnected boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  constraint project_activity_events_action_length check (char_length(trim(action)) between 1 and 80),
  constraint project_activity_events_summary_present check (char_length(trim(summary)) > 0)
);

create index project_activity_events_project_created_idx
  on public.project_activity_events (project_id, created_at desc);
create index project_activity_events_company_created_idx
  on public.project_activity_events (company_id, created_at desc);

create table public.user_presence_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  event_type text not null check (event_type in ('SIGN_IN', 'SIGN_OUT', 'LAST_ACTIVE')),
  observed_at timestamptz not null default pg_catalog.now(),
  metadata jsonb not null default '{}'::jsonb
);

create index user_presence_events_user_observed_idx
  on public.user_presence_events (user_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- Sales map: orders + ZIP centroids + map grants
-- ---------------------------------------------------------------------------

create table public.zip_centroids (
  zip text primary key,
  state_code char(2) not null,
  city text not null default '',
  lat double precision not null,
  lng double precision not null,
  constraint zip_centroids_zip_format check (zip ~ '^[0-9]{5}$')
);

create table public.company_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  external_order_id text not null,
  customer_key text not null,
  paid_at timestamptz not null,
  amount_cents integer not null check (amount_cents >= 0),
  payment_state public.order_payment_state not null default 'PAID',
  fulfillment public.order_fulfillment not null default 'SHIPPED',
  shipping_zip text,
  shipping_state char(2),
  is_test boolean not null default true,
  history_complete boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  constraint company_orders_external_unique unique (company_id, external_order_id),
  constraint company_orders_zip_format check (
    shipping_zip is null or shipping_zip ~ '^[0-9]{5}$'
  )
);

create index company_orders_company_paid_idx on public.company_orders (company_id, paid_at);
create index company_orders_company_zip_idx on public.company_orders (company_id, shipping_zip);

create table public.company_sales_sync (
  company_id uuid primary key references public.companies (id) on delete cascade,
  source_label text not null default 'Labeled test orders',
  last_synced_at timestamptz not null default pg_catalog.now(),
  history_complete boolean not null default true,
  notes text not null default ''
);

create table public.company_map_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid not null references auth.users (id) on delete cascade,
  can_view_summaries boolean not null default true,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint company_map_grants_unique unique (company_id, user_id)
);

create index company_map_grants_user_idx on public.company_map_grants (user_id)
  where revoked_at is null;

create table public.company_prospects (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  label text not null,
  zip text,
  state_code char(2),
  notes text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  constraint company_prospects_label_length check (char_length(trim(label)) between 1 and 160)
);

-- ---------------------------------------------------------------------------
-- Access helpers (founder ownership preserved; memberships additive)
-- ---------------------------------------------------------------------------

create or replace function private.is_company_owner(target_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.companies
    where id = target_company_id
      and owner_id = (select auth.uid())
  );
$$;

create or replace function private.has_active_company_membership(target_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_memberships
    where company_id = target_company_id
      and user_id = (select auth.uid())
      and revoked_at is null
  );
$$;

create or replace function private.has_company_admin(target_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_company_owner(target_company_id)
    or exists (
      select 1
      from public.company_memberships
      where company_id = target_company_id
        and user_id = (select auth.uid())
        and revoked_at is null
        and role = 'PROJECT_ADMIN'
    );
$$;

create or replace function private.can_select_company(target_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_company_owner(target_company_id)
    or private.has_active_company_membership(target_company_id);
$$;

create or replace function private.can_select_project(target_project_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    join public.companies as company on company.id = project.company_id
    where project.id = target_project_id
      and (
        company.owner_id = (select auth.uid())
        or exists (
          select 1
          from public.company_memberships as membership
          where membership.company_id = company.id
            and membership.user_id = (select auth.uid())
            and membership.revoked_at is null
            and membership.role = 'PROJECT_ADMIN'
        )
        or exists (
          select 1
          from public.project_memberships as pm
          where pm.project_id = project.id
            and pm.user_id = (select auth.uid())
            and pm.revoked_at is null
        )
      )
  );
$$;

create or replace function private.can_admin_project(target_project_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    join public.companies as company on company.id = project.company_id
    where project.id = target_project_id
      and (
        company.owner_id = (select auth.uid())
        or exists (
          select 1
          from public.company_memberships as membership
          where membership.company_id = company.id
            and membership.user_id = (select auth.uid())
            and membership.revoked_at is null
            and membership.role = 'PROJECT_ADMIN'
        )
        or exists (
          select 1
          from public.project_memberships as pm
          where pm.project_id = project.id
            and pm.user_id = (select auth.uid())
            and pm.revoked_at is null
            and pm.role = 'PROJECT_ADMIN'
        )
      )
  );
$$;

create or replace function private.can_view_company_map(target_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_company_owner(target_company_id)
    or exists (
      select 1
      from public.company_map_grants as grant_row
      where grant_row.company_id = target_company_id
        and grant_row.user_id = (select auth.uid())
        and grant_row.revoked_at is null
        and grant_row.can_view_summaries
    );
$$;

create or replace function private.is_assignment_assignee(target_assignment_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.work_assignments
    where id = target_assignment_id
      and assignee_user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_company_owner(uuid) from public, anon;
revoke all on function private.has_active_company_membership(uuid) from public, anon;
revoke all on function private.has_company_admin(uuid) from public, anon;
revoke all on function private.can_select_company(uuid) from public, anon;
revoke all on function private.can_select_project(uuid) from public, anon;
revoke all on function private.can_admin_project(uuid) from public, anon;
revoke all on function private.can_view_company_map(uuid) from public, anon;
revoke all on function private.is_assignment_assignee(uuid) from public, anon;

grant execute on function private.is_company_owner(uuid) to authenticated;
grant execute on function private.has_active_company_membership(uuid) to authenticated;
grant execute on function private.has_company_admin(uuid) to authenticated;
grant execute on function private.can_select_company(uuid) to authenticated;
grant execute on function private.can_select_project(uuid) to authenticated;
grant execute on function private.can_admin_project(uuid) to authenticated;
grant execute on function private.can_view_company_map(uuid) to authenticated;
grant execute on function private.is_assignment_assignee(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Activity writer (security definer; validates caller access)
-- ---------------------------------------------------------------------------

create or replace function public.record_project_activity(
  p_company_id uuid,
  p_project_id uuid,
  p_actor_kind public.activity_actor_kind,
  p_action text,
  p_summary text,
  p_record_type text default null,
  p_record_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_external_unconnected boolean default false,
  p_actor_label text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not (
    private.is_company_owner(p_company_id)
    or private.has_active_company_membership(p_company_id)
    or (p_project_id is not null and private.can_select_project(p_project_id))
  ) then
    raise exception 'not allowed to record activity for this company';
  end if;

  insert into public.project_activity_events (
    company_id,
    project_id,
    actor_kind,
    actor_user_id,
    actor_label,
    action,
    summary,
    record_type,
    record_id,
    metadata,
    external_unconnected
  ) values (
    p_company_id,
    p_project_id,
    p_actor_kind,
    case when p_actor_kind = 'PERSON' then v_uid else null end,
    coalesce(nullif(trim(p_actor_label), ''), case when p_actor_kind = 'AI' then 'Ghost AI' else '' end),
    p_action,
    p_summary,
    p_record_type,
    p_record_id,
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_external_unconnected, false)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_project_activity(
  uuid, uuid, public.activity_actor_kind, text, text, text, uuid, jsonb, boolean, text
) from public, anon;
grant execute on function public.record_project_activity(
  uuid, uuid, public.activity_actor_kind, text, text, text, uuid, jsonb, boolean, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.company_site_links enable row level security;
alter table public.company_memberships enable row level security;
alter table public.project_memberships enable row level security;
alter table public.team_invitations enable row level security;
alter table public.work_assignments enable row level security;
alter table public.project_activity_events enable row level security;
alter table public.user_presence_events enable row level security;
alter table public.zip_centroids enable row level security;
alter table public.company_orders enable row level security;
alter table public.company_sales_sync enable row level security;
alter table public.company_map_grants enable row level security;
alter table public.company_prospects enable row level security;

-- Additive company/project select for members (owner policies already exist).
create policy companies_member_select on public.companies
  for select to authenticated
  using ((select private.has_active_company_membership(id)));

create policy projects_member_select on public.projects
  for select to authenticated
  using ((select private.can_select_project(id)));

create policy next_actions_member_select on public.next_actions
  for select to authenticated
  using ((select private.can_select_project(project_id)));

create policy company_site_links_select on public.company_site_links
  for select to authenticated
  using ((select private.can_select_company(company_id)));

create policy company_site_links_owner_write on public.company_site_links
  for all to authenticated
  using ((select private.is_company_owner(company_id)))
  with check ((select private.is_company_owner(company_id)));

create policy company_memberships_select on public.company_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_company_owner(company_id))
    or (select private.has_company_admin(company_id))
  );

create policy company_memberships_owner_write on public.company_memberships
  for all to authenticated
  using ((select private.is_company_owner(company_id)))
  with check ((select private.is_company_owner(company_id)));

create policy project_memberships_select on public.project_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.can_admin_project(project_id))
  );

create policy project_memberships_admin_write on public.project_memberships
  for all to authenticated
  using ((select private.can_admin_project(project_id)))
  with check ((select private.can_admin_project(project_id)));

create policy team_invitations_select on public.team_invitations
  for select to authenticated
  using (
    (select private.is_company_owner(company_id))
    or lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

create policy team_invitations_owner_write on public.team_invitations
  for all to authenticated
  using ((select private.is_company_owner(company_id)))
  with check ((select private.is_company_owner(company_id)));

create policy work_assignments_select on public.work_assignments
  for select to authenticated
  using (
    (select private.can_select_project(project_id))
    or assignee_user_id = (select auth.uid())
  );

create policy work_assignments_admin_insert on public.work_assignments
  for insert to authenticated
  with check ((select private.can_admin_project(project_id)));

create policy work_assignments_admin_update on public.work_assignments
  for update to authenticated
  using ((select private.can_admin_project(project_id)))
  with check ((select private.can_admin_project(project_id)));

create policy work_assignments_assignee_update on public.work_assignments
  for update to authenticated
  using (assignee_user_id = (select auth.uid()))
  with check (assignee_user_id = (select auth.uid()));

create policy project_activity_events_select on public.project_activity_events
  for select to authenticated
  using (
    (select private.can_select_company(company_id))
    or (project_id is not null and (select private.can_select_project(project_id)))
  );

create policy project_activity_events_insert on public.project_activity_events
  for insert to authenticated
  with check (
    (select private.can_select_company(company_id))
    or (project_id is not null and (select private.can_select_project(project_id)))
  );

create policy user_presence_events_select on public.user_presence_events
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      company_id is not null
      and (select private.is_company_owner(company_id))
    )
  );

create policy user_presence_events_insert on public.user_presence_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy zip_centroids_select on public.zip_centroids
  for select to authenticated
  using (true);

create policy company_orders_select on public.company_orders
  for select to authenticated
  using ((select private.can_view_company_map(company_id)));

create policy company_orders_owner_write on public.company_orders
  for all to authenticated
  using ((select private.is_company_owner(company_id)))
  with check ((select private.is_company_owner(company_id)));

create policy company_sales_sync_select on public.company_sales_sync
  for select to authenticated
  using ((select private.can_view_company_map(company_id)));

create policy company_sales_sync_owner_write on public.company_sales_sync
  for all to authenticated
  using ((select private.is_company_owner(company_id)))
  with check ((select private.is_company_owner(company_id)));

create policy company_map_grants_select on public.company_map_grants
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_company_owner(company_id))
  );

create policy company_map_grants_owner_write on public.company_map_grants
  for all to authenticated
  using ((select private.is_company_owner(company_id)))
  with check ((select private.is_company_owner(company_id)));

create policy company_prospects_select on public.company_prospects
  for select to authenticated
  using ((select private.can_view_company_map(company_id)));

create policy company_prospects_owner_write on public.company_prospects
  for all to authenticated
  using ((select private.is_company_owner(company_id)))
  with check ((select private.is_company_owner(company_id)));

-- Seed reference ZIP centroids used by local sales-map verification.
insert into public.zip_centroids (zip, state_code, city, lat, lng) values
  ('10001', 'NY', 'New York', 40.7506, -73.9971),
  ('10011', 'NY', 'New York', 40.7420, -74.0010),
  ('11201', 'NY', 'Brooklyn', 40.6940, -73.9900),
  ('30301', 'GA', 'Atlanta', 33.7490, -84.3880),
  ('30308', 'GA', 'Atlanta', 33.7710, -84.3760),
  ('60601', 'IL', 'Chicago', 41.8850, -87.6220),
  ('60614', 'IL', 'Chicago', 41.9220, -87.6450),
  ('75201', 'TX', 'Dallas', 32.7870, -96.7980),
  ('78701', 'TX', 'Austin', 30.2710, -97.7430),
  ('90210', 'CA', 'Beverly Hills', 34.0901, -118.4065),
  ('94105', 'CA', 'San Francisco', 37.7890, -122.3910),
  ('98101', 'WA', 'Seattle', 47.6100, -122.3350)
on conflict (zip) do nothing;
