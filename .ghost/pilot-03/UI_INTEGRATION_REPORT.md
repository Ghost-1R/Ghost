# Pilot 03 — Remote Dev UI integration report

**Branch:** `cursor/pilot-03-real-ai-coding-prep`  
**Foundation commit:** `a5a7a9d` — Prepare Pilot 03 AI coding trial foundation with Ghost Allowance V1.  
**UI:** existing `/development-tasks` (no second interface)

## What the founder sees now

1. Ghost Allowance V1 panel (per owned project) — available / reserved / charged, or “not provisioned ($0)”
2. Request kind: Standard remote development **or** Pilot 03 AI code generation (prep)
3. Verified provider/model select: mock + LIVE_CODING_MODEL_ALLOWLIST only
4. Before authorization: available allowance, estimated cost, requested ceiling (≤ $1.00 for Pilot 03)
5. Live dispatch fixed to disabled; deployment never authorized
6. Task cards show founder status labels (PREPARED → … → COMPLETED) and evidence attribution separate from SIMULATED / durable non-codegen
7. Pilot 02 historical ACCEPT notice and durable review controls remain for task `1513be21…` (untouched in DB)

## What remains before first live $1 codegen test

1. Founder durable ACCEPT of Pilot 02 (optional sequencing; separate decision)
2. Founder authorize live trial: OpenAI `gpt-5-mini`, PUBLIC task, ≤ $1.00
3. Set project `project_ai_allowances.allowance_cents` ≥ 100 on disposable DB
4. Implement live HTTP adapter (currently returns LIVE_CODEGEN_NOT_IMPLEMENTED)
5. Explicitly set `GHOST_CODEGEN_LIVE_ENABLED=1` only in founder-approved disposable env
6. Provision server-side `OPENAI_API_KEY` (never reuse chat keys without scope confirmation)
7. Submit ONE Pilot 03 request → Approve → reserve → single dispatch → reconcile → founder review
8. Do **not** apply allowance/codegen migrations to hosted/production without separate approval

## Safety

- REAL_PROVIDER_CALLS from this UI work: 0  
- ACTUAL_PROVIDER_SPEND: $0  
- PRODUCTION_CHANGED: NO  
- HOSTED_SQL: 0  
- Pilot 02 rows: not modified by Pilot 03 UI prep  
