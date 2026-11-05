-- Underworld shifts: durable jobs over agent_tasks + founder approvals.
-- Default schedule is enforced in the worker (Mon–Fri 09:00–17:00 America/New_York).
-- First workflow is read-only project review. LIVE gates unchanged. Additive only.
-- Do not apply to hosted Supabase without separate founder authorization.

do $$ begin
  create type public.underworld_shift_job_status as enum (
    'QUEUED',
    'WORKING',
    'BLOCKED',
    'AWAITING_APPROVAL',
    'COMPLETE',
    'FAILED',
    'CANCELLED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.underworld_shift_workflow as enum (
    'BUILD_PLAN_REVIEW'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.underworld_shift_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  workflow public.underworld_shift_workflow not null default 'BUILD_PLAN_REVIEW',
  status public.underworld_shift_job_status not null default 'AWAITING_APPROVAL',
  idempotency_key text not null
    constraint underworld_shift_jobs_idempotency_length check (
      char_length(trim(idempotency_key)) between 8 and 200
    ),
  authorization_id uuid references public.founder_action_authorizations (id) on delete restrict,
  agent_task_id uuid references public.agent_tasks (id) on delete set null,
  build_plan_id uuid,
  checkpoint_step integer not null default 0
    constraint underworld_shift_jobs_checkpoint_nonneg check (checkpoint_step >= 0),
  checkpoint_label text not null default ''
    constraint underworld_shift_jobs_checkpoint_label_length check (char_length(checkpoint_label) <= 200),
  result_fingerprint text
    constraint underworld_shift_jobs_result_fp_length check (
      result_fingerprint is null or char_length(result_fingerprint) = 64
    ),
  review_summary text not null default ''
    constraint underworld_shift_jobs_summary_length check (char_length(review_summary) <= 8000),
  evidence jsonb not null default '[]'::jsonb,
  block_reason text not null default ''
    constraint underworld_shift_jobs_block_reason_length check (char_length(block_reason) <= 2000),
  lease_holder_id text,
  lease_token text,
  lease_expires_at timestamptz,
  timezone text not null default 'America/New_York'
    constraint underworld_shift_jobs_timezone_length check (
      char_length(trim(timezone)) between 1 and 80
    ),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint underworld_shift_jobs_owner_idempotency unique (owner_id, idempotency_key),
  constraint underworld_shift_jobs_lease_consistency check (
    (lease_holder_id is null and lease_token is null and lease_expires_at is null)
    or (lease_holder_id is not null and lease_token is not null and lease_expires_at is not null)
  )
);

comment on table public.underworld_shift_jobs is
  'Underworld shift jobs. City scene controls are separate. Never stores secrets.';

create unique index if not exists underworld_shift_jobs_result_unique
  on public.underworld_shift_jobs (owner_id, result_fingerprint)
  where result_fingerprint is not null and status = 'COMPLETE';

create index if not exists underworld_shift_jobs_claim_idx
  on public.underworld_shift_jobs (status, created_at)
  where status in ('QUEUED', 'WORKING');

create index if not exists underworld_shift_jobs_project_idx
  on public.underworld_shift_jobs (project_id, created_at desc);

create trigger underworld_shift_jobs_set_updated_at
  before update on public.underworld_shift_jobs
  for each row execute function private.set_updated_at();

alter table public.underworld_shift_jobs enable row level security;
alter table public.underworld_shift_jobs force row level security;

create policy underworld_shift_jobs_select on public.underworld_shift_jobs
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

create policy underworld_shift_jobs_insert on public.underworld_shift_jobs
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

create policy underworld_shift_jobs_update on public.underworld_shift_jobs
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (select private.owns_project(project_id))
  );

-- Atomic claim for local workers (service role) and founder clients.
create or replace function public.claim_underworld_shift_job(
  p_job_id uuid,
  p_lease_holder text,
  p_lease_token text,
  p_lease_seconds integer default 900
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_lease_holder is null or char_length(trim(p_lease_holder)) < 1 then
    raise exception 'lease holder required';
  end if;
  if p_lease_token is null or char_length(trim(p_lease_token)) < 8 then
    raise exception 'lease token required';
  end if;

  update public.underworld_shift_jobs as job
  set
    status = 'WORKING',
    lease_holder_id = p_lease_holder,
    lease_token = p_lease_token,
    lease_expires_at = pg_catalog.now() + make_interval(secs => greatest(p_lease_seconds, 60)),
    started_at = coalesce(job.started_at, pg_catalog.now()),
    updated_at = pg_catalog.now()
  where job.id = p_job_id
    and job.status in ('QUEUED', 'WORKING')
    and (
      job.lease_expires_at is null
      or job.lease_expires_at < pg_catalog.now()
      or (job.lease_holder_id = p_lease_holder and job.lease_token = p_lease_token)
    )
  returning job.id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_underworld_shift_job(uuid, text, text, integer) from public;
grant execute on function public.claim_underworld_shift_job(uuid, text, text, integer) to authenticated, service_role;

-- Safe boundary: release lease and return unfinished work to QUEUED for next shift.
create or replace function public.checkpoint_underworld_shift_job(
  p_job_id uuid,
  p_lease_holder text,
  p_lease_token text,
  p_checkpoint_step integer,
  p_checkpoint_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.underworld_shift_jobs as job
  set
    status = 'QUEUED',
    checkpoint_step = greatest(p_checkpoint_step, job.checkpoint_step),
    checkpoint_label = coalesce(nullif(trim(p_checkpoint_label), ''), job.checkpoint_label),
    lease_holder_id = null,
    lease_token = null,
    lease_expires_at = null,
    updated_at = pg_catalog.now()
  where job.id = p_job_id
    and job.status = 'WORKING'
    and job.lease_holder_id = p_lease_holder
    and job.lease_token = p_lease_token
  returning job.id into v_id;

  return v_id;
end;
$$;

revoke all on function public.checkpoint_underworld_shift_job(uuid, text, text, integer, text) from public;
grant execute on function public.checkpoint_underworld_shift_job(uuid, text, text, integer, text) to authenticated, service_role;
