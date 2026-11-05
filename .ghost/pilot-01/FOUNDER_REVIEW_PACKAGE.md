# Pilot 01 — Founder Review Package

**Branch:** `cursor/pilot-01-supervised-coding-prep`  
**Commit:** see `FINAL_HEAD` in overnight report (pushed to GitHub)  
**Environment:** Windows local (`BADGER`) with disposable `ghost99f` + Docker Desktop

## Development objective

Create a responsive car rental landing page with a hero, three dummy vehicle cards, and a booking inquiry form with local validation only.

## Authorization scope

| Field | Value |
|-------|-------|
| Kind | DEVELOPMENT |
| Action | `agent_task.develop` |
| Reuse | ONE_TIME |
| Environment | `LOCAL_PILOT` |
| Deployment | never inferred from development |

Security migration `20261011100000_agent_tasks_reject_revoked_expired_auth.sql` applied to **disposable** `supabase_db_ghost99f` only.

## Attribution (critical)

| Work | Actor |
|------|-------|
| Car rental HTML/CSS/JS sample | **Cursor-prepared** (not Ghost-generated) |
| Isolated Docker pilot (harmless Node fixture) | **Ghost runtime** — real containers |
| Authorization / bind security SQL | **Ghost DB** on disposable stack |
| Autonomous code generation of novel apps | **NOT IMPLEMENTED** |

## Evidence paths

- `.ghost/pilot-01/evidence/security-migration-apply.json`
- `.ghost/pilot-01/evidence/security-sql-verification.json` (14/14 PASS)
- `.ghost/pilot-01/evidence/docker-pilot-run.json` (realContainerExecution=true)
- `.ghost/pilot-01/sample-workspace/car-rental-landing/`
- `.ghost/pilot-01/TASK_DEFINITION.md`

## Acceptance criteria

1. [ ] Sample page meets objective (hero, 3 cards, local form)
2. [ ] No payments/email/credentials/production APIs
3. [ ] Revoked/expired bind gate verified on disposable DB
4. [ ] Docker fixture pilot verified (not claimed as car-rental codegen)
5. [ ] Founder Accept / Reject / Request changes (no auto-merge)

## Preview method

Open locally (no public publish):

```
.ghost/pilot-01/sample-workspace/car-rental-landing/index.html
```

## Outstanding / unverified

- Ghost autonomous generation of the car rental page: NOT IMPLEMENTED
- Durable workflow live dispatch of Pilot 01 as a queued agent task: NOT RUN overnight
- Hosted Supabase / production apply: NOT AUTHORIZED
