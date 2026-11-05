import {
  createGeminiCodingAdapter,
  createOpenAiCodingAdapter,
  createOpenRouterCodingAdapter,
} from "./live-adapters";
import { createMockCodingProvider } from "./mock-provider";
import { assertNoWeakerPrivacyFallback, CODING_PROVIDER_PRIVACY } from "./privacy";
import { CODING_PROVIDER_CONFIGS, isCodegenLiveEnabled, resolveCodingProviderConfig } from "./provider-config";
import type { CodingProvider, CodingProviderId, DataClassification } from "./types";

export type ResolveCodingProviderResult =
  | { ok: true; provider: CodingProvider; live: false }
  | { ok: false; reason: string; message: string };

/**
 * Coding-provider adapter resolution.
 * Live OpenAI HTTP exists but stays off unless GHOST_CODEGEN_LIVE_ENABLED=1.
 * Never auto-fallback from a requested live id to mock.
 */
export function resolveCodingProvider(input: {
  providerId: CodingProviderId;
  requiredClassification: DataClassification;
  /** Return prepared live/stub adapter for contract probes (still respects live flag at generate()). */
  returnDisabledLiveAdapter?: boolean;
}): ResolveCodingProviderResult {
  const privacy = CODING_PROVIDER_PRIVACY[input.providerId];
  const privacyCheck = assertNoWeakerPrivacyFallback({
    required: input.requiredClassification,
    selected: privacy,
  });
  if (!privacyCheck.ok) {
    return { ok: false, reason: privacyCheck.reason, message: privacyCheck.message };
  }

  if (input.providerId === "mock") {
    const config = resolveCodingProviderConfig("mock");
    if (!config.ok) return config;
    return { ok: true, provider: createMockCodingProvider(), live: false };
  }

  if (input.returnDisabledLiveAdapter || isCodegenLiveEnabled()) {
    if (!CODING_PROVIDER_CONFIGS[input.providerId]?.enabled) {
      return { ok: false, reason: "PROVIDER_DISABLED", message: `Provider ${input.providerId} disabled.` };
    }
    if (input.providerId === "openai") {
      const config = resolveCodingProviderConfig("openai");
      if (!config.ok && !input.returnDisabledLiveAdapter) return config;
      return { ok: true, provider: createOpenAiCodingAdapter(), live: false };
    }
    const provider =
      input.providerId === "gemini"
        ? createGeminiCodingAdapter()
        : input.providerId === "openrouter"
          ? createOpenRouterCodingAdapter()
          : null;
    if (!provider) {
      return {
        ok: false,
        reason: "ADAPTER_UNAVAILABLE",
        message: `No prepared live adapter for ${input.providerId}.`,
      };
    }
    return { ok: true, provider, live: false };
  }

  const config = resolveCodingProviderConfig(input.providerId);
  if (!config.ok) return config;

  return {
    ok: false,
    reason: "LIVE_DISABLED",
    message: `Provider ${input.providerId} cannot run: live codegen disabled (flag=${isCodegenLiveEnabled()}). No weaker fallback applied.`,
  };
}

export function describeCodegenAdapterPolicy(): string {
  return [
    "Coding provider keys stay server-side only.",
    "Data must be classified before routing.",
    "No automatic fallback to weaker privacy.",
    "Live coding stays disabled until GHOST_CODEGEN_LIVE_ENABLED=1 and founder authorization.",
    "Mock generation is labeled MOCK_GENERATION and is not real AI coding.",
    "OpenAI Chat Completions HTTP adapter is implemented; Gemini/OpenRouter remain stubs.",
    "Generated code always requires founder review before acceptance. Development never grants deployment.",
  ].join(" ");
}
