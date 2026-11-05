# Pilot 03 — Live Readiness Checklist

Use this when you return. Do **not** skip isolation checks.

## Pre-flight (must all be YES)

- [ ] Disposable only: API `54331`, DB `55432`, app `3012`
- [ ] Ghost DB `54322` and hosted Supabase untouched
- [ ] Auth `5aee1635-…` still `APPROVED`, uses=`0`, not expired
- [ ] Fingerprint still `c98ad5b9…`
- [ ] Task `8bdfde20-…` still unqueued
- [ ] Allowance available **100¢**
- [ ] `GHOST_CODEGEN_LIVE_ENABLED` still `0` until step 4
- [ ] `OPENAI_API_KEY` present (rotated key); never paste into chat
- [ ] Provider billing eligibility accepted as founder risk (**UNVERIFIED** by automation)

## Supervised single live dispatch

1. Sign in as founder on `http://127.0.0.1:3012/login`
2. Open `/development-tasks` — Pilot 03 card should show **APPROVED (not queued)** and Queue
3. **Queue (revalidate auth)** — consumes ONE_TIME → task `QUEUED`, auth `CONSUMED`
4. Only then set `GHOST_CODEGEN_LIVE_ENABLED=1` in disposable `.env.local` and restart **3012 only**
5. Confirm LIVE panel armed; confirmation token must be `LIVE_OPENAI_GPT5MINI_USD1`
6. Run **LIVE** once (not MOCK while flag is on)
7. Expect: SQL reserve → one OpenAI call → Docker validate → `AWAITING_FOUNDER_REVIEW`
8. Review evidence → Accept / Reject / Request Changes
9. Set `GHOST_CODEGEN_LIVE_ENABLED=0` again after the trial
10. If `UNCERTAIN_BILLING`: do **not** retry; reconcile manually

## Stop conditions

- Authorization expired → **STOP** (do not extend / replace pre-approved)
- Hosted URL appears in env → **STOP**
- Dispatch row already exists for the task → **STOP**
- Allowance &lt; estimated cents → **STOP**

## References

- `.ghost/pilot-03/FOUNDER_LIVE_AUTHORIZATION.md`
- `.ghost/pilot-03/SECURITY_VERIFICATION.md`
- `.ghost/pilot-03/WORKDAY_FINAL_REPORT.md`
