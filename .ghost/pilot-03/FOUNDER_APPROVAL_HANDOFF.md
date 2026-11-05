# Pilot 03 — Founder Approval Handoff

**Status:** `PILOT_03_AWAITING_FOUNDER_APPROVAL`  
**Environment:** disposable ghost99f only (`API 54331` / `DB 55432`)  
**Protected Ghost DB `54322`:** unchanged

## Identities

| Field | Value |
| --- | --- |
| Project | `f5397422-1c9d-4ef5-b639-8eee89981f5e` |
| Project name | Ghost Pilot 03 — AI Coding Test |
| Owner | `adcc741f-1570-472f-9bf4-ef44028f57fc` / `pilot02-owner-a3446b04@ghost.local` |
| Allowance | 100¢ available (reserved 0, charged 0) |
| Task | `8bdfde20-2f66-4518-9aea-6e632001fe7f` (`AWAITING_APPROVAL`) |
| Authorization | `5aee1635-62c3-4ab6-8237-060ee4bc1b16` (`PENDING`, ONE_TIME, uses=0) |
| Fingerprint | `c98ad5b97432d22a9600990dc664fa43b52a8d24a3932015ee82cf88475fcf71` |
| Environment | `LOCAL_PILOT_03` |
| Expires | `2026-10-13T13:49:09.034+00:00` |

## Scope (exact)

```
repo:Ghost-1R/Ghost@cursor/pilot-03-real-ai-coding-prep|obj:Use OpenAI gpt-5-mini to generate original responsive HTML, CSS and JavaScript for comparing three fictional rental vehicles, including prices, features and interactive selection.|codegen=pilot03;provider=openai;model=gpt-5-mini;class=PUBLIC;dispatch=DISABLED;estCents=1;maxCents=100;deploy=false
```

## Founder steps

1. Open `http://127.0.0.1:3012/login`
2. Sign in with disposable founder credentials (local-only `.ghost/pilot-02/founder-ui-login.local.json`)
3. Open `http://127.0.0.1:3012/approvals`
4. Confirm authorization `5aee1635-62c3-4ab6-8237-060ee4bc1b16` and fingerprint above
5. Click **Approve** only for that card
6. Do **not** queue or enable live until founder separately authorizes live execution

## Still blocked for live run (after approve)

- `OPENAI_API_KEY` in Pilot 03 server env: **NO**
- OpenAI billing / model availability founder confirmation: **NO**
- `GHOST_CODEGEN_LIVE_ENABLED`: **disabled**

## Safety

- Real provider calls: 0  
- Actual spend: $0  
- Approved/queued/dispatched: no  
- Production changed: no  
