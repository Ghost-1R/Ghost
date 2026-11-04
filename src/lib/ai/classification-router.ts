/**
 * Provider eligibility by data classification.
 * Never auto-falls back to a weaker privacy tier.
 */

import { redactSecrets } from "@/lib/security/redact";
import type { DataClassification } from "@/lib/codegen/types";
import {
  assertNoWeakerPrivacyFallback,
  classificationRank,
  CODING_PROVIDER_PRIVACY,
  providerSatisfiesClassification,
} from "@/lib/codegen/privacy";
import type { CodingProviderId } from "@/lib/codegen/types";
import { assertProviderQuotaAvailable } from "./provider-quotas";
import { resolveModelProvider, type ProviderSelection } from "./provider";

export type ClassificationRoute =
  | {
      ok: true;
      classification: DataClassification;
      providerId: string;
      model: string | null;
      paid: boolean;
      usageAttribution: "ACTUAL" | "ESTIMATE" | "NONE";
      detail: string;
    }
  | {
      ok: false;
      reason:
        | "PRIVACY_MISMATCH"
        | "NOT_CONFIGURED"
        | "WEAKER_FALLBACK_FORBIDDEN"
        | "QUOTA_EXCEEDED";
      classification: DataClassification;
      message: string;
    };

const CHAT_PROVIDER_PRIVACY: Record<string, { maxClassification: DataClassification; privacyRank: number }> = {
  groq: { maxClassification: "INTERNAL", privacyRank: 4 },
  openai: { maxClassification: "CONFIDENTIAL", privacyRank: 6 },
  anthropic: { maxClassification: "CONFIDENTIAL", privacyRank: 7 },
  xai: { maxClassification: "INTERNAL", privacyRank: 4 },
  mock: { maxClassification: "INTERNAL", privacyRank: 10 },
};

export function routeProviderForClassification(input: {
  classification: DataClassification;
  selection?: ProviderSelection;
  env?: Record<string, string | undefined>;
}): ClassificationRoute {
  const selection = input.selection ?? resolveModelProvider(input.env);
  if (selection.status !== "READY" || !selection.provider) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      classification: input.classification,
      message: redactSecrets(selection.detail || "Model provider is not configured. Setup required."),
    };
  }

  const tier =
    CHAT_PROVIDER_PRIVACY[selection.providerId] ??
    CODING_PROVIDER_PRIVACY[selection.providerId as CodingProviderId] ??
    null;
  if (!tier) {
    return {
      ok: false,
      reason: "PRIVACY_MISMATCH",
      classification: input.classification,
      message: `Provider ${selection.providerId} has no classification entitlement.`,
    };
  }

  const privacy = assertNoWeakerPrivacyFallback({
    required: input.classification,
    selected: tier,
  });
  if (!privacy.ok) {
    return {
      ok: false,
      reason: privacy.reason,
      classification: input.classification,
      message: privacy.message,
    };
  }

  const quota = assertProviderQuotaAvailable({ providerId: selection.providerId });
  if (!quota.ok) {
    return {
      ok: false,
      reason: "QUOTA_EXCEEDED",
      classification: input.classification,
      message: quota.message,
    };
  }

  return {
    ok: true,
    classification: input.classification,
    providerId: selection.providerId,
    model: selection.model,
    paid: selection.paid,
    usageAttribution: "ACTUAL",
    detail: `${selection.providerId} may handle ${input.classification} (max ${tier.maxClassification}).`,
  };
}

export function providerEligibleForClassification(
  providerId: string,
  classification: DataClassification,
): boolean {
  const tier = CHAT_PROVIDER_PRIVACY[providerId] ?? CODING_PROVIDER_PRIVACY[providerId as CodingProviderId];
  if (!tier) return false;
  return providerSatisfiesClassification(tier, classification);
}

export { classificationRank };
