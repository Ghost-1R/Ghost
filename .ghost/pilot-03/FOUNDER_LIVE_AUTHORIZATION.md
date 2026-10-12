# Pilot 03 — Founder Live Authorization Procedure

**Status:** Prepared entrypoint exists. **Live flag remains OFF.** No real API calls until founder completes this checklist on disposable ghost99f only.

## Exact authorized scope (first live job)

| Field | Required value |
| --- | --- |
| Provider | OpenAI |
| Model | `gpt-5-mini` |
| Classification | `PUBLIC` |
| Action | `agent_task.develop` (AI code generation) |
| Environment | `LOCAL_PILOT_03` (disposable local pilot) |
| Max provider usage | **$1.00** (100 cents) |
| Deployment | **forbidden** (`deploy=false` in scope) |
| Reuse | **ONE_TIME** (exactly one job) |

## Server enablement (names only — never commit values)

1. On the **disposable** Ghost app env only (never production unless separately authorized):
   - Set `GHOST_CODEGEN_LIVE_ENABLED=1`
   - Set `OPENAI_API_KEY` via server secret store (Render / local `.env.local` gitignored)
   - Optional: `OPENAI_ORG_ID` if your org requires it
2. Do **not** put keys in the repo, client bundles, screenshots, or chat logs.
3. Keep `GHOST_NO_LIVE_PROVIDER_CALLS=1` for all automated gates except an explicitly founder-approved live probe.

## Ghost Allowance (SQL ledger)

1. On disposable ghost99f, provision project allowance ≥ **100 cents**.
2. Live path reserves via `reserve_project_ai_allowance` before HTTP.
3. Memory ledger is **not** spending authority for live.

## Founder UI procedure

1. Sign in on disposable stack (API `54331`).
2. Remote Dev → new request with coding option **OpenAI — gpt-5-mini**, PUBLIC, max $1.
3. Approve in Founder Approval Center (exact fingerprint).
4. Queue (consumes ONE_TIME; binds `agent_tasks`).
5. With live flag still off, only **MOCK** runs. After founder enables the server flag:
   - Queued task shows the separate **LIVE** button (not MOCK).
   - Confirmation token `LIVE_OPENAI_GPT5MINI_USD1` is required.
6. After execution: review evidence → Accept / Reject / Request Changes. **No auto-accept. No deploy.**

## Uncertain billing

If the HTTP request may have reached OpenAI but usage is unclear (timeout / disconnect):

- Reservation is **preserved** (not released).
- Dispatch identity is marked failed with `UNCERTAIN_BILLING`.
- **No automatic retry.** Founder reconciles before any new attempt.

## Official API contract (verified in adapter)

- Endpoint: `POST https://api.openai.com/v1/chat/completions`
- Model family: `max_completion_tokens` (not `max_tokens`); omit `temperature` for gpt-5-mini
- `response_format: { type: "json_object" }`
- Missing `usage` → fail closed (`UNCERTAIN_BILLING`)
- Live durable path sets `maxRetries: 0`

## STOP

Do not enable the live flag until the founder explicitly authorizes this procedure on ghost99f.
