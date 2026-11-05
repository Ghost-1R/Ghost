# Ghost release + Underworld handoff

**Worktree:** `Documents/ghost-09-9d-db-verify`  
**Branch tip (pre-handoff commits):** see git log — foundation repair + Underworld staged on `cursor/pilot-04-today-redesign`  
**Documents\\ghost:** `243bf65` on `ghost-operations-09` — **untouched**  
**Render live (at handoff start):** `eaad3d2` on `ghost-experience`  
**LIVE:** local `GHOST_CODEGEN_LIVE_ENABLED=0`, `GHOST_NO_LIVE_PROVIDER_CALLS=1`

## Exact blocker (hosted)

| Item | Detail |
|------|--------|
| Project | `wzwrrleqfylhuxfbukfu` |
| Error | Supabase login-role **403** Access Control on `supabase db dump` / privileged migrate |
| Symptom | `companies.kind` missing → Set up companies failed with raw SQL (now soft-failed) |
| Gate | Complete protected backup + verified isolated restore **required** before hosted apply. Partial REST backup in `evidence/companies-team/prod-backup/` is **not** enough. |
| Playbook | `evidence/companies-team/HOSTED_MIGRATION_PLAYBOOK.md` |

**Production is not ready** for teammate isolation or catalog setup until that gate clears.

## Implemented

### Foundation (separable)
- Schema readiness probes (`src/lib/schema/readiness.ts`)
- Companies page: **“Company setup is temporarily unavailable”** + next action when schema missing
- Invites / assignments fail closed with the same user-facing message; diagnostics in server logs
- Hosted migration playbook with order, checks, rollback

### Underworld (staged — local)
- Migration `20261104220000_underworld_orchestration.sql` (goals/plans/steps + atomic claim lease)
- MOCK plan propose (planner → executor → independent human reviewer)
- UI `/projects/[id]/underworld` — create goal, preview, activate, run next step
- Reuses assignments + activity; refuses when LIVE=1
- Independent reviewer ≠ executor enforced

## Locally verified
- Unit: underworld plan propose, assignments workflow, sales-map aggregate
- `verify-e2e.mjs` (companies-team) previously pass on ghost99f
- `verify-underworld-local.mjs` — schema + claim + double-claim block (run after migration)
- `tsc --noEmit` clean for this pass

## Live on Render
- Commit `eaad3d2`: Companies/Team UI, Assign work Team member | Ghost AI
- Set up companies: **broken until hosted migration** (soft message after foundation deploy)
- Teammate isolation on prod: **not passed** (tables missing)

## What to open first when you return
1. Supabase project `wzwrrleqfylhuxfbukfu` as **owner** → privileged backup  
2. `HOSTED_MIGRATION_PLAYBOOK.md` → isolated restore → apply migrations 5–8  
3. Redeploy latest foundation tip → Set up companies **twice**  
4. Only then stage Underworld migration + UI for founder review (keep LIVE=0)

## Evidence paths
- `evidence/companies-team/prod-backup/release-report.json`
- `evidence/companies-team/HOSTED_MIGRATION_PLAYBOOK.md`
- `evidence/companies-team/verify-e2e.mjs`
- `evidence/companies-team/verify-underworld-local.mjs`
