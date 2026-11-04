-- Harden privileges for Founder Action Authorizations (Build 09.3) — LOCAL ONLY.
-- Supabase default grants may expose DELETE/TRUNCATE to anon/authenticated.
-- RLS already denies DELETE (no policy), but privileges are revoked explicitly.
-- Do not apply to hosted Supabase without separate founder authorization.

revoke all on table public.founder_action_authorizations from anon;
revoke all on table public.founder_authorization_events from anon;

revoke all on table public.founder_action_authorizations from authenticated;
revoke all on table public.founder_authorization_events from authenticated;

grant select, insert, update on public.founder_action_authorizations to authenticated;
grant select, insert on public.founder_authorization_events to authenticated;

-- service_role retains full access for local maintenance only; app paths use authenticated JWT.
