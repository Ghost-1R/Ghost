-- Build 09.9D disposable Postgres bootstrap.
-- Minimal Supabase-compatible primitives so Ghost RLS migrations can load.
-- Does NOT weaken policy definitions. Not a hosted Supabase substitute for GoTrue/PostgREST.

create extension if not exists pgcrypto;

create schema if not exists extensions;
create or replace function extensions.gen_random_uuid()
returns uuid language sql volatile as $$ select gen_random_uuid() $$;

create schema if not exists auth;
create schema if not exists private;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default ''
);

create table if not exists public.companies (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null unique
);

create table if not exists public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  status text not null default 'IDEA'
);

create table if not exists public.project_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default 'decision',
  question text not null default 'q',
  context text not null default '',
  status text not null default 'OPEN',
  options jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function private.owns_project(target_project_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    join public.companies as company on company.id = project.company_id
    where project.id = target_project_id
      and company.owner_id = (select auth.uid())
  );
$$;

grant execute on function private.owns_project(uuid) to authenticated;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on public.companies to authenticated;
grant select on public.projects to authenticated;
grant select, insert, update on public.profiles to authenticated;
