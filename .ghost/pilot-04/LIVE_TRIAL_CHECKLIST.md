# Pilot 04 — Live Trial Checklist (FOUNDER ONLY)

Do **not** run this checklist until the founder is awake and explicitly authorizes a new LIVE attempt.

## Prepared (overnight — already done)

- [x] Pilot 03 failure preserved (FAILED / CANCELLED / CONSUMED uses=1 / 1¢ charged / 99¢ available)
- [x] `GHOST_CODEGEN_LIVE_ENABLED=0`
- [x] Response hardening: usage + finish_reason + reasoning tokens; empty → `EMPTY_PROVIDER_CONTENT`; truncated JSON → `TRUNCATED_OUTPUT`
- [x] Token strategy: `gpt-5-mini`, `reasoning_effort=low`, `max_completion_tokens=12000`, timeout 90s, no post-dispatch retries
- [x] Mock provider matrix: 48 focused unit tests pass
- [x] Real Docker mock validation: valid pass / invalid fail / MOCK_GENERATION attribution
- [x] Fresh PENDING authorization created (not Pilot 03 auth)
- [x] Max spend **$0.99** (no silent allowance top-up)
- [x] Typecheck / lint / production build pass

## Prepared IDs

| Item | Value |
| --- | --- |
| Remote task | `b28e3536-bb16-4ce9-b427-f056aac73e39` |
| Authorization | `4e36f06e-5a54-45b4-afd8-4d3d1c665e91` (PENDING, uses=0) |
| Project | `f5397422-1c9d-4ef5-b639-8eee89981f5e` |
| Environment | `LOCAL_PILOT_04` (accepted by live scope) |
| Do **not** reuse | `5aee1635-62c3-4ab6-8237-060ee4bc1b16` |

## Founder decisions required before LIVE

1. Approve the PENDING authorization in the Ghost dashboard (ONE_TIME).
2. Confirm project allowance remains ≥ reservation (available 99¢; worst-case estimate ~3¢). Optional: top up +1¢ only if you want a full $1.00 ceiling.
3. Explicitly set `GHOST_CODEGEN_LIVE_ENABLED=1` in worktree `.env.local` and restart the Pilot server (port 3012).
4. Confirm OpenAI key present for this disposable session only (never log it).
5. Trigger **one** LIVE execute from Development Tasks for the Pilot 04 task only.
6. After response: verify persisted `finish_reason`, token counts, reservation reconcile, Docker evidence, founder review required, **no deploy**.

## Hard stops

- No second paid attempt on the same task if dispatch already STARTED/FAILED with uncertain billing.
- No reuse of Pilot 03 authorization.
- No production / hosted Supabase / port 54322 writes.
- No automatic approval by an agent.

## Success criteria for first successful LIVE generation

- Visible structured files under Pilot 04 allowlist
- Usage metadata persisted
- Docker restricted run passes with real container execution
- Attribution `LIVE_PROVIDER` (not MOCK)
- Task reaches `AWAITING_FOUNDER_REVIEW`
- Deployment still forbidden
