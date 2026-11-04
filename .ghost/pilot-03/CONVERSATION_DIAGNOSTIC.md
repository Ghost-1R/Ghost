# Conversation diagnostic (lower priority)

Checked disposable ghost99f (`127.0.0.1:54331`) during workday mission.

| Table | Status |
| --- | --- |
| `conversations` | PRESENT |
| `conversation_messages` | PRESENT |
| `chat_threads` | PRESENT |
| `messages` | PRESENT |

Previous missing-table issue is **not currently blocking** Pilot 03 security.

## If chat UI still fails

Likely causes (not repaired this mission):
- Chat provider intentionally unconfigured for disposable stack
- RLS / founder session mismatch for conversation rows
- UI expecting rows that were never seeded

## Minimal disposable-only plan (NOT applied)

1. Confirm failing query/error from `/api` or server logs on 3012 only.
2. Apply any missing conversation migration **only** against ghost99f (port 55432 / project `ghost-09-9f-supabase`).
3. Do **not** touch Ghost DB `54322`, hosted Supabase, or production.
4. Do **not** auto-configure a paid chat provider.

**Priority:** below Pilot 03 live readiness. No migration applied during this workday.
