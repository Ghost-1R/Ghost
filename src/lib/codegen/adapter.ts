import { createMockCodingProvider } from "./mock-provider";
import { assertNoWeakerPrivacyFallback } from "./privacy";
import { isCodegenLiveEnabled, resolveCodingProviderConfig } from "./provider-config";
import type { CodingProvider, CodingProviderId, DataClassification } from "./types";

export type ResolveCodingProviderResult =
  | { ok: true; provider: CodingProvider; live: false }
  | { ok: false; reason: string; message: string };

/**
 * Smallest coding-provider adapter.
 * Live invocation remains disabled; only the deterministic mock is available.
 */
export function resolveCodingProvider(input: {
  providerId: CodingProviderId;
  requiredClassification: DataClassification;
}): ResolveCodingProviderResult {
  const config = resolveCodingProviderConfig(input.providerId);
  if (!config.ok) return config;

  const privacyCheck = assertNoWeakerPrivacyFallback({
    required: input.requiredClassification,
    selected: {
      maxClassification: config.config.maxClassification,
      privacyRank: config.config.privacyRank,
    },
  });
  if (!privacyCheck.ok) {
    return { ok: false, reason: privacyCheck.reason, message: privacyCheck.message };
  }

  if (input.providerId === "mock") {
    return { ok: true, provider: createMockCodingProvider(), live: false };
  }

  // Fail closed — no silent fallback to mock when a live id was requested.
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
    "Live coding providers stay disabled until separate founder authorization.",
    "Mock generation is labeled MOCK_GENERATION and is not real AI coding.",
  ].join(" ");
}
