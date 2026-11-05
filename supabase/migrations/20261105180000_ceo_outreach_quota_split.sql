-- Separate fake vs SES daily send counters. Fake local tests must not consume SES quota.
-- Preserve history: backfill fake_sends_today from recorded fake sends for the current ET day.

alter table public.ceo_outreach_config
  add column if not exists fake_sends_today integer not null default 0
    constraint ceo_outreach_config_fake_used check (fake_sends_today >= 0);

alter table public.ceo_outreach_config
  add column if not exists ses_sandbox_recipient text not null default ''
    constraint ceo_outreach_config_sandbox_len check (char_length(ses_sandbox_recipient) <= 320);

comment on column public.ceo_outreach_config.sends_today is
  'SES/live sends counted toward daily_send_cap. Fake provider sends do not increment this.';
comment on column public.ceo_outreach_config.fake_sends_today is
  'Local fake-provider sends for the send_quota_day. Separate from SES quota.';
comment on column public.ceo_outreach_config.ses_sandbox_recipient is
  'Only allowed SES recipient while live_enabled is false (verified founder sandbox inbox).';

-- Move any same-day fake sends out of the SES counter into the fake counter (preserve totals).
with fake_today as (
  select
    c.id as config_id,
    count(m.*)::int as fake_n
  from public.ceo_outreach_config c
  left join public.ceo_outreach_messages m
    on m.company_id = c.company_id
   and m.provider = 'fake'
   and m.status in ('sent', 'delivered')
   and m.sent_at is not null
   and to_char((m.sent_at at time zone 'America/New_York'), 'YYYY-MM-DD')
       = case
           when c.send_quota_day ~ '^\d{4}-\d{2}-\d{2}$' then c.send_quota_day
           else to_char((now() at time zone 'America/New_York'), 'YYYY-MM-DD')
         end
  group by c.id
)
update public.ceo_outreach_config c
set
  fake_sends_today = greatest(c.fake_sends_today, coalesce(f.fake_n, 0)),
  -- SES quota should not include fake history that previously shared sends_today.
  sends_today = greatest(
    0,
    c.sends_today - greatest(0, coalesce(f.fake_n, 0) - c.fake_sends_today)
  ),
  updated_at = now()
from fake_today f
where c.id = f.config_id;
