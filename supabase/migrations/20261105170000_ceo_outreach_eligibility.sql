-- Recipient eligibility for Outreach (opt-in or documented request).
-- Public email alone is not enough to queue or send. Will/Bubba discovery unchanged.

create table if not exists public.ceo_outreach_eligibility (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  opportunity_id uuid not null references public.ceo_opportunities (id) on delete cascade,
  recipient_email text not null
    constraint ceo_outreach_eligibility_email_len check (char_length(trim(recipient_email)) between 3 and 320),
  kind text not null
    constraint ceo_outreach_eligibility_kind_check check (kind in ('opt_in', 'documented_request')),
  source text not null
    constraint ceo_outreach_eligibility_source_len check (char_length(trim(source)) between 3 and 500),
  scope text not null
    constraint ceo_outreach_eligibility_scope_check check (
      scope in (
        'commercial_introduction',
        'service_website',
        'service_app',
        'service_ads',
        'service_wholesale',
        'follow_up'
      )
    ),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users (id) on delete set null,
  notes text not null default ''
    constraint ceo_outreach_eligibility_notes_len check (char_length(notes) <= 1000),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ceo_outreach_eligibility_opp_idx
  on public.ceo_outreach_eligibility (opportunity_id, recorded_at desc);

create index if not exists ceo_outreach_eligibility_email_idx
  on public.ceo_outreach_eligibility (company_id, recipient_email)
  where revoked_at is null;

alter table public.ceo_outreach_messages
  add column if not exists eligibility_id uuid references public.ceo_outreach_eligibility (id) on delete set null;

alter table public.ceo_outreach_messages
  add column if not exists eligibility_scope text not null default ''
    constraint ceo_outreach_messages_eligibility_scope_len check (char_length(eligibility_scope) <= 40);

alter table public.ceo_outreach_eligibility enable row level security;
alter table public.ceo_outreach_eligibility force row level security;

create policy ceo_outreach_eligibility_select on public.ceo_outreach_eligibility
  for select to authenticated
  using ((select private.owns_company(company_id)));

create policy ceo_outreach_eligibility_insert on public.ceo_outreach_eligibility
  for insert to authenticated
  with check ((select private.owns_company(company_id)));

create policy ceo_outreach_eligibility_update on public.ceo_outreach_eligibility
  for update to authenticated
  using ((select private.owns_company(company_id)))
  with check ((select private.owns_company(company_id)));

comment on table public.ceo_outreach_eligibility is
  'Opt-in or documented recipient request covering a specific Outreach email scope. Public email alone is insufficient.';
