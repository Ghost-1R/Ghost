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
    maxOutputTokens: 8_000,
    inputPerMillionUsd: 0.25,
    outputPerMillionUsd: 2.0,
    maxRequestCostUsd: 1,
  },
  {
    model: "gpt-5-nano",
    maxInputTokens: 8_000,
    maxOutputTokens: 8_000,
    inputPerMillionUsd: 0.1,
    outputPerMillionUsd: 0.4,
    maxRequestCostUsd: 1,
  },
];

export const PILOT_03_MAX_TRIAL_CENTS = 100;
export const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_DEFAULT_TIMEOUT_MS = 45_000;
export const OPENAI_MAX_RETRIES = 2;

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
