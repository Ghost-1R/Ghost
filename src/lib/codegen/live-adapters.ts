/**
 * Live coding provider adapter contracts — prepared, not invoked.
 * Any generate() call fails closed. No network. No key reads into logs.
 */
import { CODING_PROVIDER_PRIVACY } from "./privacy";
import { CODING_PROVIDER_CONFIGS, isCodegenLiveEnabled, isModelAllowlisted } from "./provider-config";
import type { CodeGenerationRequest, CodeGenerationResult, CodingProvider, CodingProviderId } from "./types";

function disabledLiveProvider(id: Exclude<CodingProviderId, "mock">): CodingProvider {
  const config = CODING_PROVIDER_CONFIGS[id];
  return {
    id,
    privacy: CODING_PROVIDER_PRIVACY[id],
    async generate(request: CodeGenerationRequest): Promise<CodeGenerationResult> {
      const attribution = {
        mode: "DISABLED" as const,
        providerId: id,
        model: config.defaultModel,
        note: "Live coding adapter present but execution disabled. No API call made.",
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
      // Even with flags, Pilot 03 refuses HTTP — adapter is preparation only.
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

export function createOpenAiCodingAdapter(): CodingProvider {
  return disabledLiveProvider("openai");
}

export function createGeminiCodingAdapter(): CodingProvider {
  return disabledLiveProvider("gemini");
}

export function createOpenRouterCodingAdapter(): CodingProvider {
  return disabledLiveProvider("openrouter");
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
