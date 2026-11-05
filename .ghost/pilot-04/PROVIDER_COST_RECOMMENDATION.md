# Pilot 04 — Provider / Model Cost Recommendation

**No provider calls authorized tonight.** Recommendation only.

## Sources

- [OpenAI Pricing](https://developers.openai.com/api/docs/pricing.md) (gpt-5-mini / gpt-5-nano)
- [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini)
- [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano)
- Chat Completions: `max_completion_tokens` includes reasoning + visible output; `reasoning_effort` supported

## Comparison (coding trial scope)

| Option | Input / 1M | Output / 1M | Context | Reasoning | Structured JSON | Ghost allowlist today | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **OpenAI gpt-5-mini** | $0.25 | $2.00 | 400k | Yes | Chat Completions `json_object` | Yes | Used in Pilot 03; empty-content risk if completion budget too low |
| **OpenAI gpt-5-nano** | $0.05 | $0.40 | 400k | Yes | Supported | Yes (allowlisted, not wired as Pilot live default) | Cheaper; community reports similar empty-content when budget too small; official card positions it for summarization/classification more than coding |
| OpenRouter gateway | Varies | Varies | Varies | Varies | Depends on upstream | Not implemented | Future gateway only — do not wire tonight |
| Gemini alternatives | — | — | — | — | — | Not implemented | Useful later; out of scope for Pilot 04 |

## Worst-case estimate (Pilot live token strategy)

Configured strategy (`PILOT_LIVE_TOKEN_STRATEGY`):

- model: `gpt-5-mini`
- `reasoning_effort`: `low`
- max input: 4_000
- max completion (shared): 12_000
- timeout: 90s
- retries after dispatch: 0

Published-rate ceiling:

- input: 4000 × $0.25/1M ≈ $0.001
- output/completion: 12000 × $2.00/1M ≈ $0.024
- **worst-case ≈ $0.025 → 3¢** (matches setup script `WORST_CASE_ESTIMATE_CENTS: 3`)

Well under remaining project available **99¢**. No need to raise project allowance for this budget.

If founder insists on a full **$1.00** authorization ceiling for symmetry with Pilot 03, that requires a **+1¢ allowance top-up decision** (available is 99¢). Live scope now accepts max spend in `$0.01`–`$1.00`; Pilot 04 PENDING is authorized at **$0.99**.

## Recommendation

**Stay on OpenAI `gpt-5-mini` with `reasoning_effort=low` and `max_completion_tokens=12000` for the next founder-approved LIVE trial.**

Rationale:

1. Continuity with Pilot 03 wiring, UI, and scope fingerprint (`provider=openai;model=gpt-5-mini`).
2. Cost for this task is cents, not dollars — nano’s savings are immaterial vs reliability risk of switching models overnight.
3. Empty-content failure mode is addressed by effort + shared completion budget + metadata capture, not by changing vendors.
4. `gpt-5-nano` remains a future cost-down candidate after one successful mini trial with persisted `finish_reason` / reasoning usage.

Do **not** implement OpenRouter or Gemini tonight.
