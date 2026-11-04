# Founder + worker experience — handoff (continued)

**Branch:** `cursor/pilot-04-first-success-prep`  
**Tip before this continuation:** `7de7449`  
**This tip:** see `git rev-parse HEAD` after the Next 16.4.1 + local verification commit  
**Status:** Local only. Not pushed. Not deployed. `GHOST_CODEGEN_LIVE_ENABLED=0`. `GHOST_NO_LIVE_PROVIDER_CALLS=1`. No paid provider call.

## Worktree map (preserved)

| Path | Branch | HEAD | Notes |
|------|--------|------|-------|
| `Documents/ghost-09-9d-db-verify` | `cursor/pilot-04-first-success-prep` | this tip | Active implementation |
| `Documents/ghost` | `ghost-operations-09` | `243bf65` | Approval Center V1 — **untouched** (4 untracked settings files left alone) |
| `Documents/ghost-09-9b-docker-pilot` | detached | `bcfdaed` | Untouched |

Approval Center V1 (`243bf65`) remains the merge-base. No cherry-pick required.

## Next CLI security gate (resolved)

**Triggering commands:** `npx next build` (and the one-time agent path of `npx next dev`) on **Next.js 16.4.0**.

**Exact error (build):**

```text
Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability.
**We strongly recommend you upgrade Next.js.**
This command stopped to show the upgrade recommendation. Retry the same command to continue the original task.
...
next upgrade --agent=security --internal-nudge-id=...
Reference: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
exitCode: 1
```

**Official guidance:** [Next.js Security Update (Oct 14, 2026)](https://nextjs.org/blog/nextjs-security-update-october-14-2026) — for 16.x install `next@16.4.1`.

**Smallest change applied:**

```bash
npm install next@16.4.1 eslint-config-next@16.4.1 --save-exact
```

Diff review: `package.json` pins only; `package-lock.json` ~98 lines for next/eslint-config-next; `npm ls next sharp` → `next@16.4.1` + `sharp@0.35.5`. Default `experimental.agentUpgrade: 'security'` **kept** (not disabled).

**After upgrade:** `npx next --version` → 16.4.1; `npx next build` → **BUILD_EXIT:0** (no SecurityFatalError). Evidence: `.ghost/founder-worker-experience/evidence/next-cli-build.log`, `next-cli-build-after-upgrade.log`.

## Connected founder workflow

Project → Goal (idea) → Worker chat → Plan → Bounded MOCK execution → Saved checkpoints → Review / Decisions → Verified result labels.

Surfaces: Today `/dashboard`, Projects `/projects`, Worker `/projects/[id]/workspace`, Files `/files`, Decisions `/decisions`, Settings `/settings`.

## Authorization / privacy

- `dispatch=DISABLED` refuses paid LIVE even if process LIVE flag is on.
- `GHOST_CODEGEN_LIVE_ENABLED=0` and `GHOST_NO_LIVE_PROVIDER_CALLS=1` in `.env.local`.
- Consumed Pilot 05 auth is not reused; LIVE not enabled to bypass.
- Five provider rules unchanged: server-side credentials, classify before route, no weaker privacy fallback, separate quotas, fail closed.

## Startup (local isolated — ghost99f @ 127.0.0.1:54331)

```bash
npx next dev -p 3012 -H 127.0.0.1
npm run worker   # demand-driven MOCK claim helper; exits after arming
```

Do **not** use hosted/54322. Keep LIVE=0.

## Local browser verification (observed)

Signed in as local disposable founder (`pilot02-owner-…@ghost.local`) against ghost99f.

1. **Today → project → MOCK → result → Files**
   - Today showed Ghost Pilot 03 QUEUED.
   - Worker Start MOCK step advanced checkpoints 1→4 → **SUCCEEDED**.
   - Notice: `MOCK_GENERATION completed. This is not a live provider run.`
   - Files listed `MOCK result · agent_task.develop` + checkpoint snapshots with **Open saved result in worker** (`?task=`).

2. **Pause / refresh / worker restart / Resume**
   - After checkpoint 1: Pause → **BLOCKED** (`Paused by founder…`).
   - Refresh preserved checkpoint 1.
   - `npm run worker` restarted cleanly (`mode: MOCK_GENERATION`, `liveHttp: false`).
   - Resume → **QUEUED** at checkpoint 1; next Start → checkpoint **2** (`mock-step-1` not repeated).

3. **Cancel**
   - Separate QUEUED task `cbb05d17-…` Cancel → **CANCELLED** at checkpoint 0; no further steps.

4. **Cross-account isolation**
   - Second local user (`isolation-d-…@ghost.local`): `taskRows=0`, `artifactRows=0`, `patchRows=0` on owner task/artifacts.
   - Owner task remained **SUCCEEDED**. Evidence: `evidence/isolation-second-user.json`.

5. **Decisions**
   - Open decision “Accept MOCK vehicle result?” for Ghost Pilot 03 with **Open linked task** → workspace `?task=a1d3acfb-…`.

6. **Responsive**
   - **390px:** Menu control present; Decisions/Worker readable; worker controls stack to one column (existing CSS).
   - **Desktop 1280:** full nav + board usable; Phase VERIFIED after SUCCEEDED.

## Fixes landed in this tip (beyond Next pin)

- Persist MOCK checkpoint + result rows into `agent_review_artifacts` from `runWorkspaceMockTurn`.
- Soft-load workspace when conversation/ideas/plan tables missing; project detail fallback without `repository_provider|branch|commit`.
- Decisions select fallback without `idea_id`/`strategy_id`; link open decisions/auths to project/task when evidence exists.
- Files links include `task_id`; workspace honors `?task=`.
- `formatTimestamp` uses fixed `en-US` + `UTC` to reduce hydration mismatch.

## Checks performed

- Focused unit: **25 pass** (workspace, live-scope, request-contract, classification, quotas, dashboard truth)
- `npx next build` after 16.4.1: pass
- Browser walkthrough on 3012 / ghost99f: pass as above
- `Documents/ghost` still `243bf65` with same 4 untracked settings files

## Remaining / founder decisions

1. Whether to create a **new** PENDING `dispatch=LIVE` authorization — not done.
2. Production / Render deploy — **separate step**; not done from this handoff.
3. Optional: dedupe rare double-submit artifact rows if form is clicked twice on final MOCK step.

## Render release instructions (do not deploy from this handoff)

1. Keep production on current Render service; do **not** attach a new paid worker service.
2. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GHOST_CODEGEN_LIVE_ENABLED=0`, `GHOST_NO_LIVE_PROVIDER_CALLS=1`, optional `GHOST_WORKER_IN_PROCESS=1`, model keys server-side only.
3. Deploy only after founder review of the commit SHA.
4. Confirm `/api/health` SHA matches. Presentation Gate remains separate.
5. Stay on Supabase Free. No `db reset`.
