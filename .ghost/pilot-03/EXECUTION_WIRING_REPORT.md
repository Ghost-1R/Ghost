# Pilot 03 — Complete Real AI Coding Execution Wiring

**Date:** 2026-10-12  
**Worktree:** `ghost-09-9d-db-verify`  
**Branch:** `cursor/pilot-03-real-ai-coding-prep`  
**Disposable only:** ghost99f API `54331` / DB `55432` (Ghost `54322` untouched)

## Path wired

Founder request → Pending authorization → Founder approval → Durable queue (ONE_TIME consume) → SQL allowance reserve → MOCK provider dispatch (durable identity) → Generated file proposal → Isolated workspace → Restricted Docker validate → Durable evidence/checkpoints → Founder Accept / Reject / Request Changes

Live OpenAI remains **off**. Remote Dev execute action runs **MOCK_GENERATION only**.

## Key artifacts

| Piece | Location |
| --- | --- |
| Durable mock pipeline | `src/lib/codegen/durable-execution.ts` |
| SQL allowance ledger | `src/lib/allowance/sql-ledger.ts` |
| Docker validate | `src/lib/codegen/docker-validate-generated.ts` |
| OpenAI HTTP adapter | `src/lib/codegen/openai-http.ts` (`max_completion_tokens`) |
| Migration (ghost99f) | `supabase/migrations/20261012120000_project_ai_allowance_reconcile_and_dispatch.sql` |
| Remote Dev action | `executeDurableCodegenWorkflow` |
| Integration tests | `src/lib/codegen/durable-codegen.integration.test.ts` |

## Gates

- Unit/focused: PASS (codegen + UI + allowance)
- ghost99f integration: PASS (9/9)
- typecheck: PASS
- lint: PASS
- build: PASS (Turbopack workspace path warnings pre-existing)

## Spend / production

- REAL_PROVIDER_CALLS: 0
- ACTUAL_SPEND: $0
- PRODUCTION_CHANGED: NO
- GHOST_CODEGEN_LIVE_ENABLED: disabled

## Remaining blockers for $1 live trial

1. Founder authorize separate live entrypoint (not Remote Dev MOCK button)
2. Project allowance ≥ 100¢ on ghost99f
3. Server-side `OPENAI_API_KEY` (never in client)
4. Explicit `GHOST_CODEGEN_LIVE_ENABLED=1` with founder approval
5. Accept that internal reservation ≠ external provider cannot overbill

**READY_FOR_ONE_DOLLAR_LIVE_TRIAL: NO** — STOP FOR FOUNDER REVIEW.
