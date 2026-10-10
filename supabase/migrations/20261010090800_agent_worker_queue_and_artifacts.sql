-- Remote-worker queue + review artifacts (Build 09.8) — LOCAL ONLY until founder-gated apply.
-- Execution remains disabled by default. No public preview publishing.
-- Do not apply to hosted Supabase without separate founder authorization.
-- Do not store credentials in queue or artifact records.

do $$ begin
  create type public.agent_worker_queue_status as enum (
    'PENDING',
    'LEASED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'DEAD_LETTER'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.agent_review_artifact_kind as enum (
    'DIFF_SUMMARY',
    'TEST_LOG',
    'CHECKPOINT_SNAPSHOT',
    'ERROR_REPORT',
    'PREVIEW_BUNDLE'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.agent_worker_queue (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.agent_tasks (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  status public.agent_worker_queue_status not null default 'PENDING',
  priority integer not null default 100,
  attempts integer not null default 0
    constraint agent_worker_queue_attempts_nonneg check (attempts >= 0),
  max_attempts integer not null default 3
    constraint agent_worker_queue_max_attempts_check check (max_attempts >= 1 and max_attempts <= 20),
  available_at timestamptz not null default pg_catalog.now(),
  leased_by text,
  lease_token text,
  lease_expires_at timestamptz,
  last_error jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint agent_worker_queue_lease_consistency check (
    (leased_by is null and lease_token is null and lease_expires_at is null)
    or (leased_by is not null and lease_token is not null and lease_expires_at is not null)
  )
);

comment on table public.agent_worker_queue is
  'Remote-worker queue foundation. Workers disabled by default. Never stores secrets.';

create index if not exists agent_worker_queue_available_idx
  on public.agent_worker_queue (status, available_at, priority)
  where status in ('PENDING', 'FAILED');

create table if not exists public.agent_review_artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.agent_tasks (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.agent_review_artifact_kind not null,
  title text not null
    constraint agent_review_artifacts_title_length check (
      char_length(trim(title)) between 1 and 200
    ),
  content_ref text not null
    constraint agent_review_artifacts_content_length check (
      char_length(trim(content_ref)) between 1 and 4000
    ),
  content_sha256 text not null
    constraint agent_review_artifacts_sha_length check (char_length(content_sha256) = 64),
  visibility text not null default 'FOUNDER_PRIVATE'
    constraint agent_review_artifacts_visibility_check check (visibility = 'FOUNDER_PRIVATE'),
  publicly_published boolean not null default false
    constraint agent_review_artifacts_no_public check (publicly_published = false),
  created_at timestamptz not null default pg_catalog.now()
);

comment on table public.agent_review_artifacts is
  'Founder-private review artifacts. Public publishing is forbidden.';

create index if not exists agent_review_artifacts_task_idx
  on public.agent_review_artifacts (task_id, created_at desc);

create table if not exists public.agent_private_previews (
  id uuid primary key default extensions.gen_random_uuid(),
  artifact_id uuid not null references public.agent_review_artifacts (id) on delete cascade,
  task_id uuid not null references public.agent_tasks (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  access_token_hash text not null
    constraint agent_private_previews_token_length check (char_length(access_token_hash) = 64),
  expires_at timestamptz not null,
  publicly_published boolean not null default false
    constraint agent_private_previews_no_public check (publicly_published = false),
  created_at timestamptz not null default pg_catalog.now()
);

comment on table public.agent_private_previews is
  'Private founder preview tokens. Never public. Token stored as hash only.';

drop trigger if exists agent_worker_queue_set_updated_at on public.agent_worker_queue;
create trigger agent_worker_queue_set_updated_at
  before update on public.agent_worker_queue
  for each row execute function private.set_updated_at();

alter table public.agent_worker_queue enable row level security;
alter table public.agent_worker_queue force row level security;
alter table public.agent_review_artifacts enable row level security;
alter table public.agent_review_artifacts force row level security;
alter table public.agent_private_previews enable row level security;
alter table public.agent_private_previews force row level security;

drop policy if exists agent_worker_queue_select on public.agent_worker_queue;
create policy agent_worker_queue_select on public.agent_worker_queue
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

drop policy if exists agent_worker_queue_insert on public.agent_worker_queue;
create policy agent_worker_queue_insert on public.agent_worker_queue
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

drop policy if exists agent_worker_queue_update on public.agent_worker_queue;
create policy agent_worker_queue_update on public.agent_worker_queue
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

drop policy if exists agent_review_artifacts_select on public.agent_review_artifacts;
create policy agent_review_artifacts_select on public.agent_review_artifacts
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists agent_review_artifacts_insert on public.agent_review_artifacts;
create policy agent_review_artifacts_insert on public.agent_review_artifacts
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
    and publicly_published = false
    and visibility = 'FOUNDER_PRIVATE'
  );

drop policy if exists agent_private_previews_select on public.agent_private_previews;
create policy agent_private_previews_select on public.agent_private_previews
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists agent_private_previews_insert on public.agent_private_previews;
create policy agent_private_previews_insert on public.agent_private_previews
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and publicly_published = false
  );

revoke all on table public.agent_worker_queue from anon;
revoke all on table public.agent_review_artifacts from anon;
revoke all on table public.agent_private_previews from anon;

revoke all on table public.agent_worker_queue from authenticated;
revoke all on table public.agent_review_artifacts from authenticated;
revoke all on table public.agent_private_previews from authenticated;

grant select, insert, update on public.agent_worker_queue to authenticated;
grant select, insert on public.agent_review_artifacts to authenticated;
grant select, insert on public.agent_private_previews to authenticated;
