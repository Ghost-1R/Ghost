# Pilot 03 — Security Verification

**Worktree:** `C:\Users\Badge\Documents\ghost-09-9d-db-verify`  
**Target:** disposable ghost99f only  
**Checked:** 2026-10-12 (workday mission)

## Isolation

| Control | Result |
| --- | --- |
| App | `127.0.0.1:3012` |
| API | `http://127.0.0.1:54331` |
| DB | `127.0.0.1:55432` (`supabase_db_ghost99f`) |
| Protected Ghost DB `54322` | Untouched |
| Hosted Supabase URL in Pilot 03 env | **NO** |
| `GHOST_AGENT_RUNTIME_API_URL` | `http://127.0.0.1:54331` |
| `GHOST_CODEGEN_LIVE_ENABLED` | `0` |

## Credentials (metadata only — no values)

| Check | Result |
| --- | --- |
| `OPENAI_API_KEY` present in `.env.local` | YES |
| `.env.local` gitignored / untracked | YES |
| `NEXT_PUBLIC_OPENAI_API_KEY` | absent |
| Founder rotation confirmation | **ACCEPTED** (founder stated rotated; values not compared) |
| Production / hosted credentials active | NO |
| Secrets printed in this mission | NO |

## Authorization integrity

| Field | Value |
| --- | --- |
| Authorization | `5aee1635-62c3-4ab6-8237-060ee4bc1b16` |
| Status | `APPROVED` |
| Uses | `0` / ONE_TIME |
| Expired | NO (expires `2026-10-13T13:49:09.034Z`) |
| Fingerprint | `c98ad5b97432d22a9600990dc664fa43b52a8d24a3932015ee82cf88475fcf71` (match) |
| Scope | openai / gpt-5-mini / PUBLIC / LOCAL_PILOT_03 / maxCents=100 / deploy=false / dispatch=DISABLED |
| Task | `8bdfde20-2f66-4518-9aea-6e632001fe7f` still **not queued** |
| Prior dispatches | **0** |

`dispatch=DISABLED` is the canonical prepared-live fragment; live entrypoint gates on CONSUMED + flag + exact provider/model — not by flipping that fragment.

## Spending controls

- Internal allowance: 100¢ / reserved 0 / charged 0
- SQL reserve / reconcile / release verified via disposable-identity integration tests
- UNCERTAIN_BILLING preserves reservation; no auto-retry
- Duplicate dispatch blocked by `codegen_provider_dispatches` idempotency
- Development authorization never grants deployment
- **No external $1 hard cap guaranteed** by OpenAI — Ghost internal ceiling only

## Workday mutations to founder objects

| Action | Performed? |
| --- | --- |
| Queue founder task | NO |
| Consume authorization | NO |
| Enable live flag | NO |
| Live OpenAI call | NO |
| Hosted / production write | NO |
