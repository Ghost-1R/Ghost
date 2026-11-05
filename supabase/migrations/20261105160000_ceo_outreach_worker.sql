-- Outreach email worker (Badger United) — durable approval-gated send queue.
-- Additive. Live sending stays off until ceo_outreach_config.live_enabled = true
-- AND GHOST_OUTREACH_ENABLED=1. Will/Bubba lead discovery is unchanged.

-- Expand opportunity pipeline stages for queue/send lifecycle.
alter table public.ceo_opportunities
  drop constraint if exists ceo_opportunities_outreach_stage_check;

alter table public.ceo_opportunities
  add constraint ceo_opportunities_outreach_stage_check
  check (
    outreach_stage in (
      'new',
      'waiting',
      'queued',
      'sending',
      'sent',
      'delivered',
      'bounced',
      'needs_attention',
      'replied',
      'won',
      'closed'
    )
  );

alter table public.ceo_opportunities
  add column if not exists outreach_subject text not null default ''
    constraint ceo_opportunities_outreach_subject_len check (char_length(outreach_subject) <= 300);

alter table public.ceo_opportunities
  add column if not exists outreach_message_id uuid;

create index if not exists ceo_opportunities_follow_up_sent_idx
  on public.ceo_opportunities (company_id, follow_up_on)
  where follow_up_on is not null and outreach_stage in ('sent', 'delivered');

create table if not exists public.ceo_outreach_config (
  id uuid primary key default extensions.gen_random_uuid(),
  company_slug text not null default 'badger-united'
    constraint ceo_outreach_config_slug_len check (char_length(trim(company_slug)) between 1 and 80),
  company_id uuid references public.companies (id) on delete set null,
  owner_id uuid references auth.users (id) on delete set null,
  live_enabled boolean not null default false,
  paused boolean not null default false,
  daily_send_cap integer not null default 5
    constraint ceo_outreach_config_cap check (daily_send_cap between 1 and 200),
  sends_today integer not null default 0
    constraint ceo_outreach_config_used check (sends_today >= 0),
  send_quota_day text not null default ''
    constraint ceo_outreach_config_quota_day_len check (char_length(send_quota_day) <= 16),
  window_start_hour integer not null default 9
    constraint ceo_outreach_config_window_start check (window_start_hour between 0 and 23),
  window_end_hour integer not null default 17
    constraint ceo_outreach_config_window_end check (window_end_hour between 1 and 24),
  timezone text not null default 'America/New_York'
    constraint ceo_outreach_config_tz_len check (char_length(trim(timezone)) between 1 and 80),
  sender_email text not null default ''
    constraint ceo_outreach_config_sender_len check (char_length(sender_email) <= 320),
  sender_display_name text not null default 'Badger United'
    constraint ceo_outreach_config_sender_name_len check (char_length(sender_display_name) <= 120),
  reply_to_email text not null default ''
    constraint ceo_outreach_config_reply_len check (char_length(reply_to_email) <= 320),
  postal_address text not null default ''
    constraint ceo_outreach_config_postal_len check (char_length(postal_address) <= 500),
  commercial_identity text not null default 'Badger United'
    constraint ceo_outreach_config_identity_len check (char_length(commercial_identity) <= 120),
  provider text not null default 'fake'
    constraint ceo_outreach_config_provider_check check (provider in ('fake', 'ses')),
  last_blocker text not null default ''
    constraint ceo_outreach_config_blocker_len check (char_length(last_blocker) <= 2000),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

insert into public.ceo_outreach_config (company_slug)
select 'badger-united'
where not exists (select 1 from public.ceo_outreach_config);

update public.ceo_outreach_config c
set company_id = co.id,
    owner_id = coalesce(c.owner_id, co.owner_id),
    updated_at = now()
from public.companies co
where c.company_id is null
  and co.slug = c.company_slug;

create table if not exists public.ceo_outreach_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  opportunity_id uuid not null references public.ceo_opportunities (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'awaiting_approval'
    constraint ceo_outreach_messages_status_check
      check (
        status in (
          'awaiting_approval',
          'queued',
          'sending',
          'sent',
          'delivered',
          'bounced',
          'failed',
          'cancelled',
          'suppressed'
        )
      ),
  sender_email text not null
    constraint ceo_outreach_messages_sender_len check (char_length(trim(sender_email)) between 3 and 320),
  reply_to_email text not null default ''
    constraint ceo_outreach_messages_reply_len check (char_length(reply_to_email) <= 320),
  recipient_email text not null
    constraint ceo_outreach_messages_recipient_len check (char_length(trim(recipient_email)) between 3 and 320),
  subject text not null
    constraint ceo_outreach_messages_subject_len check (char_length(trim(subject)) between 1 and 300),
  body text not null
    constraint ceo_outreach_messages_body_len check (char_length(trim(body)) between 1 and 8000),
  approval_hash text not null
    constraint ceo_outreach_messages_hash_len check (char_length(approval_hash) between 16 and 128),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approved_sender text not null default '',
  approved_recipient text not null default '',
  approved_subject text not null default '',
  approved_body text not null default '',
  idempotency_key text not null
    constraint ceo_outreach_messages_idem_len check (char_length(trim(idempotency_key)) between 8 and 220),
  lease_token text,
  lease_expires_at timestamptz,
  provider text not null default 'fake'
    constraint ceo_outreach_messages_provider_check check (provider in ('fake', 'ses')),
  provider_message_id text not null default ''
    constraint ceo_outreach_messages_provider_id_len check (char_length(provider_message_id) <= 320),
  provider_raw_status text not null default ''
    constraint ceo_outreach_messages_provider_status_len check (char_length(provider_raw_status) <= 120),
  needs_reconcile boolean not null default false,
  attempt_count integer not null default 0
    constraint ceo_outreach_messages_attempts_nonneg check (attempt_count >= 0),
  last_error text not null default ''
    constraint ceo_outreach_messages_error_len check (char_length(last_error) <= 2000),
  is_follow_up boolean not null default false,
  opt_out_token text not null
    constraint ceo_outreach_messages_opt_out_len check (char_length(trim(opt_out_token)) between 16 and 80),
  queued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ceo_outreach_messages_idempotency unique (idempotency_key),
  constraint ceo_outreach_messages_opt_out unique (opt_out_token)
);

create index if not exists ceo_outreach_messages_queue_idx
  on public.ceo_outreach_messages (company_id, status, queued_at)
  where status in ('queued', 'sending');

create index if not exists ceo_outreach_messages_opportunity_idx
  on public.ceo_outreach_messages (opportunity_id, created_at desc);

create table if not exists public.ceo_outreach_suppressions (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null
    constraint ceo_outreach_suppressions_email_len check (char_length(trim(email)) between 3 and 320),
  reason text not null
    constraint ceo_outreach_suppressions_reason_check check (reason in ('opt_out', 'bounce', 'manual')),
  source_message_id uuid references public.ceo_outreach_messages (id) on delete set null,
  note text not null default ''
    constraint ceo_outreach_suppressions_note_len check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint ceo_outreach_suppressions_unique unique (company_id, email)
);

create index if not exists ceo_outreach_suppressions_email_idx
  on public.ceo_outreach_suppressions (company_id, email);

alter table public.ceo_outreach_config enable row level security;
alter table public.ceo_outreach_config force row level security;
alter table public.ceo_outreach_messages enable row level security;
alter table public.ceo_outreach_messages force row level security;
alter table public.ceo_outreach_suppressions enable row level security;
alter table public.ceo_outreach_suppressions force row level security;

create policy ceo_outreach_config_select on public.ceo_outreach_config
  for select to authenticated
  using (
    company_id is null
    or (select private.owns_company(company_id))
  );

create policy ceo_outreach_config_update on public.ceo_outreach_config
  for update to authenticated
  using (
    company_id is not null
    and (select private.owns_company(company_id))
  )
  with check (
    company_id is not null
    and (select private.owns_company(company_id))
  );

create policy ceo_outreach_messages_select on public.ceo_outreach_messages
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  );

create policy ceo_outreach_messages_insert on public.ceo_outreach_messages
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  );

create policy ceo_outreach_messages_update on public.ceo_outreach_messages
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_company(company_id))
  );

create policy ceo_outreach_suppressions_select on public.ceo_outreach_suppressions
  for select to authenticated
  using ((select private.owns_company(company_id)));

create policy ceo_outreach_suppressions_insert on public.ceo_outreach_suppressions
  for insert to authenticated
  with check ((select private.owns_company(company_id)));

comment on table public.ceo_outreach_config is
  'Outreach email worker config for Badger United. Live send off by default.';
comment on table public.ceo_outreach_messages is
  'Approval-gated durable send queue. Sent only after provider acceptance.';
comment on table public.ceo_outreach_suppressions is
  'Opt-out and bounce suppression — blocks later Outreach sends.';
comment on column public.ceo_opportunities.outreach_stage is
  'Outreach pipeline stage including queue/send lifecycle. Separate from research-task status.';
