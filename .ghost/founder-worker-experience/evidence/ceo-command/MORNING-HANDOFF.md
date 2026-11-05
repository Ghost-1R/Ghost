# Morning handoff — Ghost CEO Command (overnight partial)

**Not 100% complete.** This handoff separates what shipped, what was verified locally, and what remains blocked.

## Preview
- Local: http://127.0.0.1:3012/command
- Start: `npm run dev -- -p 3012 -H 127.0.0.1` with `.env.local` pointing at disposable ghost99f (`54331`)
- Branch: `ghost-ceo-command`
- Commits: see `git log --oneline -5`
- Production / Render: **untouched** (no deploy)

## One-minute walkthrough
1. Sign in → open **Command** in the primary nav (or `/command`).
2. Read greeting, system health, company filter (Ivoire Market / IM Distributors present).
3. Open a Sentinel/alert row → lands on source project evidence.
4. Scroll to Task Command → open an In Progress assignment → Worker / Underworld.
5. Click **Command · Grow · Lead** or Shifts → Underworld desks/monitors (PR #9 work).

## Module status

| Module | State | Notes |
|--------|-------|-------|
| `/command` shell + GRIDD hierarchy | **Completed + locally verified** | Navy/gold CSS, rail, KPI, pulse, alerts, board, strip |
| Company filter | **Completed** | Query `?company=`; Ivoire + IM in selector |
| CEO briefing / What needs me | **Completed** | From `rankTop3Actions` + real signals |
| Company Pulse | **Completed** | Real companies; health from open tasks/critical signals |
| Workforce / Team links | **Partial** | Counts real; invite/revoke reuse `/team` (not rebuilt) |
| Task Command board | **Partial** | Read-only board from `work_assignments`; mutations still on project pages |
| Approvals / AI Control Room link | **Completed (link)** | `/approvals` existing gates |
| Opportunity Radar | **Locally verified (demo seed)** | Migration + labeled sample rows; no external connectors |
| Finance | **Locally verified (demo seed)** | Cleared cash vs unpaid invoice distinguished |
| Communications inbox | **Not built** | Links to Ask Ghost / activity; no read/unread inbox table |
| AI company schedules + durable shift E2E | **Not completed on this branch** | Default 9–5 cue only; full shift jobs live on `underworld-shifts` |
| Underworld cinematic desks | **Completed earlier (PR #9)** | On `underworld-watch-review` / included base |
| External lead connectors / LIVE providers | **Blocked** | Needs account secrets; UI shows connection health |
| Commit `314c8c1` | **Missing** | Not in this clone/remotes |

## Migrations
- Applied on disposable ghost99f: `20261105093000_ceo_opportunities_finance.sql`
- Demo seed (labeled): opportunities + finance for Ivoire Market / IM Distributors

## Checks run
- `npm run typecheck` — pass
- eslint on command files — pass
- Browser open `/command` — pass after CSS fix
- Full founder demo matrix (invite iso, interrupt AI shift, approve consequential, phone 390) — **not fully executed overnight**

## Morning actions for you
1. Set `GHOST_CEO_NAME=CEO JITTA` in `.env.local` if you want that greeting over profile display name.
2. Continue phases 3–4 on this branch or merge `underworld-shifts` carefully for durable AI shift jobs.
3. Authorize Render/provider secrets only when ready for LIVE; keep consequential actions approval-gated.
4. Support contacts (for unexpected errors policy): 3138259887 · jittabadger.business@gmail.com
