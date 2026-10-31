# Founder + worker experience — implementation handoff

**Branch:** `cursor/pilot-04-first-success-prep`  
**Status:** Local implementation complete. Not pushed. Not deployed. LIVE=0. No paid provider call from this work.

## What shipped

One connected path on the existing systems:

1. **Founder control center** (Home) shows persisted queued / running / blocked / failed / completed / awaiting-approval counts. No invented revenue or progress.
2. **Worker workspace** at `/projects/[id]/workspace` binds project + idea-as-goal + conversation + plan + agent tasks + artifacts + approvals.
3. **Bounded MOCK worker** runs one checkpointed step from the workspace. Pause / resume / cancel use real agent-task transitions.
4. **Authorization repair:** `dispatch=DISABLED` blocks paid LIVE even if `GHOST_CODEGEN_LIVE_ENABLED=1`. LIVE must be named in the fingerprint.
5. **Provider classification router** fails closed; missing credentials are setup-needed.

## Startup

```bash
# Web (isolated worktree)
npx next dev -p 3012 -H 127.0.0.1

# Optional in-process MOCK worker on the existing web process (no extra Render service)
GHOST_WORKER_IN_PROCESS=1 npm run start

# Dedicated worker process (same repo; do not add a paid Render add-on)
npm run worker
```

A UI timer is not the worker. Workspace polling only refreshes status. Execution is `runBoundedMockWorkerTurn` / `npm run worker`.

## Environment VARIABLE NAMES only

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GHOST_CODEGEN_LIVE_ENABLED` (keep `0`)
- `GHOST_WORKER_IN_PROCESS`
- `GHOST_AGENT_EXECUTION_ENABLED` (workers stay contract-disabled)
- `GHOST_NO_LIVE_PROVIDER_CALLS`
- `GHOST_MODEL_PROVIDER`
- `GROQ_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (server-side only)

## Migrations

No new migration. Uses existing `agent_tasks`, `agent_review_artifacts`, `founder_action_authorizations`, `build_plans`, `ideas`, `ghost_conversations`. Rollback: revert this commit; no schema drop required.

## Implemented / mocked / blocked

| Area | State |
|------|--------|
| Authorization dispatch=DISABLED vs LIVE | Implemented |
| Founder control center from persisted tasks | Implemented |
| Worker workspace (chat, plan, tasks, artifacts, approvals) | Implemented |
| Pause / resume / cancel | Implemented (legal transitions only) |
| Bounded MOCK step + checkpoint | Implemented |
| Progress without manual refresh | Implemented (authenticated poll `/api/workspace/[projectId]/status`) |
| Classification fail-closed | Implemented |
| Paid LIVE OpenAI | Blocked — fingerprint still `dispatch=DISABLED`; flag stays 0 |
| Fresh LIVE pending authorization | Not created (founder did not authorize spend) |
| Render extra background worker | Not required; document in-process flag |
| Ivoire Shop / IM DISTRIBUTORS | Untouched |
| Production / hosted Supabase | Untouched |

## Pilot 05 recorded vs proposed LIVE scope

Recorded (unchanged, CONSUMED):

```
dispatch=DISABLED
fingerprint 41750dee744de6f6552bf9ffb5013604a16b5881b4d32dd894240599b06d8e7f
```

Proposed (NOT APPLIED) if founder later wants paid execution:

```
dispatch=LIVE
fingerprint 4dcd2935c1ef79aeb276cc99b92e6528b6e3d214c746a4d41c8372f67b29e92e
```

That requires a **new** PENDING one-time authorization. Do not mutate the consumed record.

## Tests run

- Focused: live-scope, request-contract, workspace, classification-router, in-process-worker, dashboard truth, durable-live-execution — 27 pass
- `tsc --noEmit` pass after artifact typing fix
- `tsc --noEmit` pass
- ESLint pass on changed files (full lint: 0 errors)
- `next build` compiled routes including `/projects/[id]/workspace` and `/api/workspace/[projectId]/status`; the CLI then exited on a Next.js security-upgrade gate (not an app compile error)

## Next founder step

1. Open Home → Worker activity, then a project **Worker Workspace**.
2. Persist a chat turn and, if a DRAFT/PLANNING/REVIEW plan exists, edit the summary.
3. If a QUEUED agent task exists, run one MOCK step and confirm the label `MOCK_GENERATION`.
4. Decide whether to create a new PENDING `dispatch=LIVE` authorization. Until then keep LIVE=0.
