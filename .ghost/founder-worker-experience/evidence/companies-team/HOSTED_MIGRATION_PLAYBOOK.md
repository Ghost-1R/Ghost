# Hosted migration playbook — Ghost `wzwrrleqfylhuxfbukfu`

**Status:** BLOCKED on privileged backup (Supabase login-role **403** Access Control for the CLI account used from this worktree).  
**Live app commit:** `eaad3d2` (Companies/Team UI).  
**LIVE:** keep `GHOST_CODEGEN_LIVE_ENABLED≠1` (prefer explicit `0` + `GHOST_NO_LIVE_PROVIDER_CALLS=1` on Render).  
**Do not:** `db reset`, point at another project, or migrate without a verified restore.

## Required migrations (dependency order)

Apply only versions missing on hosted. Confirm with dashboard SQL / `supabase migration list` once linked with owner privileges.

### Already expected on hosted (verify first)

Base OS through preferences / agent stack may already be partial. Confirm these exist before Companies/Team:

1. `20260929015943_alpha_foundation.sql` — `companies`, `projects`, RLS helpers  
2. `20260930040000_operating_system_foundation.sql`  
3. `20261009010000_founder_preferences.sql` — **present** (REST)  
4. Agent/auth stack through `20261012120000_…` if Worker MOCK is used in prod  
5. `20261104120000_founder_day_plans.sql` — **missing** on hosted (REST)

### Companies / Team / assignments / activity / Sales Map (required for Set up companies)

6. `20261104210000_companies_team_assignments_sales.sql`  
   - columns: `companies.kind`, `site_url`, `is_catalog`  
   - tables: memberships, invitations, work_assignments, activity, orders, zip_centroids, map grants, prospects  
   - helpers: `can_select_*`, `record_project_activity`  
7. `20261104210100_team_invitation_rpcs.sql` — `get_team_invitation`, `accept_team_invitation`  
8. `20261104210200_assignment_assignee_guard.sql` — assignee update guard  

### Underworld (stage after foundation; optional for Set up companies)

9. `20261104220000_underworld_orchestration.sql` — goals / plans / steps (local-first until founder review)

## Backup gate (must pass before hosted apply)

1. Owner-privileged account on Supabase project `wzwrrleqfylhuxfbukfu`.  
2. Complete schema+data backup (dashboard backup or `supabase db dump` / PITR).  
3. Restore that backup into an **isolated** database.  
4. Apply migrations 5–8 (and 9 if staging Underworld) on the isolated copy.  
5. Checks on isolated copy:
   - `companies.kind` selectable  
   - `company_memberships`, `work_assignments`, `team_invitations` exist  
   - `select private.can_select_company('<id>')` runs for authenticated test role  
6. Only then apply the same files to hosted Free project.

**Partial REST JSON in `prod-backup/` does not satisfy this gate.**

## Apply commands (once privileged)

```bash
# from repo root, with owner-linked project
npx supabase link --project-ref wzwrrleqfylhuxfbukfu
npx supabase db dump -f backups/ghost-prod-$(date -u +%Y%m%dT%H%M%SZ).sql
# restore dump to isolated DB, apply migrations there, verify
npx supabase db push   # or run the three SQL files in order in SQL editor
```

## Post-migrate founder checks

1. `/api/health` still expected SHA.  
2. `/companies` → **Set up companies** twice → second run moves 0 projects.  
3. Catalog: Ivoire Market, IM Distributors, Badger United, Internal.  
4. Test invite `@ghost.local` → accept → My Work → submit → revoke.  
5. Cross-company denial for teammate.  
6. Assign work Team member | Ghost AI (LIVE=0).

## Rollback

- Redeploy previous Render SHA if app regresses (`711bb06` or earlier).  
- DB: forward-only; do not reset. If a migration fails mid-way, fix forward from isolated notes.  
- UI already fails closed with “Company setup is temporarily unavailable” when schema is missing.
