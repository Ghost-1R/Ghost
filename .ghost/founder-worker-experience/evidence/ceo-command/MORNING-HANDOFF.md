# Morning handoff — Ghost CEO Command (overnight)

**Not 100% complete.** Full acceptance matrix (invite isolation, interrupt/resume AI claim, phone-signed flows for every step) was not finished overnight. Production / Render remains untouched.

## Preview
- Local: http://127.0.0.1:3012/command
- Start: `npm run dev -- -p 3012 -H 127.0.0.1` with `.env.local` → disposable ghost99f (`54331`)
- Optional: `GHOST_CEO_NAME=CEO JITTA` (local owner aliases also map to CEO JITTA)
- Branch: `ghost-ceo-command`
- Tip: see `git rev-parse HEAD` after push
- Screenshots: `ceo-command-desktop.png`, `ceo-command-desktop-phase3.png`, `ceo-command-phone-390.png`

## One-minute walkthrough
1. Sign in → **Command** (`/command`).
2. Filter **Ivoire Market** / **IM Distributors**; read KPIs + Company Pulse.
3. Acknowledge a Sentinel alert or open its source project.
4. Opportunity Radar → **Create research task** (no outreach sent).
5. **Command · Grow · Lead** → Underworld city + desk monitors + **SHIFT RUNNER** jobs.

## Module status

| Module | State | Notes |
|--------|-------|-------|
| `/command` GRIDD shell | **Completed + locally verified** | Navy/gold, rail, KPIs, pulse, alerts, board, strip |
| Company filter | **Completed** | `?company=` with Ivoire + IM |
| CEO briefing / What needs me | **Completed** | Ranked from real signals |
| Communications inbox | **Completed + locally wired** | `/communications` from activity/presence; cookie read state |
| Sentinel acknowledge | **Completed** | Cookie + activity audit when company/project known |
| Opportunity Radar | **Locally verified** | Manual add + convert→AI proposal task; no external connectors |
| Finance ledger | **Locally verified** | `/command/finance` drill-down; cash ≠ unpaid invoice |
| Work Mode | **Completed** | Cookie-persisted visual modes only |
| Task Command board | **Partial** | Read board; mutations still on project pages / Team |
| Workforce invite/revoke | **Reuse** | Existing `/team` |
| Underworld desks + scenes | **Completed (PR #9 base)** | Distinct locations + monitors |
| Underworld shift jobs | **Merged + locally verified UI** | Migration present; runner panel + jobs on `/underworld`; worker needs `GHOST_UNDERWORLD_SHIFTS=1` + service role |
| Full founder demo matrix | **Not fully executed** | See morning actions |
| External lead connectors / LIVE | **Blocked** | Needs account secrets; UI shows connection health |
| Commit `314c8c1` | **Missing** | Not in this clone |

## Migrations (disposable ghost99f)
- `20261105090000_underworld_shift_jobs.sql` — applied
- `20261105093000_ceo_opportunities_finance.sql` — applied

## Checks
- `npm run typecheck` — pass
- eslint on command / shifts / underworld page — pass
- `npm run test:underworld-shifts` — 9/9 pass
- Browser `/command` + `/underworld` — pass after actions.ts export fix
- Production build / full invite+shift interrupt matrix — not re-run in this segment

## Morning actions for you
1. Set `GHOST_CEO_NAME=CEO JITTA` if you want that greeting over other profiles.
2. To exercise durable shifts: `GHOST_UNDERWORLD_SHIFTS=1`, `GHOST_UNDERWORLD_SHIFT_FORCE=1` (local only), service role in env, `npm run worker`.
3. Do not enable LIVE / Render without separate authorization.
4. Support: 3138259887 · jittabadger.business@gmail.com
