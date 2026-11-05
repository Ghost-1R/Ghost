# Pilot 03 — Queue duration gate fix

**Date:** 2026-10-13  
**Target:** disposable ghost99f only  
**Founder task/auth:** left unqueued / unconsumed

## ROOT_CAUSE

`queueDurableDevelopmentTask` / `queueDevelopmentTask` passed `elapsedMsSinceTaskCreated` into `gateRemoteDevQueue`, which compared wall-clock age since request creation to `maxDurationMs` (1 hour).

Pilot `8bdfde20-…` was created `2026-10-12T13:49:09Z`. By queue attempt (~15h later) creation age exceeded 1h → `DURATION_EXCEEDED` / "Elapsed duration exceeds the authorized maximum."

## Intended semantics (after fix)

| Clock | Purpose |
| --- | --- |
| Authorization `expires_at` | Hard stop for approve/queue (unchanged) |
| `maxDurationMs` | Execution/claim runtime ceiling from `startedAt ?? queuedAt` |
| Creation age | Must **not** burn execution budget while awaiting founder approval |

## FIX_APPLIED

1. `gateRemoteDevQueue` ignores `elapsedMs` (spending still checked).
2. Added `elapsedMsSinceExecutionStart` (0 before queue; then from `queuedAt`/`startedAt`).
3. Step/revalidation paths use execution-start elapsed.
4. Regression tests in `duration-gate.test.ts` + updated security/workflow tests.

## Founder state (post-fix dry-run)

- Task: `AWAITING_APPROVAL`, `queued_at=null`
- Auth: `APPROVED`, uses=`0`, fingerprint match
- Expires: `2026-10-13T13:49:09.034Z` — **still VALID** at verification time
- Dispatches: 0
- Queue gate dry-run: **OK** (no consume)

**Note:** If authorization expires before founder queues, stop and create a fresh PENDING authorization — do not extend this one.
