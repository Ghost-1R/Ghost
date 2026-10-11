# Pilot 02 — Founder UI Approval Steps

**Status:** `AWAITING_FOUNDER_UI_APPROVAL`  
**Do not use** the production Ghost website.  
**Do not** approve via SQL.

## Verified targets

| Item | Value |
| --- | --- |
| Disposable API | `http://127.0.0.1:54331` (ghost99f) |
| Disposable DB | `localhost:55432` |
| Protected Ghost DB | `localhost:54322` — **not used** |
| Authorization | `b549744a-a3ad-4694-ba23-89bc040091ea` |
| Task | `1513be21-f47b-4092-8ce4-8e14c538557b` |
| Scope | `DEVELOPMENT` / `agent_task.develop` / `ONE_TIME` / `LOCAL_PILOT` |
| Local app | `http://127.0.0.1:3012` |

## Legitimate approval path

1. Server action: `approveFounderAuthorization` in `src/lib/approvals/actions.ts`
2. UI: `/approvals` → pending card → **Approve**
3. Uses authenticated session + `decideApprove` + `transitionFounderAuthorization` (RLS-bound user client)

## Steps for the founder

1. Open **http://127.0.0.1:3012/login**
2. Sign in with the disposable owner credentials from `.ghost/pilot-02/founder-ui-login.local.json` (local only; not committed).
3. Open **http://127.0.0.1:3012/approvals**
4. Confirm the pending card shows:
   - Action: `agent_task.develop`
   - Environment: `LOCAL_PILOT`
   - Reuse: `ONE_TIME`
   - Authorization id: `b549744a-a3ad-4694-ba23-89bc040091ea`
   - Scope mentioning car rental validation / Pilot 02 branch
5. Click **Approve** only for that authorization.
6. Reply in chat that UI approval is done (or wait for the agent poll to see `APPROVED`).

After independent DB confirmation of `APPROVED`, the agent will queue/claim/execute the restricted Docker validation once and stop for founder review of the deliverable.
