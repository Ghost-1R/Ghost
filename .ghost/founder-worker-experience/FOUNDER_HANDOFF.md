# Founder + worker experience — handoff (continued)

**Branch:** `cursor/pilot-04-first-success-prep`  
**Tip before this continuation:** `5976b83`  
**Status:** Local only. Not pushed. Not deployed. `GHOST_CODEGEN_LIVE_ENABLED=0`. No paid provider call.

## Worktree map (preserved)

| Path | Branch | HEAD | Notes |
|------|--------|------|-------|
| `Documents/ghost-09-9d-db-verify` | `cursor/pilot-04-first-success-prep` | this tip | Active implementation |
| `Documents/ghost` | `ghost-operations-09` | `243bf65` | Approval Center V1 — **untouched** |
| `Documents/ghost-09-9b-docker-pilot` | detached | `bcfdaed` | Untouched |

Approval Center V1 (`243bf65`) is the **merge-base** of this branch. No cherry-pick required; this tip already contains it and extends remote-dev / worker / Pilot work on top.

## Connected founder workflow

Project → Goal (idea) → Worker chat → Plan → Bounded MOCK execution → Saved checkpoints → Review / Decisions → Verified result labels.

Surfaces:

- **Today** `/dashboard` — blockers, priorities, next useful action, worker board
- **Projects** `/projects`
- **Worker** `/projects/[id]/workspace` — chat, plan, tasks, Start/Pause/Resume/Cancel, artifacts, approvals
- **Files** `/files` — persisted founder-private artifacts
- **Decisions** `/decisions` — open decisions + PENDING authorizations
- **Settings** `/settings`

## Design

Charcoal sidebar (`#2f3a44`), turquoise accent (`#14b8a6`), white raised cards, spacious radius, restrained motion, reduced-motion respected. Responsive breakpoints include **390**, **768**, and desktop width.

## Authorization / privacy

- `dispatch=DISABLED` refuses paid LIVE even if the process LIVE flag is on.
- Consumed Pilot 05 auth is not reused; LIVE not enabled to bypass.
- Five provider rules: server-side credentials, classify before route, no weaker privacy fallback, separate provider quotas/usage (`provider-quotas.ts`), fail closed.

## Startup

```bash
npx next dev -p 3012 -H 127.0.0.1
npm run worker
# optional in-process MOCK on existing web process:
GHOST_WORKER_IN_PROCESS=1 npm run start
```

## Render release instructions (after local pass — do not deploy from this handoff)

1. Keep production on current Render service; do **not** attach a new paid worker service.
2. Set env names only: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GHOST_CODEGEN_LIVE_ENABLED=0`, `GHOST_NO_LIVE_PROVIDER_CALLS=1`, optional `GHOST_WORKER_IN_PROCESS=1`, model keys server-side only.
3. Deploy this branch only after founder review of the commit SHA.
4. Confirm `/api/health` SHA matches the intended commit. Presentation Gate remains separate.
5. Stay on Supabase Free. No `db reset`. Additive migrations only if later required (none in this change).

## Implemented / locally verified / deployed

| Area | State |
|------|--------|
| Simple nav + light charcoal/turquoise shell | Implemented + locally verified (design tests) |
| Today / Files / Decisions / Worker controls | Implemented + unit verified |
| dispatch=DISABLED blocks LIVE | Implemented + unit verified |
| Provider classification + quotas | Implemented + unit verified |
| Approval Center V1 | Already present via merge-base `243bf65` |
| Browser responsive walkthrough | Blocked — Next CLI security-upgrade gate previously stopped `next dev`/`next build` after compile |
| Paid LIVE / production deploy | Off / unchanged |

## Checks performed

- Focused tests: **30 pass** (live-scope, request-contract, workspace, classification, quotas, design shell, dashboard truth, durable-live, in-process worker)
- `GHOST_CODEGEN_LIVE_ENABLED=0` confirmed in `.env.local`
- `tsc --noEmit` run after changes

## Remaining blockers / founder decisions

1. Browser evidence blocked until Next security-upgrade prompt is handled without enabling LIVE.
2. Whether to create a **new** PENDING `dispatch=LIVE` authorization (fingerprint `4dcd2935…`) — not done.
3. When to deploy this branch to Render after founder review.
