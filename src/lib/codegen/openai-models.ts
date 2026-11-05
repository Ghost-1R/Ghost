/**
 * OpenAI coding model allowlist, token limits, and published-rate cost estimates.
 * Rates are for accounting display — never invent charges without usage data.
 */

export type OpenAiCodingModelSpec = {
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  /** USD per 1M input tokens (published-rate style estimate). */
  inputPerMillionUsd: number;
  /** USD per 1M output tokens. */
  outputPerMillionUsd: number;
  /** Hard per-request ceiling for Pilot 03. */
  maxRequestCostUsd: number;
};

/** Only these OpenAI models may be used for live coding trials. */
export const OPENAI_CODING_MODEL_SPECS: ReadonlyArray<OpenAiCodingModelSpec> = [
  {
    model: "gpt-5-mini",
    maxInputTokens: 8_000,
    /** Shared reasoning + visible ceiling (Chat Completions max_completion_tokens). */
    maxOutputTokens: 16_000,
    inputPerMillionUsd: 0.25,
    outputPerMillionUsd: 2.0,
    maxRequestCostUsd: 1,
  },
  {
    model: "gpt-5-nano",
    maxInputTokens: 8_000,
    maxOutputTokens: 16_000,
    /** Official OpenAI pricing (text): $0.05 / 1M input, $0.40 / 1M output. */
    inputPerMillionUsd: 0.05,
    outputPerMillionUsd: 0.4,
    maxRequestCostUsd: 1,
  },
];

export const PILOT_03_MAX_TRIAL_CENTS = 100;
/** Pilot 04 uses remaining project allowance after Pilot 03's 1¢ charge unless founder top-up. */
export const PILOT_04_MAX_TRIAL_CENTS = 99;
export const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_DEFAULT_TIMEOUT_MS = 45_000;
/** Live coding needs headroom for reasoning + visible JSON (gpt-5-mini). */
export const OPENAI_LIVE_TIMEOUT_MS = 90_000;
export const OPENAI_MAX_RETRIES = 2;

/**
 * Bounded live token strategy for gpt-5-mini style reasoning models.
 * max_completion_tokens covers hidden reasoning + visible output.
 * reasoning_effort=low reduces empty-content failures from reasoning exhaustion.
 * Worst-case cost at published rates (~16k completion @ $2/1M + 4k input @ $0.25/1M) ≈ $0.033 ≪ $1.
 */
export const PILOT_LIVE_TOKEN_STRATEGY = {
  model: "gpt-5-mini" as const,
  reasoningEffort: "low" as const,
  maxInputTokens: 4_000,
  /** Shared reasoning + visible budget — raised after Pilot 03 empty-content failure at 4000. */
  maxCompletionTokens: 12_000,
  maxDurationMs: OPENAI_LIVE_TIMEOUT_MS,
  maxRetries: 0,
  maxOutputBytes: 200_000,
} as const;

/** Conservative worst-case cents for the live token strategy (ceiling, not a charge). */
export function estimatePilotLiveWorstCaseCents(model = PILOT_LIVE_TOKEN_STRATEGY.model): number {
  const est = estimateOpenAiCostUsd({
    model,
    inputTokens: PILOT_LIVE_TOKEN_STRATEGY.maxInputTokens,
    outputTokens: PILOT_LIVE_TOKEN_STRATEGY.maxCompletionTokens,
  });
  if (!est.ok) return PILOT_03_MAX_TRIAL_CENTS;
  return Math.min(PILOT_03_MAX_TRIAL_CENTS, est.cents);
}

export function getOpenAiCodingModelSpec(model: string): OpenAiCodingModelSpec | null {
  return OPENAI_CODING_MODEL_SPECS.find((row) => row.model === model) ?? null;
}

export function isOpenAiCodingModelAllowlisted(model: string): boolean {
  return getOpenAiCodingModelSpec(model) != null;
}

export function estimateOpenAiCostUsd(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): { ok: true; costUsd: number; cents: number } | { ok: false; reason: string; message: string } {
  const spec = getOpenAiCodingModelSpec(input.model);
  if (!spec) {
    return { ok: false, reason: "MODEL_NOT_ALLOWLISTED", message: `Model ${input.model} is not allowlisted.` };
  }
  const usd =
    (input.inputTokens / 1_000_000) * spec.inputPerMillionUsd +
    (input.outputTokens / 1_000_000) * spec.outputPerMillionUsd;
  const costUsd = Math.max(0, usd);
  const cents = Math.max(0, Math.ceil(costUsd * 100 - 1e-12));
  return { ok: true, costUsd, cents };
}
