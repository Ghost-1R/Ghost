-- Project repository metadata and Ghost conversation storage.
-- Inspected before apply. Does not reset or rewrite the Alpha foundation tables.

alter table public.projects
  add column repository_provider text,
  add column repository_branch text,
  add column repository_commit text;

alter table public.projects
  add constraint projects_repository_provider_length check (
    repository_provider is null or char_length(trim(repository_provider)) between 1 and 40
  ),
  add constraint projects_repository_branch_length check (
    repository_branch is null or char_length(trim(repository_branch)) between 1 and 200
  ),
  add constraint projects_repository_commit_length check (
    repository_commit is null or char_length(trim(repository_commit)) between 1 and 80
  );

comment on column public.projects.repository_provider is
  'Local or remote repository kind. A value here is not proof of a connected GitHub remote.';

comment on column public.projects.repository_commit is
  'Last known commit, only when one was actually observed. Null means no commit is recorded.';

create table public.ghost_conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  title text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint ghost_conversations_title_length check (
    title is null or char_length(trim(title)) between 1 and 160
  )
);

create table public.ghost_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.ghost_conversations (id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint ghost_messages_role check (role in ('user', 'assistant')),
  constraint ghost_messages_content_length check (char_length(trim(content)) between 1 and 12000)
);

create index ghost_conversations_owner_id_idx on public.ghost_conversations (owner_id, updated_at desc);

create index ghost_conversations_project_id_idx on public.ghost_conversations (project_id);

create index ghost_messages_conversation_id_idx on public.ghost_messages (conversation_id, created_at);

create trigger ghost_conversations_set_updated_at
  before update on public.ghost_conversations
  for each row execute function private.set_updated_at();

alter table public.ghost_conversations enable row level security;
alter table public.ghost_messages enable row level security;
alter table public.ghost_conversations force row level security;
alter table public.ghost_messages force row level security;

create policy ghost_conversations_select on public.ghost_conversations
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy ghost_conversations_insert on public.ghost_conversations
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      project_id is null
      or (select private.owns_project(project_id))
    )
  );

create policy ghost_conversations_update on public.ghost_conversations
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (
      project_id is null
      or (select private.owns_project(project_id))
    )
  );

create policy ghost_conversations_delete on public.ghost_conversations
  for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy ghost_messages_select on public.ghost_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.ghost_conversations as conversation
      where conversation.id = conversation_id
        and conversation.owner_id = (select auth.uid())
    )
  );

create policy ghost_messages_insert on public.ghost_messages
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.ghost_conversations as conversation
      where conversation.id = conversation_id
        and conversation.owner_id = (select auth.uid())
    )
  );

create policy ghost_messages_delete on public.ghost_messages
  for delete to authenticated
  using (
    exists (
      select 1
      from public.ghost_conversations as conversation
      where conversation.id = conversation_id
        and conversation.owner_id = (select auth.uid())
    )
  );

revoke all on public.ghost_conversations from public, anon;
revoke all on public.ghost_messages from public, anon;
grant select, insert, update, delete on public.ghost_conversations to authenticated;
grant select, insert, delete on public.ghost_messages to authenticated;

comment on table public.ghost_conversations is
  'Founder-owned Ghost threads. project_id null is a dashboard thread. Rows do not change project memory.';

comment on table public.ghost_messages is
  'Visible conversation turns only. Do not store hidden model reasoning or provider secrets.';
