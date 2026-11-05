# Pilot 01 — Supervised coding task definition

## Objective

Create a responsive car rental landing page containing:

1. A hero section
2. Three example vehicle cards (dummy data only)
3. A booking inquiry form with local client-side validation

## Non-goals / hard prohibitions

- No real customer records
- No credentials or secrets
- No payments or payment APIs
- No real email submission
- No production API access
- No Ghost production app route changes
- No hosted Supabase writes
- No autonomous general agent activation

## Permitted deliverable paths

Disposable sample workspace only (outside Ghost app routes):

```
.ghost/pilot-01/sample-workspace/car-rental-landing/
  index.html
  styles.css
  app.js
  README.md
```

## Resource limits (isolated Docker pilot, when Windows engine available)

| Limit | Value |
|-------|-------|
| Image | `node:22-alpine` |
| Memory | 256 MiB |
| CPU | 0.5 nanoCPUs equivalent |
| PIDs | 128 |
| Duration | 60s |
| Network | none |
| User | non-root `10001:10001` |
| Workspace | bind-mount sample workspace read-only where possible |

## Authorization requirements

| Gate | Requirement |
|------|-------------|
| Kind | `DEVELOPMENT` only (`agent_task.develop`) |
| Environment | `REMOTE_DEV` or `LOCAL_PILOT` label matching authorization |
| Reuse | `ONE_TIME` founder authorization |
| Status | Authorization must be `APPROVED` then consumed to `CONSUMED` before/at task bind |
| Revoked/expired | DB rejects NEW `agent_tasks` binds (Pilot 01 migration) |
| Deployment | `deploymentAuthorized` must remain false |
| Verification | Simulated success ≠ independently VERIFIED |

## Review criteria

1. Hero, three vehicle cards, and inquiry form are present
2. Form validates required fields locally and does not submit off-host
3. No secrets, payments, or production API calls in source
4. Files confined to the permitted sample workspace
5. Focused harness/unit tests pass
6. Typecheck / lint / build pass on the Ghost prep branch
7. Founder review evidence pack is complete and honest about Docker/DB runtime

## Execution attribution

| Actor | Role in Pilot 01 prep |
|-------|------------------------|
| Cursor Cloud / Desktop agent | May prepare sample source and harness tests |
| Ghost durable workflow | Authorization + durable task contracts (not live-dispatched here) |
| Ghost isolated Docker pilot | Windows-only when `GHOST_ISOLATED_PILOT_ENABLED=1` + Docker available |
| Founder | Sole approver of VERIFIED and any future supervised run |
