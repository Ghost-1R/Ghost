# Pilot 03 — OpenAI HTTP adapter (safe preparation)

**Branch:** `cursor/pilot-03-real-ai-coding-prep`  
**HEAD (committed foundation):** `a5a7a9d`  
**Worktree:** `C:\Users\Badge\Documents\ghost-09-9d-db-verify`  
**Disposable DB only:** ghost99f `55432` / API `54331` (Ghost `54322` untouched)

## Implemented

| Piece | Path |
| --- | --- |
| OpenAI Chat Completions HTTP | `src/lib/codegen/openai-http.ts` |
| Model allowlist + $1 ceiling | `src/lib/codegen/openai-models.ts` |
| Live dispatch + allowance + idempotency | `src/lib/codegen/live-dispatch.ts` |
| Adapter entry | `createOpenAiCodingAdapter()` → HTTP impl |

## Safety defaults

- `GHOST_CODEGEN_LIVE_ENABLED` unset → `LIVE_DISABLED` (no HTTP)
- UI `liveDispatch=1` still rejected by server action
- PUBLIC classification only for first trial
- ONE_TIME founder auth required before dispatch
- Atomic allowance reserve before generate; reconcile or release
- Missing usage → `UNCERTAIN_BILLING` (fail closed)
- Output path/content validation; founder review mandatory
- Development never grants deployment
- Keys: `OPENAI_API_KEY` server-side only; never logged

## Not done (blockers for first live $1)

1. Founder authorize live trial + set project allowance ≥ 100¢ on ghost99f  
2. Provision real `OPENAI_API_KEY` in disposable env only (not committed)  
3. Set `GHOST_CODEGEN_LIVE_ENABLED=1` only under founder authority  
4. Wire live dispatch into Remote Dev queue/worker path (currently library + tests)  
5. Connect restricted Docker test harness to live materialize output  
6. Hosted/prod still forbidden  

## Tests

Mock HTTP only (`brandCodegenMockFetch` + `GHOST_NO_LIVE_PROVIDER_CALLS=1`). Real API calls: **0**. Spend: **$0**.
