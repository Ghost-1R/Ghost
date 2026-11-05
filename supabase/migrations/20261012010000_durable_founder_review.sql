-- Durable founder deliverable review (Pilot 02 closure) — LOCAL / DISPOSABLE ONLY.
-- Authenticated owner review of completed remote_development_tasks.
-- Do not apply to hosted Supabase without separate founder authorization.
-- Does not grant deployment. Does not reopen consumed ONE_TIME authorizations.

do $$ begin
  alter type public.remote_dev_task_status add value if not exists 'CHANGES_REQUESTED';
exception
  when duplicate_object then null;
end $$;

create table if not exists public.remote_development_founder_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  remote_development_task_id uuid not null references public.remote_development_tasks (id) on delete cascade,
  agent_task_id uuid references public.agent_tasks (id) on delete set null,
  authorization_id uuid not null references public.founder_action_authorizations (id) on delete restrict,
  decision text not null
    constraint remote_dev_founder_reviews_decision_check check (
      decision in ('ACCEPT', 'REJECT', 'REQUEST_CHANGES')
    ),
  note text not null default ''
    constraint remote_dev_founder_reviews_note_len check (char_length(note) <= 4000),
  resulting_status text not null
    constraint remote_dev_founder_reviews_status_check check (
      resulting_status in ('VERIFIED', 'FAILED', 'CHANGES_REQUESTED')
    ),
  scope_fingerprint text not null
    constraint remote_dev_founder_reviews_fp_len check (char_length(scope_fingerprint) = 64),
  idempotency_key text not null
    constraint remote_dev_founder_reviews_idem_len check (
      char_length(trim(idempotency_key)) between 8 and 200
    ),
  created_at timestamptz not null default pg_catalog.now(),
  constraint remote_dev_founder_reviews_owner_idem unique (owner_id, idempotency_key)
);

create index if not exists remote_dev_founder_reviews_task_idx
  on public.remote_development_founder_reviews (remote_development_task_id, created_at desc);

alter table public.remote_development_founder_reviews enable row level security;
alter table public.remote_development_founder_reviews force row level security;

drop policy if exists remote_dev_founder_reviews_owner_select on public.remote_development_founder_reviews;
create policy remote_dev_founder_reviews_owner_select
  on public.remote_development_founder_reviews
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists remote_dev_founder_reviews_owner_insert on public.remote_development_founder_reviews;
create policy remote_dev_founder_reviews_owner_insert
  on public.remote_development_founder_reviews
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- Reviews are immutable — no update/delete for authenticated.
revoke all on public.remote_development_founder_reviews from anon, authenticated;
grant select, insert on public.remote_development_founder_reviews to authenticated;
