# Pilot 03 — AI Provider Comparison

**Research date:** 2026-10-11 (America/New_York)  
**Scope:** Prepare first real AI coding trial. **No live calls. No spend.**

## Important separation

| Role | Examples | Notes |
| --- | --- | --- |
| **Model provider (direct)** | OpenAI, Google Gemini, Anthropic | Own billing, privacy, rate limits |
| **Routing / gateway** | OpenRouter | Aggregates many models; **extra platform fee**; privacy/retention may differ from the underlying model vendor |

OpenRouter does **not** automatically give the same privacy guarantees as calling OpenAI/Gemini/Anthropic directly.

## Sources (verified)

| Source | URL | Retrieved |
| --- | --- | --- |
| OpenRouter pricing / plans | https://openrouter.ai/pricing | 2026-10-11 |
| OpenRouter coding collection | https://openrouter.ai/collections/programming | 2026-10-11 |
| Google Gemini API pricing | https://ai.google.dev/gemini-api/docs/pricing | 2026-10-11 |
| Google Gemini models | https://ai.google.dev/gemini-api/docs/models | 2026-10-11 |
| OpenAI API pricing | https://developers.openai.com/api/docs/pricing | 2026-10-11 |
| OpenAI GPT-5 mini | https://developers.openai.com/api/docs/models/gpt-5-mini | 2026-10-11 |
| OpenAI GPT-4.1 mini | https://developers.openai.com/api/docs/models/gpt-4.1-mini | 2026-10-11 |

Prices below are **as published on those pages on the research date**. They can change.

## Snapshot pricing (USD per 1M tokens unless noted)

### OpenAI (direct)

| Model | Input | Cached input | Output |
| --- | --- | --- | --- |
| `gpt-5-mini` | $0.25 | $0.025 | $2.00 |
| `gpt-4.1-mini` | $0.40 | $0.10 | $1.60 |
| `gpt-5-nano` | $0.05 | $0.005 | $0.40 |

### Google Gemini (direct)

| Model | Free tier | Paid input | Paid output |
| --- | --- | --- | --- |
| `gemini-3.5-flash-lite` | Free of charge (with product-improvement terms) | $0.30 | $2.50 |
| `gemini-2.5-flash` | Free of charge (legacy; **access limited** to prior users; new projects steered to 3.x) | $0.30 (text/image/video) | $2.50 |

**Privacy note:** Gemini Free Tier docs state content may be **used to improve Google products**; Paid Tier typically is not. For Ghost founder data, prefer Paid + INTERNAL/CONFIDENTIAL policy or avoid Free Tier for anything beyond PUBLIC demos.

### OpenRouter (gateway)

| Aspect | Verified detail |
| --- | --- |
| Free plan | 25+ free models; **50 requests/day**; community support; **no** budgets/spend controls on Free |
| Pay-as-you-go | **5.5%** platform fee on credit purchases (Standard) |
| Coding usage leaders (OpenRouter collection, Oct 2026) | DeepSeek V4.1 Flash ~$0.0348 / $0.1392 per M in/out; GLM 5.3 Flash ~$0.04 / $0.50; MiMo-V2.6-Flash ~$0.10 / $0.28 |
| Hard caps | `provider.max_price` / `:floor` routing documented by OpenRouter |

Gateway prices fluctuate by upstream provider; always re-check the model card before a live trial.

## Evaluation matrix (coding trial readiness)

| Criterion | OpenAI direct | Gemini direct | OpenRouter |
| --- | --- | --- | --- |
| Coding quality (typical UI/component tasks) | Strong (`gpt-5-mini` / `gpt-4.1-mini`) | Strong Flash family; structured outputs & tools supported | Varies by routed model |
| Cost for ~$1 trial | Predictable direct rates | Free tier available but privacy tradeoff; paid rates similar to Flash | Often cheapest open-weight routes + fee |
| Budget controls | OpenAI org/project limits | Google Cloud / AI Studio billing limits | Paid plans add budgets; Free plan lacks spend controls |
| Privacy | OpenAI API data policies (no training on API by default per OpenAI API terms — re-verify at trial) | Free vs Paid differ (see above) | Depends on OpenRouter + underlying provider policies |
| Structured outputs / tools | Yes | Yes | Model-dependent |
| Ghost fit | Already wired as chat provider id | Needs new adapter id | Needs new adapter id + allowlist |

## Recommendations (for later founder authorization — not spend permission)

| Role | Choice | Rationale |
| --- | --- | --- |
| **Cheapest suitable coding (paid, predictable)** | OpenAI `gpt-5-nano` or OpenRouter open-weight flash via allowlisted slug | Lowest published token rates among serious coding options; OpenRouter free tier is testing-only (50 RPD, no spend controls) |
| **Default cheap coding (reliability bias)** | OpenAI `gpt-5-mini` | Better coding reliability than nano; still low cost for a ≤$1 PUBLIC component trial |
| **Stronger complex coding** | OpenAI `gpt-4.1` / Anthropic Sonnet-class (already in Ghost chat allowlist patterns) or latest Gemini Pro-class | Use only when cheap model fails review |
| **Backup provider** | Google Gemini Paid (`gemini-3.5-flash-lite` or current Flash) | Independent vendor; avoid Free Tier for non-PUBLIC data |
| **Testing-only free option** | Gemini Free Tier **or** OpenRouter Free (50 RPD) | **PUBLIC demos only**; label privacy risk; never for CONFIDENTIAL/RESTRICTED |

### Proposed first live trial (≤ $1 USD ceiling — **not authorized yet**)

1. Provider: **OpenAI direct**  
2. Model: **`gpt-5-mini`**  
3. Classification: **PUBLIC**  
4. Max spend: **$1.00** (Ghost Allowance reservation)  
5. Gateway: **not required** for v1 (reduces fee + privacy ambiguity)

OpenRouter remains a strong **cost optimization path** after Ghost Allowance + allowlists are proven.

## Credential names only (never values)

- `OPENAI_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY` / `GEMINI_API_KEY` (choose one server-side name at wiring time)
- `OPENROUTER_API_KEY`
- Existing chat keys (`GROQ_API_KEY`, `ANTHROPIC_API_KEY`) must **not** be reused for coding without separate founder scope approval
