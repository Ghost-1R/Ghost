# Live trial readiness (Pilot 03)

**Status:** Prepared — **NOT AUTHORIZED**. Real provider calls: **0**. Spend: **$0**.

## What is ready

- [x] Pilot 02 evidence independently verified (awaiting founder acceptance of that deliverable)
- [x] Codegen foundation (`src/lib/codegen`) with MOCK_GENERATION path
- [x] Ghost Allowance V1 (integer cents, reserve/reconcile/release, fail closed)
- [x] Local-only SQL migration for allowances (disposable apply only)
- [x] Provider comparison with dated sources
- [x] Prepared disabled adapters: OpenAI, Gemini, OpenRouter
- [x] Model allowlist stub for future live trial
- [x] Exact task definition + allowed files
- [x] End-to-end mock pipeline: auth → reserve → generate → materialize → reconcile → founder review

## What is NOT ready / not done

- [ ] Founder acceptance of Pilot 02 deliverable (separate decision)
- [ ] Founder authorization for live coding spend ≤ $1
- [ ] Server-side credential provisioning in Render (names only until then)
- [ ] HTTP implementation of live coding adapters
- [ ] Hosted Supabase migration of allowance tables
- [ ] Production worker activation

## Exact founder authorization required for first live trial

1. Authorize **OpenAI** `gpt-5-mini` for **one** PUBLIC coding task matching `TASK_DEFINITION.md`
2. Set project Ghost Allowance ≥ **100 cents** ($1.00)
3. Explicitly allow `GHOST_CODEGEN_LIVE_ENABLED=1` only in a disposable/local or founder-approved env
4. Confirm chat-model keys must **not** be reused unless scoped for coding
5. Confirm no deployment permission is granted

## First live trial steps (after authorization)

1. Apply allowance migration to disposable DB only (or hosted only if separately approved)
2. Set project allowance ≥ $1.00
3. Create PENDING founder authorization for the exact task scope; founder Approves in UI
4. Reserve 100 cents; estimate cost; dispatch **once** through live adapter
5. Materialize → restricted Docker tests → reconcile actual usage → founder review
6. Disable live flag; do not auto-approve further spend

## Credential names (never values)

- `OPENAI_API_KEY`
- `GEMINI_API_KEY` (backup path)
- `OPENROUTER_API_KEY` (optional later)
