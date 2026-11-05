-- Additive Opportunity Radar outreach pipeline (stages separate from research status).
-- Preserves existing ceo_opportunities rows and owns_company RLS.

alter table public.ceo_opportunities
  add column if not exists outreach_stage text not null default 'new'
    constraint ceo_opportunities_outreach_stage_check
      check (outreach_stage in ('new', 'waiting', 'sent', 'replied', 'won', 'closed'));

alter table public.ceo_opportunities
  add column if not exists service_interest text not null default ''
    constraint ceo_opportunities_service_interest_check
      check (
        service_interest = ''
        or service_interest in ('website', 'app', 'ads', 'wholesale')
      );

alter table public.ceo_opportunities
  add column if not exists industry text not null default ''
    constraint ceo_opportunities_industry_len check (char_length(industry) <= 120);

alter table public.ceo_opportunities
  add column if not exists market text not null default ''
    constraint ceo_opportunities_market_len check (char_length(market) <= 120);

alter table public.ceo_opportunities
  add column if not exists follow_up_on date;

alter table public.ceo_opportunities
  add column if not exists sent_at timestamptz;

alter table public.ceo_opportunities
  add column if not exists is_mock boolean not null default false;

-- Flag prior MOCK Brave saves (example.com/mock/…) so they stay hidden from outreach.
update public.ceo_opportunities
set is_mock = true
where is_mock = false
  and (
    source_url ilike '%example.com/mock/%'
    or source ilike '%mock%'
  );

create index if not exists ceo_opportunities_outreach_stage_idx
  on public.ceo_opportunities (company_id, outreach_stage, updated_at desc);

create index if not exists ceo_opportunities_follow_up_idx
  on public.ceo_opportunities (company_id, follow_up_on)
  where follow_up_on is not null and outreach_stage = 'sent';

comment on column public.ceo_opportunities.outreach_stage is
  'Outreach pipeline stage (new/waiting/sent/replied/won/closed). Separate from research-task status.';
comment on column public.ceo_opportunities.service_interest is
  'Optional service filter: website, app, ads, wholesale.';
comment on column public.ceo_opportunities.is_mock is
  'True for labeled MOCK Brave results — hidden from outreach and blocked server-side.';
