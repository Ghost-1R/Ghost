-- AI lead workers (Will / Bubba) for Opportunity Radar — Badger United.
-- Additive. Scheduler stays off until ceo_lead_worker_config.enabled = true.
-- Outreach stages remain separate from research-task status.

alter table public.ceo_opportunities
  add column if not exists discovered_by_worker text not null default ''
    constraint ceo_opportunities_discovered_by_worker_len check (char_length(discovered_by_worker) <= 40);

alter table public.ceo_opportunities
  add column if not exists discovery_run_id uuid;

alter table public.ceo_opportunities
  add column if not exists evidence_signal text not null default ''
    constraint ceo_opportunities_evidence_signal_len check (char_length(evidence_signal) <= 500);

alter table public.ceo_opportunities
  add column if not exists outreach_draft text not null default ''
    constraint ceo_opportunities_outreach_draft_len check (char_length(outreach_draft) <= 4000);

alter table public.ceo_opportunities
  add column if not exists do_not_contact boolean not null default false;

create table if not exists public.ceo_lead_workers (
  slug text primary key
    constraint ceo_lead_workers_slug_check check (slug in ('will', 'bubba')),
  display_name text not null
    constraint ceo_lead_workers_name_len check (char_length(trim(display_name)) between 1 and 80),
  color_hex text not null
    constraint ceo_lead_workers_color_len check (char_length(color_hex) between 4 and 9),
  shift_start_hour integer not null
    constraint ceo_lead_workers_start_hour check (shift_start_hour between 0 and 23),
  shift_end_hour integer not null
    constraint ceo_lead_workers_end_hour check (shift_end_hour between 0 and 23),
  timezone text not null default 'America/New_York'
    constraint ceo_lead_workers_tz_len check (char_length(trim(timezone)) between 1 and 80),
  created_at timestamptz not null default now()
);

insert into public.ceo_lead_workers (slug, display_name, color_hex, shift_start_hour, shift_end_hour, timezone)
values
  ('will', 'Will', '#3b82f6', 8, 20, 'America/New_York'),
  ('bubba', 'Bubba', '#f59e0b', 20, 8, 'America/New_York')
on conflict (slug) do nothing;

create table if not exists public.ceo_lead_worker_config (
  id uuid primary key default extensions.gen_random_uuid(),
  company_slug text not null default 'badger-united'
    constraint ceo_lead_worker_config_slug_len check (char_length(trim(company_slug)) between 1 and 80),
  company_id uuid references public.companies (id) on delete set null,
  owner_id uuid references auth.users (id) on delete set null,
  enabled boolean not null default false,
  paused boolean not null default false,
  daily_brave_cap integer not null default 24
    constraint ceo_lead_worker_config_cap check (daily_brave_cap between 1 and 500),
  brave_requests_today integer not null default 0
    constraint ceo_lead_worker_config_used check (brave_requests_today >= 0),
  brave_quota_day text not null default ''
    constraint ceo_lead_worker_config_quota_day_len check (char_length(brave_quota_day) <= 16),
  industries jsonb not null default '["driving schools","independent car rentals","painting remodeling companies"]'::jsonb,
  markets jsonb not null default '["Atlanta, GA","Norcross, GA","Marietta, GA","Decatur, GA","Alpharetta, GA"]'::jsonb,
  services jsonb not null default '["website","app","ads"]'::jsonb,
  cursor jsonb not null default '{"industryIdx":0,"marketIdx":0,"serviceIdx":0}'::jsonb,
  last_handoff jsonb not null default '{}'::jsonb,
  last_blocker text not null default ''
    constraint ceo_lead_worker_config_blocker_len check (char_length(last_blocker) <= 2000),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ceo_lead_worker_config_one_row check (true)
);

-- Seed a single config row when empty.
insert into public.ceo_lead_worker_config (company_slug)
select 'badger-united'
where not exists (select 1 from public.ceo_lead_worker_config);

update public.ceo_lead_worker_config c
set company_id = co.id,
    owner_id = coalesce(c.owner_id, co.owner_id),
    updated_at = now()
from public.companies co
where c.company_id is null
  and co.slug = c.company_slug;

create table if not exists public.ceo_lead_worker_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  worker_slug text not null references public.ceo_lead_workers (slug),
  company_id uuid not null references public.companies (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'queued'
    constraint ceo_lead_worker_runs_status_check
      check (status in ('queued', 'running', 'completed', 'failed', 'skipped', 'blocked')),
  idempotency_key text not null
    constraint ceo_lead_worker_runs_idem_len check (char_length(trim(idempotency_key)) between 8 and 200),
  trigger_kind text not null default 'schedule'
    constraint ceo_lead_worker_runs_trigger_check check (trigger_kind in ('schedule', 'manual', 'retry')),
  industry text not null default ''
    constraint ceo_lead_worker_runs_industry_len check (char_length(industry) <= 120),
  market text not null default ''
    constraint ceo_lead_worker_runs_market_len check (char_length(market) <= 120),
  service_interest text not null default ''
    constraint ceo_lead_worker_runs_service_len check (char_length(service_interest) <= 40),
  query_used text not null default ''
    constraint ceo_lead_worker_runs_query_len check (char_length(query_used) <= 400),
  leads_added integer not null default 0
    constraint ceo_lead_worker_runs_leads_nonneg check (leads_added >= 0),
  candidates_seen integer not null default 0
    constraint ceo_lead_worker_runs_seen_nonneg check (candidates_seen >= 0),
  brave_requests integer not null default 0
    constraint ceo_lead_worker_runs_brave_nonneg check (brave_requests >= 0),
  cursor_before jsonb not null default '{}'::jsonb,
  cursor_after jsonb not null default '{}'::jsonb,
  result_summary text not null default ''
    constraint ceo_lead_worker_runs_summary_len check (char_length(result_summary) <= 2000),
  blocker text not null default ''
    constraint ceo_lead_worker_runs_blocker_len check (char_length(blocker) <= 2000),
  lease_token text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ceo_lead_worker_runs_idempotency unique (idempotency_key)
);

create index if not exists ceo_lead_worker_runs_company_created_idx
  on public.ceo_lead_worker_runs (company_id, created_at desc);

create index if not exists ceo_lead_worker_runs_status_idx
  on public.ceo_lead_worker_runs (status, created_at desc)
  where status in ('queued', 'running');

alter table public.ceo_lead_worker_config enable row level security;
alter table public.ceo_lead_worker_config force row level security;
alter table public.ceo_lead_workers enable row level security;
alter table public.ceo_lead_workers force row level security;
alter table public.ceo_lead_worker_runs enable row level security;
alter table public.ceo_lead_worker_runs force row level security;

-- Founders who own the bound company can read config/runs; workers table is readable to authenticated.
create policy ceo_lead_workers_select on public.ceo_lead_workers
  for select to authenticated
  using (true);

create policy ceo_lead_worker_config_select on public.ceo_lead_worker_config
  for select to authenticated
  using (
    company_id is null
    or (select private.owns_company(company_id))
  );

create policy ceo_lead_worker_config_update on public.ceo_lead_worker_config
  for update to authenticated
  using (
    company_id is not null
    and (select private.owns_company(company_id))
  )
  with check (
    company_id is not null
    and (select private.owns_company(company_id))
  );

create policy ceo_lead_worker_runs_select on public.ceo_lead_worker_runs
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  );

comment on table public.ceo_lead_workers is
  'Named Opportunity Radar lead workers (Will day / Bubba night).';
comment on table public.ceo_lead_worker_config is
  'Lead-finder scheduler config. Off by default until enabled.';
comment on table public.ceo_lead_worker_runs is
  'Idempotent hourly (or manual) lead-finder runs with cursor handoff.';
