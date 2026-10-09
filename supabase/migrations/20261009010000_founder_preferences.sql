-- Founder account preferences for Settings & Control Center (local-first).
-- Do not apply to production without separate founder approval.
-- Compatible with alpha foundation profiles/auth.users ownership chain.
-- Idempotent enough for re-apply on local disposable DBs (types/table/policies).

do $$ begin
  create type public.response_style as enum (
    'DIRECT',
    'WARM',
    'FORMAL'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.response_detail as enum (
    'BRIEF',
    'BALANCED',
    'DETAILED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.appearance_preference as enum (
    'DARK',
    'LIGHT',
    'SYSTEM'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.founder_preferences (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  response_style public.response_style not null default 'DIRECT',
  response_detail public.response_detail not null default 'BALANCED',
  sound_enabled boolean not null default true,
  sound_volume numeric(4, 3) not null default 0.350
    constraint founder_preferences_sound_volume_range check (sound_volume >= 0 and sound_volume <= 1),
  reduce_motion boolean not null default false,
  appearance public.appearance_preference not null default 'DARK',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

comment on table public.founder_preferences is
  'Per-account Ghost preferences. Enums only — never free-text system instructions. Sound/appearance/motion SoT for account; browser voice engine (ghost.voice) stays device-local.';

drop trigger if exists founder_preferences_set_updated_at on public.founder_preferences;
create trigger founder_preferences_set_updated_at
  before update on public.founder_preferences
  for each row execute function private.set_updated_at();

alter table public.founder_preferences enable row level security;
alter table public.founder_preferences force row level security;

drop policy if exists founder_preferences_select on public.founder_preferences;
create policy founder_preferences_select on public.founder_preferences
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists founder_preferences_insert on public.founder_preferences;
create policy founder_preferences_insert on public.founder_preferences
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists founder_preferences_update on public.founder_preferences;
create policy founder_preferences_update on public.founder_preferences
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- No delete policy: preferences row is owned for the life of the account.
-- Existing users: no backfill required; loadFounderPreferences returns defaults until first save.

grant select, insert, update on public.founder_preferences to authenticated;
