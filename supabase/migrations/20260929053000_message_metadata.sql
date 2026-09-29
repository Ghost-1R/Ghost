-- Assistant response provenance. Does not reset data or change existing policies.

alter table public.ghost_messages
  add column metadata jsonb not null default '{}'::jsonb;

alter table public.ghost_messages
  add constraint ghost_messages_metadata_object check (jsonb_typeof(metadata) = 'object');

comment on column public.ghost_messages.metadata is
  'Selected source ids, provider, model, and token counts. Do not store API keys or hidden reasoning.';
