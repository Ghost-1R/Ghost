import type { CodingProviderId, CodingProviderPrivacyTier, DataClassification } from "./types";

const RANK: Record<DataClassification, number> = {
  PUBLIC: 1,
  INTERNAL: 2,
  CONFIDENTIAL: 3,
  RESTRICTED: 4,
};

/** Provider privacy tiers — never auto-fallback to a weaker rank. */
export const CODING_PROVIDER_PRIVACY: Record<CodingProviderId, CodingProviderPrivacyTier> = {
  mock: { maxClassification: "INTERNAL", privacyRank: 10 },
  groq: { maxClassification: "INTERNAL", privacyRank: 4 },
  openai: { maxClassification: "CONFIDENTIAL", privacyRank: 6 },
  anthropic: { maxClassification: "CONFIDENTIAL", privacyRank: 7 },
  /** Direct Gemini paid API; Free Tier product-improvement terms → treat as weaker for INTERNAL+. */
  gemini: { maxClassification: "INTERNAL", privacyRank: 5 },
  /** Gateway — privacy depends on upstream; never auto-upgrade classification entitlement. */
  openrouter: { maxClassification: "PUBLIC", privacyRank: 3 },
};

export function classificationRank(c: DataClassification): number {
  return RANK[c];
}

export function providerSatisfiesClassification(
  provider: CodingProviderPrivacyTier,
  required: DataClassification,
): boolean {
  return classificationRank(provider.maxClassification) >= classificationRank(required);
}

/**
 * Refuse weaker privacy fallback. Caller must pick an explicit provider that meets policy.
 */
export function assertNoWeakerPrivacyFallback(input: {
  required: DataClassification;
  selected: CodingProviderPrivacyTier;
  candidatesTried?: CodingProviderPrivacyTier[];
}): { ok: true } | { ok: false; reason: "PRIVACY_MISMATCH" | "WEAKER_FALLBACK_FORBIDDEN"; message: string } {
  if (!providerSatisfiesClassification(input.selected, input.required)) {
    return {
      ok: false,
      reason: "PRIVACY_MISMATCH",
      message: `Selected provider max classification ${input.selected.maxClassification} cannot satisfy ${input.required}.`,
    };
  }
  for (const candidate of input.candidatesTried ?? []) {
    if (candidate.privacyRank < input.selected.privacyRank) {
      return {
        ok: false,
        reason: "WEAKER_FALLBACK_FORBIDDEN",
        message: "Automatic fallback to a weaker-privacy provider is forbidden.",
      };
    }
  }
  return { ok: true };
}

export function classifyObjectiveText(objective: string): DataClassification {
  const text = objective.toLowerCase();
  if (/\b(ssn|passport|production secret|private key|credential dump)\b/.test(text)) {
    return "RESTRICTED";
  }
  if (/\b(customer pii|payroll|medical|confidential)\b/.test(text)) {
    return "CONFIDENTIAL";
  }
  if (/\b(internal|founder|ghost)\b/.test(text)) {
    return "INTERNAL";
  }
  return "PUBLIC";
}
