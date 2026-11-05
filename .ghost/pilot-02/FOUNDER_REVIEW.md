# Pilot 02 — Founder Review Package

**Status:** `GHOST_PILOT_02_AWAITING_FOUNDER_APPROVAL`  
**Date:** 2026-10-11  
**Environment:** Windows Cursor Desktop — local disposable test only

## Identity

| Field | Value |
| --- | --- |
| Task ID (remote_development) | `1513be21-f47b-4092-8ce4-8e14c538557b` |
| Authorization ID | `b549744a-a3ad-4694-ba23-89bc040091ea` |
| Owner ID | `adcc741f-1570-472f-9bf4-ef44028f57fc` |
| Project ID | `da4946e5-2afc-497c-8302-05738f803d18` |
| Agent task ID | `null` (not created — stopped before queue/claim) |
| Disposable DB | `ghost99f` @ `localhost:55432` (API `54331`) |
| Branch | `cursor/pilot-02-durable-supervised-execution` |
| Base commit | `f9c02c325a0cf2f72c48b61b793472ed717fb406` |

## Task scope

- **Title:** Validate Car Rental Landing Page  
- **Objective:** Validate the previously prepared car rental sample using a restricted Docker runner and return the actual validation results to the founder.  
- **Kind / Action / Reuse / Env:** `DEVELOPMENT` / `agent_task.develop` / `ONE_TIME` / `LOCAL_PILOT`  
- **Deployment permission:** none  
- **Network / production secrets:** none  

## Founder approval record

- Authorization status: **PENDING** (not fabricated APPROVED)
- Durable remote status: **AWAITING_APPROVAL**
- Founder review status: **AWAITING_FOUNDER** (not auto-accepted)

## Durable state transitions observed

1. Requested → created as `AWAITING_APPROVAL` / auth `PENDING`
2. Queue blocked without approval
3. STOPPED at founder approval gate (no fabricated APPROVED, no agent_task bind for the pilot task)

## Docker execution (capability proof — not post-approval task execution)

Labeled `FIXTURE_VALIDATION_CAPABILITY_PROOF`. Car rental HTML/CSS/JS is **Cursor-prepared**, not Ghost-generated.

| Scenario | Classification | Notes |
| --- | --- | --- |
| validate | PASS | exit 0 |
| build | PASS | exit 0 |
| test | PASS | exit 0 |
| testFail | PASS | intentional fail exit 1 |
| timeout | PASS | timed out as expected |

- Image: `node:22-alpine` digest `sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402`
- Restrictions: non-root `10001:10001`, `network=none`, read-only root, resource caps, no Docker socket, no credentials
- Fixture content SHA-256: `24989f6b14b498678dd4db1afe113a8e87d4f610f9d92709cbc4483e9acf4b2c`

## Security negative tests (all PASS)

Missing approval · Revoked · Expired · Cross-owner · Cross-project · Approval reuse · Duplicate claim · Evidence tamper · Dev≠deployment · Recovery checkpoint

## Evidence hashes

- Report evidence hash: `d29174821346d19fcd38f7c2870e8a80010102af3885df6abae46badc2198995`
- Fixture content SHA-256: `24989f6b14b498678dd4db1afe113a8e87d4f610f9d92709cbc4483e9acf4b2c`
- Artifacts: `.ghost/pilot-02/evidence/pilot-02-report.json`, `docker-car-rental-validation.json`, `summary.json`

## Attribution

- Car rental sample: **CURSOR_PREPARED**
- Validation fixture / restricted runner: **GHOST_RESTRICTED_RUNNER**
- Autonomous code generation: **NOT_IMPLEMENTED**

## Quality gates

| Gate | Result |
| --- | --- |
| Focused tests | 53/53 PASS (2 env-inverted Docker-unavailable cases skipped) |
| Typecheck | PASS |
| Lint | PASS |
| Production build | PASS |

## Next required founder action

Approve authorization `b549744a-a3ad-4694-ba23-89bc040091ea` through the legitimate Founder Approval Center path (or explicitly reject/revoke). Do not insert a pre-approved row. Resume supervised execution only after real approval.

## Safety attestations

- PRODUCTION_CHANGED: NO  
- HOSTED_SQL_WRITES: 0  
- EXISTING_GHOST_DB_MODIFIED: NO  
- GENERAL_WORKERS_ACTIVATED: NO  
- LIVE_CODING_PROVIDER_USED: NO  
- MERGED: NO  
- DEPLOYED: NO  
