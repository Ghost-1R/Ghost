
BEGIN;
-- Hold Pilot 03 allowance until founder reconciles external OpenAI usage.
INSERT INTO public.project_ai_allowance_reservations (
  id, project_id, owner_id, task_key, estimated_cents, status, idempotency_key, created_at
)
SELECT
  gen_random_uuid(),
  'f5397422-1c9d-4ef5-b639-8eee89981f5e'::uuid,
  'adcc741f-1570-472f-9bf4-ef44028f57fc'::uuid,
  'billing-uncertain-hold-8bdfde20-2f66-4518-9aea-6e632001fe7f',
  100,
  'OPEN',
  'billing-uncertain-hold-8bdfde20-2f66-4518-9aea-6e632001fe7f',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_ai_allowance_reservations
  WHERE owner_id = 'adcc741f-1570-472f-9bf4-ef44028f57fc'::uuid AND task_key = 'billing-uncertain-hold-8bdfde20-2f66-4518-9aea-6e632001fe7f' AND status = 'OPEN'
);

UPDATE public.project_ai_allowances a
SET reserved_cents = 100,
    updated_at = now()
WHERE a.project_id = 'f5397422-1c9d-4ef5-b639-8eee89981f5e'::uuid
  AND a.owner_id = 'adcc741f-1570-472f-9bf4-ef44028f57fc'::uuid
  AND EXISTS (
    SELECT 1 FROM public.project_ai_allowance_reservations r
    WHERE r.owner_id = a.owner_id AND r.task_key = 'billing-uncertain-hold-8bdfde20-2f66-4518-9aea-6e632001fe7f' AND r.status = 'OPEN'
  );

INSERT INTO public.project_ai_usage_events (
  project_id, owner_id, reservation_id, event_type, amount_cents, detail, idempotency_key
)
SELECT
  'f5397422-1c9d-4ef5-b639-8eee89981f5e'::uuid,
  'adcc741f-1570-472f-9bf4-ef44028f57fc'::uuid,
  r.id,
  'ALERT',
  100,
  'BILLING_UNCERTAIN_HOLD after empty LIVE OpenAI response; external spend unconfirmed; do not treat as $0',
  'usage-billing-uncertain-hold-8bdfde20-2f66-4518-9aea-6e632001fe7f'
FROM public.project_ai_allowance_reservations r
WHERE r.owner_id = 'adcc741f-1570-472f-9bf4-ef44028f57fc'::uuid AND r.task_key = 'billing-uncertain-hold-8bdfde20-2f66-4518-9aea-6e632001fe7f' AND r.status = 'OPEN'
  AND NOT EXISTS (
    SELECT 1 FROM public.project_ai_usage_events e
    WHERE e.owner_id = 'adcc741f-1570-472f-9bf4-ef44028f57fc'::uuid AND e.idempotency_key = 'usage-billing-uncertain-hold-8bdfde20-2f66-4518-9aea-6e632001fe7f'
  );

COMMIT;
