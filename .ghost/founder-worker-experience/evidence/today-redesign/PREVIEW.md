# Today + Worker cohesive redesign — local preview

**Branch:** `cursor/pilot-04-today-redesign` (from `1e37822`, uncommitted)  
**Preview:** http://127.0.0.1:3012/dashboard · Worker via project workspace  
**LIVE:** `GHOST_CODEGEN_LIVE_ENABLED=0`, `GHOST_NO_LIVE_PROVIDER_CALLS=1`  
**Render production:** untouched

## Layout

- **Today:** mockup-aligned day board — Arrange my day + Assign worker; Today's plan grouped Do first / Later / Waiting; worker preview + test result + decision cards; Ask Ghost below the plan.
- **Worker:** plain-language labels (`Continue test run`, `Saved after step N`, `Test run completed`); IDs/hashes under Technical details; charges shown as recorded (`$0` for MOCK).
- **Shared:** charcoal nav, warm light surfaces, turquoise primary; phone stacks; iPad collapsible sidebar (`≤1180px`).

## Arrange / Assign verification (LIVE=0)

| Check | Result |
|-------|--------|
| Save day plan | Persisted to `founder_day_plans` · notice “Today's plan saved · 3 items.” |
| Preview + start test review | Task `bb94ca8d-…` → SUCCEEDED · 4 steps · `$0` charged |
| Open saved result | Today result card, Worker results, Files “Test run completed” |

Evidence: `arrange-assign-verify.json`, `fresh-mock-task.json`

## Fresh MOCK verification (earlier)

| Field | Value |
|-------|--------|
| Task | `95714e70-c0d3-4a24-b1c9-fa8170ae5c12` (also `21659476-…` completed earlier) |
| Path | Today → Worker → MOCK steps (lease minted on first step) → Files |
| Result | Checkpoints saved; MOCK result artifact; SUCCEEDED |

## Worker mockup redesign (LIVE=0)

| Check | Result |
|-------|--------|
| Layout | Full content width · charcoal sidebar · warm ivory · two-column task/timeline+results · Ask Ghost · collapsed History |
| Color roles | Indigo task · sky timeline · emerald results · violet Ask Ghost · slate History · amber expired notice · red Cancel |
| Expired session | Amber “This test session expired” · View saved step · Continue/Pause hidden · Cancel only |
| Assign → Worker | Today preview/confirm redirects to `/projects/…/workspace?task=…&review=1` |
| Fresh review | Task `6d80ad00-…` SUCCEEDED · 4 checkpoints · saved results linked · `$0` |
| Screens | `worker-completed-desktop.png` · `worker-completed-ipad.png` · `worker-expired-desktop.png` · `worker-expired-ipad.png` |

## Settings + Today fix verification (LIVE=0)

| Check | Result |
|-------|--------|
| DB | `ghost99f` @ `127.0.0.1:54331` · `founder_preferences` applied |
| Theme persist | LIGHT → Dark → SYSTEM saved; cookie `ghost.appearance` matches; Today reloads with theme |
| Section preserve | Appearance save left `DIRECT` / `BALANCED` / `sound_enabled=t` |
| Settings tabs | Appearance = theme+motion · Personality = style+detail · Voice = sound controls |
| Assign rows | Full-width radios; project preview + plan_tasks preview scopes correct |
| Copy | “Accept the vehicle test result?” · “Saved after step 1” · charge once (`$0 charged`) |
| Technical details | Raw `task=` / `project=` / `mode=` / `sha256=` kept under details |
| iPad ≤1180 | Collapsible Menu; assign + preview usable |
| Select contrast | Dark/System: light text on charcoal select; Light tokens readable |

## Evidence

- Desktop / phone / iPad screenshots: `flow-*-*.png`
- iPad landscape recording (flow + checkpoint motion): `ipad-landscape-mock-flow.webm`
- Summaries: `flow-verify-summary.json`, `ipad-recording-summary.json`, `fresh-mock-task.json`, `arrange-assign-verify.json`, `settings-today-fix.json`
