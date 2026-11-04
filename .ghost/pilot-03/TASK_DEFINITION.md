# Pilot 03 — First real codegen task definition

## Objective (exact)

Generate an original responsive vehicle comparison component with three fictional rental cars, price comparison, vehicle features, and accessible interactive selection.

## Constraints

- **NEW** source — not the Cursor-prepared car rental landing page
- Stack: HTML / CSS / JavaScript (minimal)
- Fictional example data only
- Accessible interactive selection (keyboard + ARIA)
- No payment processing, no customer PII, no deployment, no external network from generated code

## Allowed output files

1. `generated/pilot-03-vehicle-comparison/index.html`
2. `generated/pilot-03-vehicle-comparison/styles.css`
3. `generated/pilot-03-vehicle-comparison/app.js`
4. `generated/pilot-03-vehicle-comparison/test.mjs`
5. `generated/pilot-03-vehicle-comparison/README.md`

## Future live trial parameters (proposed — not authorized)

| Field | Value |
| --- | --- |
| Classification | PUBLIC |
| Provider | OpenAI direct |
| Model | `gpt-5-mini` |
| Max spend | **$1.00 USD** (100 cents reserved) |
| Tasks | One |
| Production access | None |
| Auto top-up | Forbidden |

## Acceptance checklist

- [ ] Three fictional vehicles rendered
- [ ] Price comparison visible
- [ ] Features listed
- [ ] Interactive selection works with keyboard
- [ ] Responsive layout
- [ ] Tests pass in isolated workspace / restricted Docker
- [ ] Evidence package present with MOCK or LIVE attribution (never confuse)
- [ ] Allowance reservation reconciled or released
- [ ] Founder review status remains open until founder acts
