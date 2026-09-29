-- Alpha foundation schema for GHOST.
-- Ownership chain: auth.users -> profiles, companies.owner_id -> projects -> project records.
-- The private schema is not exposed through the Data API (see supabase/config.toml schemas).
-- This migration has not been applied to a remote database by virtue of existing as a file.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.project_status as enum (
  'IDEA',
  'PLANNING',
  'READY',
  'BUILDING',
  'BLOCKED',
  'NEEDS_DECISION',
  'READY_FOR_INSPECTION',
  'VERIFIED',
  'DEPLOYED',
  'ON_HOLD',
  'COMPLETED'
);

create type public.knowledge_kind as enum (
  'FACT',
  'REQUIREMENT',
  'DECISION',
  'CONSTRAINT',
  'LESSON'
);

create type public.founder_rule_status as enum (
  'PROPOSED',
  'ACTIVE',
  'RETIRED'
);

create type public.blocker_status as enum (
  'OPEN',
  'RESOLVED'
);

create type public.action_status as enum (
  'OPEN',
  'DONE',
  'CANCELLED'
);

create type public.verification_category as enum (
  'APPLICATION',
  'DATABASE',
  'AUTHENTICATION',
  'PRODUCTION',
  'OTHER'
);

create type public.verification_state as enum (
  'CLAIMED',
  'OBSERVED',
  'VERIFIED',
  'FAILED',
  'NOT_VERIFIED'
);

create type public.memory_scope as enum (
  'FOUNDER_RULE',
  'PROJECT_KNOWLEDGE'
);

create type public.memory_proposal_status as enum (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PROJECT_ONLY'
);

-- ---------------------------------------------------------------------------
-- Private helpers. Security definer functions stay out of the exposed schema.
-- ---------------------------------------------------------------------------

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create or replace function private.assert_same_project_milestone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.milestone_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.milestones as milestone
    where milestone.id = new.milestone_id
      and milestone.project_id = new.project_id
  ) then
    raise exception 'milestone does not belong to this project';
  end if;

  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Founder'
    )
  );
  return new;
end;
$$;

-- Proposal status is meaningful only when review_memory_proposal sets this flag
-- in the same transaction, so APPROVED cannot be written without the rule insert.
create or replace function private.guard_memory_proposal_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if pg_catalog.current_setting('ghost.reviewing_proposal', true) is distinct from 'on' then
      raise exception 'proposal status changes must go through review_memory_proposal';
    end if;
  end if;
  return new;
end;
$$;

-- Direct inserts and status updates cannot create an ACTIVE founder rule.
-- review_memory_proposal sets ghost.reviewing_proposal in the same transaction.
create or replace function private.guard_founder_rule_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'ACTIVE' then
    if pg_catalog.current_setting('ghost.reviewing_proposal', true) is distinct from 'on' then
      raise exception 'active founder rules must be created by review_memory_proposal';
    end if;
  elsif tg_op = 'UPDATE'
    and new.status = 'ACTIVE'
    and old.status is distinct from 'ACTIVE'
  then
    if pg_catalog.current_setting('ghost.reviewing_proposal', true) is distinct from 'on' then
      raise exception 'active founder rules must be approved by review_memory_proposal';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon;
revoke all on function private.assert_same_project_milestone() from public, anon;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.guard_memory_proposal_status() from public, anon;
revoke all on function private.guard_founder_rule_activation() from public, anon;

grant execute on function private.set_updated_at() to authenticated;
grant execute on function private.assert_same_project_milestone() to authenticated;
grant execute on function private.guard_memory_proposal_status() to authenticated;
grant execute on function private.guard_founder_rule_activation() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint profiles_display_name_length check (
    display_name is null or char_length(trim(display_name)) between 1 and 80
  )
);

create table public.companies (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint companies_name_length check (char_length(trim(name)) between 1 and 120),
  constraint companies_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint companies_owner_slug_unique unique (owner_id, slug)
);

create table public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  current_milestone text not null default '',
  status public.project_status not null default 'IDEA',
  repository_url text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint projects_name_length check (char_length(trim(name)) between 1 and 160),
  constraint projects_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint projects_company_slug_unique unique (company_id, slug)
);

create table public.project_knowledge (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.knowledge_kind not null,
  title text not null,
  content text not null,
  source text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint project_knowledge_title_length check (char_length(trim(title)) between 1 and 200),
  constraint project_knowledge_content_present check (char_length(trim(content)) > 0)
);

create table public.founder_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  content text not null,
  origin_project_id uuid references public.projects (id) on delete set null,
  provenance text not null,
  status public.founder_rule_status not null default 'PROPOSED',
  approved_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint founder_rules_title_length check (char_length(trim(title)) between 1 and 200),
  constraint founder_rules_content_present check (char_length(trim(content)) > 0),
  constraint founder_rules_active_has_approval check (
    status <> 'ACTIVE' or approved_at is not null
  )
);

create table public.milestones (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text not null default '',
  status public.project_status not null default 'IDEA',
  position integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint milestones_title_length check (char_length(trim(title)) between 1 and 200),
  constraint milestones_position_nonnegative check (position >= 0)
);

create table public.blockers (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete set null,
  title text not null,
  description text not null default '',
  status public.blocker_status not null default 'OPEN',
  created_at timestamptz not null default pg_catalog.now(),
  resolved_at timestamptz,
  constraint blockers_title_length check (char_length(trim(title)) between 1 and 200),
  constraint blockers_resolved_timestamp check (
    status <> 'RESOLVED' or resolved_at is not null
  )
);

create table public.next_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete set null,
  title text not null,
  description text not null default '',
  status public.action_status not null default 'OPEN',
  position integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  constraint next_actions_title_length check (char_length(trim(title)) between 1 and 200),
  constraint next_actions_position_nonnegative check (position >= 0),
  constraint next_actions_done_timestamp check (
    status <> 'DONE' or completed_at is not null
  )
);

create table public.verification_records (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  category public.verification_category not null,
  target text not null,
  state public.verification_state not null default 'NOT_VERIFIED',
  evidence jsonb not null default '{}'::jsonb,
  checked_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint verification_records_target_length check (char_length(trim(target)) between 1 and 200),
  constraint verification_records_verified_requires_evidence check (
    state <> 'VERIFIED'
    or (
      checked_at is not null
      and evidence <> '{}'::jsonb
    )
  )
);

create table public.memory_proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  proposed_scope public.memory_scope not null,
  title text not null,
  content text not null,
  provenance text not null,
  status public.memory_proposal_status not null default 'PENDING',
  created_at timestamptz not null default pg_catalog.now(),
  reviewed_at timestamptz,
  constraint memory_proposals_title_length check (char_length(trim(title)) between 1 and 200),
  constraint memory_proposals_content_present check (char_length(trim(content)) > 0),
  constraint memory_proposals_reviewed_timestamp check (
    status = 'PENDING' or reviewed_at is not null
  )
);

create index companies_owner_id_idx on public.companies (owner_id);
create index projects_company_id_idx on public.projects (company_id);
create index project_knowledge_project_id_idx on public.project_knowledge (project_id);
create index founder_rules_owner_id_idx on public.founder_rules (owner_id);
create index founder_rules_origin_project_id_idx on public.founder_rules (origin_project_id);
create index milestones_project_position_idx on public.milestones (project_id, position);
create index blockers_project_id_idx on public.blockers (project_id);
create index blockers_milestone_id_idx on public.blockers (milestone_id);
create index next_actions_project_position_idx on public.next_actions (project_id, position);
create index next_actions_milestone_id_idx on public.next_actions (milestone_id);
create index verification_records_project_id_idx on public.verification_records (project_id);
create index memory_proposals_owner_id_idx on public.memory_proposals (owner_id);
create index memory_proposals_project_id_idx on public.memory_proposals (project_id);
create index memory_proposals_pending_idx on public.memory_proposals (owner_id)
  where status = 'PENDING';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function private.set_updated_at();

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function private.set_updated_at();

create trigger project_knowledge_set_updated_at
  before update on public.project_knowledge
  for each row execute function private.set_updated_at();

create trigger founder_rules_set_updated_at
  before update on public.founder_rules
  for each row execute function private.set_updated_at();

create trigger founder_rules_guard_activation
  before insert or update of status on public.founder_rules
  for each row execute function private.guard_founder_rule_activation();

create trigger milestones_set_updated_at
  before update on public.milestones
  for each row execute function private.set_updated_at();

create trigger blockers_milestone_same_project
  before insert or update of milestone_id, project_id on public.blockers
  for each row execute function private.assert_same_project_milestone();

create trigger next_actions_milestone_same_project
  before insert or update of milestone_id, project_id on public.next_actions
  for each row execute function private.assert_same_project_milestone();

create trigger memory_proposals_guard_status
  before update of status on public.memory_proposals
  for each row execute function private.guard_memory_proposal_status();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant execute on function private.handle_new_user() to supabase_auth_admin;
  end if;
end
$$;

-- SQL helpers are created after their tables so the bodies can be validated.
create or replace function private.owns_company(target_company_id uuid)
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

create or replace function private.owns_project(target_project_id uuid)
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
      and company.owner_id = (select auth.uid())
  );
$$;

revoke all on function private.owns_company(uuid) from public, anon;
revoke all on function private.owns_project(uuid) from public, anon;
grant execute on function private.owns_company(uuid) to authenticated;
grant execute on function private.owns_project(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Review workflow. SECURITY INVOKER so row level security still applies.
-- ---------------------------------------------------------------------------

create or replace function public.review_memory_proposal(
  proposal_id uuid,
  decision public.memory_proposal_status
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal public.memory_proposals%rowtype;
begin
  if decision not in ('APPROVED', 'REJECTED', 'PROJECT_ONLY') then
    raise exception 'decision must be APPROVED, REJECTED, or PROJECT_ONLY';
  end if;

  select *
  into proposal
  from public.memory_proposals
  where id = proposal_id
    and status = 'PENDING';

  if not found then
    raise exception 'pending proposal not found';
  end if;

  if decision = 'APPROVED' and proposal.proposed_scope <> 'FOUNDER_RULE' then
    raise exception 'only founder-rule proposals can be approved into founder rules';
  end if;

  if decision = 'PROJECT_ONLY' and proposal.project_id is null then
    raise exception 'project-only review requires a project';
  end if;

  perform pg_catalog.set_config('ghost.reviewing_proposal', 'on', true);

  if decision = 'APPROVED' then
    insert into public.founder_rules (
      owner_id,
      title,
      content,
      origin_project_id,
      provenance,
      status,
      approved_at
    ) values (
      proposal.owner_id,
      proposal.title,
      proposal.content,
      proposal.project_id,
      proposal.provenance,
      'ACTIVE',
      pg_catalog.now()
    );
  elsif decision = 'PROJECT_ONLY' then
    insert into public.project_knowledge (
      project_id,
      kind,
      title,
      content,
      source
    ) values (
      proposal.project_id,
      'LESSON',
      proposal.title,
      proposal.content,
      proposal.provenance
    );
  end if;

  update public.memory_proposals
  set
    status = decision,
    reviewed_at = pg_catalog.now()
  where id = proposal.id
    and status = 'PENDING';
end;
$$;

create or replace function public.retire_founder_rule(rule_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_count integer;
begin
  update public.founder_rules
  set
    status = 'RETIRED',
    updated_at = pg_catalog.now()
  where id = rule_id
    and status = 'ACTIVE';

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    raise exception 'active founder rule not found';
  end if;
end;
$$;

revoke all on function public.review_memory_proposal(uuid, public.memory_proposal_status) from public, anon;
revoke all on function public.retire_founder_rule(uuid) from public, anon;
grant execute on function public.review_memory_proposal(uuid, public.memory_proposal_status) to authenticated;
grant execute on function public.retire_founder_rule(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security. No permissive policies. No anon access.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.projects enable row level security;
alter table public.project_knowledge enable row level security;
alter table public.founder_rules enable row level security;
alter table public.milestones enable row level security;
alter table public.blockers enable row level security;
alter table public.next_actions enable row level security;
alter table public.verification_records enable row level security;
alter table public.memory_proposals enable row level security;

alter table public.profiles force row level security;
alter table public.companies force row level security;
alter table public.projects force row level security;
alter table public.project_knowledge force row level security;
alter table public.founder_rules force row level security;
alter table public.milestones force row level security;
alter table public.blockers force row level security;
alter table public.next_actions force row level security;
alter table public.verification_records force row level security;
alter table public.memory_proposals force row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy companies_select on public.companies
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy companies_insert on public.companies
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy companies_update on public.companies
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy companies_delete on public.companies
  for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy projects_select on public.projects
  for select to authenticated
  using ((select private.owns_company(company_id)));

create policy projects_insert on public.projects
  for insert to authenticated
  with check ((select private.owns_company(company_id)));

create policy projects_update on public.projects
  for update to authenticated
  using ((select private.owns_company(company_id)))
  with check ((select private.owns_company(company_id)));

create policy projects_delete on public.projects
  for delete to authenticated
  using ((select private.owns_company(company_id)));

create policy project_knowledge_select on public.project_knowledge
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy project_knowledge_insert on public.project_knowledge
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy project_knowledge_update on public.project_knowledge
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy project_knowledge_delete on public.project_knowledge
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy founder_rules_select on public.founder_rules
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy founder_rules_insert on public.founder_rules
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      origin_project_id is null
      or (select private.owns_project(origin_project_id))
    )
    and (
      (
        status = 'PROPOSED'
        and approved_at is null
      )
      or (
        status = 'ACTIVE'
        and approved_at is not null
        and pg_catalog.current_setting('ghost.reviewing_proposal', true) = 'on'
      )
    )
  );

create policy founder_rules_update on public.founder_rules
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (
      origin_project_id is null
      or (select private.owns_project(origin_project_id))
    )
  );

create policy founder_rules_delete on public.founder_rules
  for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy milestones_select on public.milestones
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy milestones_insert on public.milestones
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy milestones_update on public.milestones
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy milestones_delete on public.milestones
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy blockers_select on public.blockers
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy blockers_insert on public.blockers
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy blockers_update on public.blockers
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy blockers_delete on public.blockers
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy next_actions_select on public.next_actions
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy next_actions_insert on public.next_actions
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy next_actions_update on public.next_actions
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy next_actions_delete on public.next_actions
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy verification_records_select on public.verification_records
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy verification_records_insert on public.verification_records
  for insert to authenticated
  with check ((select private.owns_project(project_id)));

create policy verification_records_update on public.verification_records
  for update to authenticated
  using ((select private.owns_project(project_id)))
  with check ((select private.owns_project(project_id)));

create policy verification_records_delete on public.verification_records
  for delete to authenticated
  using ((select private.owns_project(project_id)));

create policy memory_proposals_select on public.memory_proposals
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy memory_proposals_insert on public.memory_proposals
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and status = 'PENDING'
    and (
      project_id is null
      or (select private.owns_project(project_id))
    )
  );

create policy memory_proposals_update on public.memory_proposals
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (
      project_id is null
      or (select private.owns_project(project_id))
    )
  );

revoke all on all tables in schema public from public, anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_knowledge to authenticated;
grant select, insert, update, delete on public.founder_rules to authenticated;
grant select, insert, update, delete on public.milestones to authenticated;
grant select, insert, update, delete on public.blockers to authenticated;
grant select, insert, update, delete on public.next_actions to authenticated;
grant select, insert, update, delete on public.verification_records to authenticated;
grant select, insert, update on public.memory_proposals to authenticated;

comment on table public.verification_records is
  'Inspector source. VERIFIED requires checked_at and non-empty evidence. A row is not proof unless its evidence was produced outside the writer.';

comment on table public.memory_proposals is
  'Proposed memory. Status changes are rejected unless review_memory_proposal is running.';

comment on column public.founder_rules.provenance is
  'Why this rule exists, so a later Why view can cite the origin without reconstructing chat history.';

comment on column public.memory_proposals.provenance is
  'Who or what proposed this memory. Founder-authored rows must say so. Do not label founder input as model inference.';
