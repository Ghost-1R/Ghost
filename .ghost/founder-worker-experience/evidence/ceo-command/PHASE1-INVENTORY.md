# Phase 1 inventory — Ghost CEO Command Center

Branch: `ghost-ceo-command` (from `underworld-watch-review` @ `3555d97`)

## Missing revision
- Commit `314c8c1` is **not present** in this clone or remotes fetched so far.
- Closest historical CEO work: `a667cbe` (OS command center), `4db1b33` / `cfcc716` (CEO UX refine).
- No existing `/command` route; command-bar lives in `src/components/shell/top-command.tsx`.

## Stack (keep)
- Next.js 16.4.1, Supabase (local ghost99f @ 54331), Render (production untouched).
- LIVE stays 0 unless separately authorized.

## Reuse map (summary)
| Module | Route / lib | Status |
|--------|-------------|--------|
| Today / Ask Ghost | `/dashboard`, companion + conversation | Real |
| Companies (Ivoire Market, IM Distributors) | `/companies`, catalog | Real |
| Team / invites / My Work | `/team`, `/team/my-work` | Real |
| Assignments | `work_assignments` | Real (no kanban route yet) |
| Approvals | `/approvals` | Real |
| Agent tasks / control center board | `control-center.ts`, workspace | Real + MOCK worker |
| Underworld desks | `/underworld` | Hybrid (scene sim + real monitors) |
| Sales Map | `/companies/[id]/map` | Real (orders; prospects ≠ revenue) |
| CEO health signals | `ceo.ts` / `ceo-queries.ts` | Real derivation; not on Today page |
| Notifications inbox | — | Missing |
| Opportunity CRM | — | Missing (prospects ≠ opportunities) |
| Finance / profit | `moneyStatusPhase1` UNKNOWN | Missing GL |
| AI company schedules | Underworld shift UI + shift jobs on other branch | Partial |

## Production vs local
- Production Render: do not deploy from this overnight branch without separate auth.
- Disposable DB: ghost99f (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331`).
- External sends / paid providers: fail closed; surface connection blockers in UI.
