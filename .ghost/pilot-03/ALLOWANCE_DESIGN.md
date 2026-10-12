# Ghost Allowance V1 — Design

## What it is

Internal **spending authorization** per project for AI provider usage.

It is **not**:
- A bank deposit
- Ghost-held customer money
- An automatic hard cap on the external provider’s billing account

External API billing can still charge if credentials are misused outside Ghost. Ghost Allowance only controls Ghost’s own dispatch path.

## Money representation

All amounts stored as **integer USD cents** (`bigint` / `number` integers).

Example (illustrative only):

| Field | Cents | Display |
| --- | --- | --- |
| Allowance | 2000 | $20.00 |
| Charged | 300 | $3.00 |
| Reserved | 200 | $2.00 |
| Available | 1500 | $15.00 |

`available = allowance_cents - charged_cents - reserved_cents`

## Tables

1. `project_ai_allowances` — one row per project (owner-scoped)
2. `project_ai_allowance_reservations` — in-flight holds
3. `project_ai_usage_events` — idempotent charge / release / adjust audit

## Atomic operations

- `set_allowance` — founder sets ceiling (cents ≥ 0)
- `reserve` — CAS: require `available >= estimate`; increment `reserved_cents`; insert reservation `OPEN`
- `reconcile` — apply actual charge ≤ reserved (or policy); decrement reserved; increment charged; idempotent by `idempotency_key`
- `release` — unused reservation → reserved decreases; no charge
- Fail closed on insufficient available, wrong owner/project, duplicate open reserve for same task key when configured

## Isolation

- RLS: owner can read/write own project allowances only
- Service role used only in disposable/local workers, never to bypass founder approval for live spend
- FORCE RLS on all allowance tables

## Alerts (v1)

Computed thresholds in application code (not email):

- `WARNING` when available &lt; 20% of allowance
- `HARD_STOP` when available &lt; estimated next task cost

## Local-only migration

`supabase/migrations/20261011210000_project_ai_allowance_v1.sql`  
Marked local/disposable. **Do not apply to hosted Supabase** without separate founder authorization.
