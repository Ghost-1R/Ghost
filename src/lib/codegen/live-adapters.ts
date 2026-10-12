/**
 * Live coding provider adapters.
 * OpenAI: real Chat Completions HTTP implementation (disabled by default).
 * Gemini / OpenRouter: prepared stubs — still fail closed (HTTP not implemented).
 */
import { CODING_PROVIDER_PRIVACY } from "./privacy";
import { CODING_PROVIDER_CONFIGS, isCodegenLiveEnabled, isModelAllowlisted } from "./provider-config";
import {
  createOpenAiHttpCodingAdapter,
  type OpenAiHttpAdapterOptions,
} from "./openai-http";
import type { CodeGenerationRequest, CodeGenerationResult, CodingProvider, CodingProviderId } from "./types";

function disabledStubProvider(id: Exclude<CodingProviderId, "mock" | "openai">): CodingProvider {
  const config = CODING_PROVIDER_CONFIGS[id];
  return {
    id,
    privacy: CODING_PROVIDER_PRIVACY[id],
    async generate(request: CodeGenerationRequest): Promise<CodeGenerationResult> {
      const attribution = {
        mode: "DISABLED" as const,
        providerId: id,
        model: config.defaultModel,
        note: "Live coding adapter stub — HTTP not implemented. No API call made.",
      };
      if (!isCodegenLiveEnabled()) {
        return {
          ok: false,
          reason: "LIVE_DISABLED",
          message: `${config.label} live coding is disabled until founder authorization.`,
          attribution,
          checkpointId: null,
        };
      }
      if (!isModelAllowlisted(id, config.defaultModel)) {
        return {
          ok: false,
          reason: "MODEL_NOT_ALLOWLISTED",
          message: `Model ${config.defaultModel} is not on the live coding allowlist.`,
          attribution,
          checkpointId: null,
        };
      }
      void request;
      return {
        ok: false,
        reason: "LIVE_CODEGEN_NOT_IMPLEMENTED",
        message: `${config.label} HTTP adapter is prepared but not implemented. Zero provider calls.`,
        attribution,
        checkpointId: null,
      };
    },
  };
}

/** OpenAI Chat Completions adapter — live off unless GHOST_CODEGEN_LIVE_ENABLED=1. */
export function createOpenAiCodingAdapter(options?: OpenAiHttpAdapterOptions): CodingProvider {
  return createOpenAiHttpCodingAdapter(options);
}

export function createGeminiCodingAdapter(): CodingProvider {
  return disabledStubProvider("gemini");
}

export function createOpenRouterCodingAdapter(): CodingProvider {
  return disabledStubProvider("openrouter");
}

export function estimateTrialCostCents(input: {
  inputTokens: number;
  outputTokens: number;
  /** USD per 1M input tokens */
  inputPerMillionUsd: number;
  /** USD per 1M output tokens */
  outputPerMillionUsd: number;
}): number {
  const usd =
    (input.inputTokens / 1_000_000) * input.inputPerMillionUsd +
    (input.outputTokens / 1_000_000) * input.outputPerMillionUsd;
  return Math.max(1, Math.ceil(usd * 100));
}
