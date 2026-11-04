insert into public.project_decisions (
  project_id, title, question, context, status, options, evidence, created_by
) values (
  'f5397422-1c9d-4ef5-b639-8eee89981f5e',
  'Accept MOCK vehicle result?',
  'Is the MOCK result sufficient to close this pilot step?',
  'Local MOCK_GENERATION only.',
  'OPEN',
  '[{"id":"accept","label":"Accept"},{"id":"revise","label":"Request changes"}]'::jsonb,
  '[{"type":"task","id":"a1d3acfb-a768-4cb6-b746-b28ce5a690dd","title":"MOCK vehicle task"}]'::jsonb,
  'adcc741f-1570-472f-9bf4-ef44028f57fc'
) returning id;
