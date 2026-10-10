# Windows execution pack — disposable DB verification (Build 09.9C)

Use this pack on a Windows machine with Docker Desktop. Do **not** reset or modify existing Ghost development databases. Do **not** connect to hosted Supabase. Do **not** run `supabase db push` against production.

Cloud has **not** executed these PostgreSQL tests. Windows Docker pilot evidence for Build 09.9 remains local unless published separately.

## Prerequisites

- Docker Desktop running (`docker version`, `docker info` succeed)
- Repo checked out at the Build 09.9C / 09.13 line (or later on this task branch)
- Node.js + npm available
- Supabase CLI via `npx supabase` (or installed locally)

## 1) Create an isolated disposable Supabase stack

From the repo root, use a **dedicated** local project directory / stack name so you never touch an existing Ghost DB volume.

Example (adjust project id/name if your local tooling requires it):

```powershell
# Confirm Docker
docker version
docker info

# Start a disposable local stack (creates its own volumes)
npx supabase start
npx supabase status -o env
```

Confirm `API_URL` / `DB_URL` are `http://127.0.0.1...` or `localhost` only.

## 2) Apply LOCAL ONLY migrations to the disposable stack

Apply migrations **900–913** (approvals, agent_tasks, remote_development, agent link) onto this disposable stack only:

```powershell
# Prefer supabase db reset ONLY on a disposable stack you just created.
# NEVER reset an existing Ghost development database.
npx supabase db reset
```

If you must apply without full reset, use the disposable DB URL from `supabase status` and apply SQL files in order under `supabase/migrations/` ending with:

- `20261010090000_founder_action_authorizations.sql`
- `20261010090100_founder_action_authorizations_privileges.sql`
- `20261010090200_founder_action_authorizations_immutable_scope.sql`
- `20261010090600_agent_tasks_approval_bound.sql`
- `20261010090800_agent_worker_queue_and_artifacts.sql`
- `20261010091000_remote_development_tasks.sql`
- `20261010091300_remote_dev_agent_task_link.sql`

## 3) Run focused DB integration suites

```powershell
npm install
npm run test:approvals-db:local
npm run test:durable-db:local
```

These runners refuse non-loopback / `supabase.co` hosts.

## 4) Also re-run static cloud checks

```powershell
npm run typecheck
npm run lint
npm run build
npm run test:durable-09-13
npm run test:remote-development
npm run test:agent-runtime
```

## 5) Record results for founder review

Capture:

- Commit SHA tested
- Whether disposable DB was used (name / that it was not an existing Ghost DB)
- Approval DB suite pass/fail
- Durable DB suite pass/fail
- Any migration apply errors

## Hard limits

- PRODUCTION_CHANGES: NONE
- HOSTED_SQL_WRITES: 0
- MERGED: NO
- AGENTS_ACTIVATED: NO
- No real Cursor / GitHub Actions dispatch
