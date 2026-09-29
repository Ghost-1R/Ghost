-- Presentation evidence and approvals.
-- NOT APPLIED. Remote application is HIGH and requires explicit founder approval.
-- Target project: Ghost-1R wzwrrleqfylhuxfbukfu.
-- Clients can read rows for projects they own. They cannot insert, update, or delete.
-- Inserts belong to the server-side writer using service_role.
-- service_role cannot update or delete these rows. Triggers reject mutation for every role.
--
-- Privileged recovery, if a row must ever be repaired:
-- This is not an application feature. The app writer cannot do it.
-- A platform administrator in the Supabase SQL editor, as the table owner,
-- disables the named trigger, repairs the specific row, then enables the trigger
-- again in the same session:
--   alter table public.inspection_evidence disable trigger inspection_evidence_append_only;
--   alter table public.inspection_evidence disable trigger inspection_evidence_no_truncate;
--   -- repair that table only, then
--   alter table public.inspection_evidence enable trigger inspection_evidence_append_only;
--   alter table public.inspection_evidence enable trigger inspection_evidence_no_truncate;
-- Repeat with the matching trigger names for presentation_approvals,
-- presentation_overrides, and presentation_reviews.
-- Do not drop these tables to clear history. Do not reset the database.

create or replace function private.reject_presentation_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'presentation history is append-only'
    using errcode = '42501';
end;
$$;

revoke all on function private.reject_presentation_mutation() from public, anon, authenticated, service_role;

create table public.inspection_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  run_id uuid not null,
  check_type text not null,
  commit_sha text not null,
  tree_hash text not null,
  command text not null,
  exit_code integer,
  duration_ms integer not null,
  output_hash text not null,
  log_excerpt text not null,
  runner text not null default 'inspector',
  environment text not null,
  status text not null,
  created_at timestamptz not null default now(),
  constraint inspection_evidence_status check (status in ('passed', 'failed', 'blocked', 'skipped')),
  constraint inspection_evidence_runner check (runner = 'inspector')
);

create table public.presentation_approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  operation text not null,
  target text not null,
  commit_sha text not null,
  risk_level text not null,
  evidence_ids_shown jsonb not null default '[]'::jsonb,
  approved_by uuid not null references public.profiles (id) on delete restrict,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  fingerprint text not null
);

create table public.presentation_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  reason text not null,
  founder_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  target text not null,
  commit_sha text not null,
  affected_checks jsonb not null default '[]'::jsonb,
  constraint presentation_overrides_reason check (char_length(reason) >= 8)
);

create table public.presentation_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  commit_sha text not null,
  tree_hash text not null,
  environment text not null,
  created_at timestamptz not null default now(),
  evidence_ids jsonb not null default '[]'::jsonb,
  result text not null,
  report jsonb not null,
  constraint presentation_reviews_result check (result in ('READY', 'READY_WITH_GAPS', 'NOT_READY'))
);

create trigger inspection_evidence_append_only
  before update or delete on public.inspection_evidence
  for each row execute function private.reject_presentation_mutation();

create trigger inspection_evidence_no_truncate
  before truncate on public.inspection_evidence
  for each statement execute function private.reject_presentation_mutation();

create trigger presentation_approvals_append_only
  before update or delete on public.presentation_approvals
  for each row execute function private.reject_presentation_mutation();

create trigger presentation_approvals_no_truncate
  before truncate on public.presentation_approvals
  for each statement execute function private.reject_presentation_mutation();

create trigger presentation_overrides_append_only
  before update or delete on public.presentation_overrides
  for each row execute function private.reject_presentation_mutation();

create trigger presentation_overrides_no_truncate
  before truncate on public.presentation_overrides
  for each statement execute function private.reject_presentation_mutation();

create trigger presentation_reviews_append_only
  before update or delete on public.presentation_reviews
  for each row execute function private.reject_presentation_mutation();

create trigger presentation_reviews_no_truncate
  before truncate on public.presentation_reviews
  for each statement execute function private.reject_presentation_mutation();

alter table public.inspection_evidence enable row level security;
alter table public.presentation_approvals enable row level security;
alter table public.presentation_overrides enable row level security;
alter table public.presentation_reviews enable row level security;

alter table public.inspection_evidence force row level security;
alter table public.presentation_approvals force row level security;
alter table public.presentation_overrides force row level security;
alter table public.presentation_reviews force row level security;

create policy inspection_evidence_select on public.inspection_evidence
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy presentation_approvals_select on public.presentation_approvals
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy presentation_overrides_select on public.presentation_overrides
  for select to authenticated
  using ((select private.owns_project(project_id)));

create policy presentation_reviews_select on public.presentation_reviews
  for select to authenticated
  using ((select private.owns_project(project_id)));

revoke all on public.inspection_evidence from public, anon, authenticated, service_role;
revoke all on public.presentation_approvals from public, anon, authenticated, service_role;
revoke all on public.presentation_overrides from public, anon, authenticated, service_role;
revoke all on public.presentation_reviews from public, anon, authenticated, service_role;

grant select on public.inspection_evidence to authenticated;
grant select on public.presentation_approvals to authenticated;
grant select on public.presentation_overrides to authenticated;
grant select on public.presentation_reviews to authenticated;

grant select, insert on public.inspection_evidence to service_role;
grant select, insert on public.presentation_approvals to service_role;
grant select, insert on public.presentation_overrides to service_role;
grant select, insert on public.presentation_reviews to service_role;

comment on table public.inspection_evidence is
  'Append-only inspector evidence. UPDATE, DELETE, and TRUNCATE are rejected. Project delete is restricted while a row exists.';

comment on table public.presentation_approvals is
  'Append-only approval history. UPDATE, DELETE, and TRUNCATE are rejected.';

comment on table public.presentation_overrides is
  'Append-only override history. An override does not change evidence. UPDATE, DELETE, and TRUNCATE are rejected.';

comment on table public.presentation_reviews is
  'Append-only presentation reviews. The result is computed by the server. UPDATE, DELETE, and TRUNCATE are rejected.';
