# Pilot 01 — required Windows execution steps (founder-supervised)

These steps are **not** claimed as completed by the Cursor Cloud/Desktop preparation session unless separately evidenced.

## Prerequisites

1. Docker Desktop engine running (`docker version` shows Server).
2. Disposable Supabase Auth/PostgREST stack (e.g. `ghost99f` from Build 09.9F) **or** a new disposable stack — never `supabase_db_ghost` / port `54322`.
3. Worktree/branch: `cursor/pilot-01-supervised-coding-prep`.

## Apply local-only migrations (disposable DB only)

```powershell
# From disposable project OR via docker exec into disposable DB container only
# Include in order:
# 20261011092000_agent_tasks_authorization_match.sql
# 20261011100000_agent_tasks_reject_revoked_expired_auth.sql
```

Do **not** run `supabase db push` against hosted/production.

## Founder authorization path

1. Create ONE_TIME `DEVELOPMENT` authorization for Pilot 01 scope (`LOCAL_PILOT` / `agent_task.develop`).
2. Approve as founder.
3. Queue/consume via durable workflow (authorization → CONSUMED).
4. Confirm revoked/expired binds are rejected by DB on INSERT.

## Isolated Docker pilot (optional, explicit)

```powershell
$env:GHOST_ISOLATED_PILOT_ENABLED = "1"
# Ensure GHOST_AGENT_EXECUTION_ENABLED is NOT set
npm run test:agent-runtime
# Or invoke preparePilot01Harness({ runDockerPilot: true, workspaceRoot: "<isolated root>" })
```

## Evidence to capture

- Authorization id + status transitions (redacted tokens)
- Task/checkpoint rows
- Docker pilot report (`realContainerExecution` true/false)
- Static review of `.ghost/pilot-01/sample-workspace/car-rental-landing/`
- Founder decision: Accept / Reject / Request changes
