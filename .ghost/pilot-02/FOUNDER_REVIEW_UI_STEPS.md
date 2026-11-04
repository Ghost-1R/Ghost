# Pilot 02 — Durable Founder Deliverable Review (UI)

**Status:** `READY_FOR_FOUNDER_UI_CONFIRMATION`  
**Environment:** disposable `ghost99f` only (`API 54331` / `DB 55432`)  
**Protected Ghost DB `54322`:** unchanged

## Do not

- Auto-submit ACCEPT via SQL or scripts
- Reuse the consumed ONE_TIME authorization
- Deploy or merge
- Sign in with fabricated credentials

## Verified Pilot 02 identities (pre-confirm)

| Field | Value | Status before UI confirm |
| --- | --- | --- |
| Remote task | `1513be21-f47b-4092-8ce4-8e14c538557b` | `AWAITING_FOUNDER_REVIEW` |
| Agent task | `2ba221e5-1d2f-4c75-9183-ddf53afcc18d` | `SUCCEEDED` |
| Authorization | `b549744a-a3ad-4694-ba23-89bc040091ea` | `CONSUMED`, uses=`1` |
| Documented local decision | `ACCEPT` in `FOUNDER_ACCEPTANCE.md` | **not** in database |

## Review UI

1. Open **http://127.0.0.1:3012/login**
2. Sign in with disposable owner credentials from `founder-ui-login.local.json` (local only).
3. Open **http://127.0.0.1:3012/development-tasks**
4. Find the Pilot 02 task under **Awaiting founder review**.
5. Confirm the notice shows the previously documented **ACCEPT** decision and that nothing was auto-submitted.
6. Click **Confirm documented ACCEPT (durable)** to persist authenticated review → `VERIFIED`.
   - Or use **Reject** / **Request changes** if that is the intended decision instead.
7. Refresh / re-open the page and confirm the durable review row and status persist.

## What the action does

- Authenticated owner + RLS project ownership
- Requires `AWAITING_FOUNDER_REVIEW` + bound agent `SUCCEEDED` + valid evidence/checkpoint
- Writes immutable `remote_development_founder_reviews`
- Sets remote status to `VERIFIED` / `FAILED` / `CHANGES_REQUESTED`
- Does **not** deploy, reopen authorization, or re-run Docker

## After confirm (expected)

- Remote task → `VERIFIED` (if ACCEPT)
- Authorization remains `CONSUMED` uses=`1`
- Audit row in `remote_development_founder_reviews`
