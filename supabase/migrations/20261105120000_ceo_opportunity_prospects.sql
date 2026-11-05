-- Additive Opportunity Radar prospect fields (source URL + optional public email).
-- Preserves existing ceo_opportunities rows and ownership RLS via owns_company.

alter table public.ceo_opportunities
  add column if not exists source_url text not null default ''
    constraint ceo_opportunities_source_url_len check (char_length(source_url) <= 2000);

alter table public.ceo_opportunities
  add column if not exists contact_email text not null default ''
    constraint ceo_opportunities_contact_email_len check (char_length(contact_email) <= 320);

-- Deduplicate saved prospects by owned company + source URL when a URL is present.
create unique index if not exists ceo_opportunities_company_source_url_uidx
  on public.ceo_opportunities (company_id, source_url)
  where length(trim(source_url)) > 0;

comment on column public.ceo_opportunities.source_url is
  'Public source page for a discovered prospect. Empty for manual opportunities.';
comment on column public.ceo_opportunities.contact_email is
  'Optional public email verified by the founder before outreach drafts.';
