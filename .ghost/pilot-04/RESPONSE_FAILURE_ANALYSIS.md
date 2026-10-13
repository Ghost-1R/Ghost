# Pilot 04 — Response Failure Analysis (Pilot 03 LIVE)

## Facts (preserved)

| Field | Value |
| --- | --- |
| Task | `8bdfde20-2f66-4518-9aea-6e632001fe7f` |
| Authorization | `5aee1635-62c3-4ab6-8237-060ee4bc1b16` CONSUMED uses=1 |
| Agent | `ad000507-5915-4b15-b851-3b4b728071f8` CANCELLED |
| Dispatch | Exactly one `LIVE_PROVIDER` → FAILED |
| HTTP | OpenAI Chat Completions returned HTTP 200 (~44s) |
| Visible content | Empty |
| Original `max_completion_tokens` | 4000 |
| Persisted finish_reason / reasoning tokens | Not persisted on original failure |
| External billing | Founder-confirmed **$0.01**; project available **99¢** |
| Live flag now | `GHOST_CODEGEN_LIVE_ENABLED=0` |

Original inspect evidence still shows the early label `MALFORMED_RESPONSE:OpenAI returned empty content.` Recovery later terminalized the task as `EMPTY_PROVIDER_CONTENT`. Do not rewrite Pilot 03 billing rows.

## Official API behavior (documented)

Sources:

- [Chat Completions create](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/)
- [GPT-5 mini model card](https://developers.openai.com/api/docs/models/gpt-5-mini)
- OpenAI community reports on GPT-5 empty content with `finish_reason=length`

Documented facts:

1. For reasoning models, `max_completion_tokens` is an upper bound on **visible output tokens + reasoning tokens**.
2. Response may include `choices[0].finish_reason` values including `stop`, `length`, `content_filter`.
3. Usage may include `usage.completion_tokens_details.reasoning_tokens`.
4. If the completion budget is exhausted during reasoning, the API can return HTTP 200 with **empty `message.content`** and `finish_reason=length`, while still billing reasoning/completion tokens.
5. `reasoning_effort` (`none` / `minimal` / `low` / `medium` / `high` / …) constrains reasoning spend; lower effort leaves more room for visible tokens.

## Hypotheses vs facts

| Claim | Status |
| --- | --- |
| Real OpenAI HTTP 200 with empty visible content | **Fact** (Pilot 03 evidence) |
| Request billed ~1¢ | **Fact** (founder OpenAI dashboard reconciliation) |
| Exact `finish_reason` on the original call was `length` | **Hypothesis** (not persisted; strongly consistent with docs + community + 4000-token cap) |
| Reasoning tokens exhausted the 4000 budget | **Hypothesis** (same; original usage breakdown not stored) |
| Ghost JSON parser bug caused empty content | **Unlikely** — empty string/null content precedes parse |
| Unsupported temperature/`max_tokens` caused empty content | **Unlikely** — adapter already omitted those for GPT-5 |

## Most likely root cause

**Primary (high confidence hypothesis):** `gpt-5-mini` spent the entire `max_completion_tokens=4000` budget on hidden reasoning, returned empty visible content with (likely) `finish_reason=length`, and still billed a small amount. Ghost then treated empty content as a generation failure; early path incorrectly released the reservation as unused until recovery/reconcile.

**Secondary contributors:**

- No persistence of `finish_reason` / `reasoning_tokens` on failure → hard to prove exhaustion after the fact.
- Empty content initially mapped toward malformed/parser language instead of provider/budget failure.
- No `reasoning_effort` set (model default can be higher than needed for a small HTML/CSS/JS JSON payload).

## Recommended fixes (implemented for Pilot 04)

1. Persist sanitized provider metadata on failure: `finish_reason`, prompt/completion/reasoning tokens, response id, HTTP status.
2. Classify empty visible content as `EMPTY_PROVIDER_CONTENT` (uncertain billing) — never free-release.
3. Classify incomplete JSON with `finish_reason=length` as `TRUNCATED_OUTPUT` (provider/budget), not `MALFORMED_RESPONSE` (parser).
4. Send `reasoning_effort: "low"` for `gpt-5*` Chat Completions.
5. Raise live completion budget to **12_000** shared tokens (model allowlist ceiling 16_000); timeout **90s**; `maxRetries: 0` after dispatch.
6. Keep hard spend ceiling ≤ $1; Pilot 04 auth uses remaining **99¢** without silent top-up.

## What remains unproven without a new live call

- Exact `finish_reason` and `reasoning_tokens` for the original Pilot 03 request.
- Whether 12k + `low` is sufficient for this objective (expected yes; verify only under new founder-approved LIVE).
