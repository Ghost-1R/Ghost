-- CEO Command: opportunities + finance ledger (LOCAL / disposable first).
-- Do not invent cash from unpaid orders. LIVE payment processing is out of scope.
-- Founder-owned company scope via owns_company.

create table if not exists public.ceo_opportunities (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null
    constraint ceo_opportunities_title_len check (char_length(trim(title)) between 1 and 200),
  value_cents integer not null default 0
    constraint ceo_opportunities_value_nonneg check (value_cents >= 0),
  currency text not null default 'USD'
    constraint ceo_opportunities_currency_len check (char_length(currency) = 3),
  score integer
    constraint ceo_opportunities_score_range check (score is null or (score >= 0 and score <= 100)),
  geography text not null default ''
    constraint ceo_opportunities_geo_len check (char_length(geography) <= 120),
  status text not null default 'NEW'
    constraint ceo_opportunities_status_len check (char_length(trim(status)) between 1 and 40),
  source text not null default 'manual'
    constraint ceo_opportunities_source_len check (char_length(trim(source)) between 1 and 80),
  fit_reason text not null default ''
    constraint ceo_opportunities_fit_len check (char_length(fit_reason) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ceo_opportunities_owner_updated_idx
  on public.ceo_opportunities (owner_id, updated_at desc);
create index if not exists ceo_opportunities_company_idx
  on public.ceo_opportunities (company_id, updated_at desc);

alter table public.ceo_opportunities enable row level security;
alter table public.ceo_opportunities force row level security;

create policy ceo_opportunities_select on public.ceo_opportunities
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  );

create policy ceo_opportunities_insert on public.ceo_opportunities
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  );

create policy ceo_opportunities_update on public.ceo_opportunities
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  );

create table if not exists public.ceo_finance_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null
    constraint ceo_finance_kind_check check (kind in ('CASH', 'INVOICE', 'EXPENSE', 'REFUND')),
  amount_cents integer not null
    constraint ceo_finance_amount_nonzero check (amount_cents <> 0),
  currency text not null default 'USD'
    constraint ceo_finance_currency_len check (char_length(currency) = 3),
  status text not null default 'CLEARED'
    constraint ceo_finance_status_check check (status in ('PENDING', 'CLEARED', 'VOID', 'REFUNDED')),
  label text not null default ''
    constraint ceo_finance_label_len check (char_length(label) <= 200),
  source_ref text not null default ''
    constraint ceo_finance_source_len check (char_length(source_ref) <= 200),
  occurred_on date not null default (timezone('utc', now()))::date,
  created_at timestamptz not null default now()
);

create index if not exists ceo_finance_owner_occurred_idx
  on public.ceo_finance_entries (owner_id, occurred_on desc);
create index if not exists ceo_finance_company_idx
  on public.ceo_finance_entries (company_id, occurred_on desc);

alter table public.ceo_finance_entries enable row level security;
alter table public.ceo_finance_entries force row level security;

create policy ceo_finance_select on public.ceo_finance_entries
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  );

create policy ceo_finance_insert on public.ceo_finance_entries
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  );

create policy ceo_finance_update on public.ceo_finance_entries
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  );

comment on table public.ceo_opportunities is
  'CEO Opportunity Radar records. External connectors remain optional.';
comment on table public.ceo_finance_entries is
  'Company-scoped finance ledger for Command totals. Unpaid invoices are not cash.';
