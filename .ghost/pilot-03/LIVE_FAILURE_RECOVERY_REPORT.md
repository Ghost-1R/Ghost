# Pilot 03 — First live failure recovery

**Target:** disposable ghost99f only  
**Live flag during recovery:** `0`  
**Provider calls during recovery:** 0

## Diagnosis (from existing evidence only)

| Field | Value |
| --- | --- |
| HTTP status | **200 path** (empty-content branch only runs after `response.ok`) |
| Response ID | **UNKNOWN** (not logged at failure time) |
| finish_reason | **UNKNOWN** (not logged at failure time) |
| prompt_tokens | **UNKNOWN** |
| completion_tokens | **UNKNOWN** |
| reasoning_tokens | **UNKNOWN** |
| Visible content | empty / null |
| Structured files elsewhere | none accepted |

**ROOT_CAUSE:** `EMPTY_PROVIDER_CONTENT` after a successful HTTP response. Exact finish/token cause is **UNKNOWN** without persisted response metadata. Token-budget exhaustion is plausible for gpt-5-mini but **not confirmed**.

## Recovery applied

1. Remote task `RUNNING` → `FAILED` (legal transition + audit event)
2. Agent `QUEUED` → `CANCELLED` with failure reason
3. Auth remains `CONSUMED` / uses=`1`
4. LIVE dispatch remains terminal `FAILED`
5. Evidence: `executionMode=LIVE_PROVIDER`, `verificationState=FAILED`
6. Billing: original reservation stayed `RELEASED` (historical); new **OPEN** hold `billing-uncertain-hold-8bdfde20-…` for **100¢**; allowance reserved=100 / charged=0 / available=0 until founder reconciles OpenAI dashboard

## Prevention shipped

- Empty content → `EMPTY_PROVIDER_CONTENT` with usage/`finish_reason`/response id when present
- Treated as uncertain billing (do not release as unused)
- Live generation failures transition remote out of `RUNNING` and cancel agent
- LIVE evidence label set even on failure
- Focused + ghost99f integration tests green
