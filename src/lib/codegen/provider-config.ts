import { CODING_PROVIDER_PRIVACY } from "./privacy";
import type { CodingProviderId, DataClassification } from "./types";

export type CodingProviderConfig = {
  id: CodingProviderId;
  label: string;
  /** Server-side env var name only — never logged with value. */
  keyEnvName: string | null;
  paid: boolean;
  enabled: boolean;
  /** Live HTTP disabled unless founder separately enables codegen live flag. */
  liveInvocationAllowed: boolean;
  maxClassification: DataClassification;
  privacyRank: number;
  defaultModel: string;
  supportsCancellation: boolean;
  supportsUsageAccounting: boolean;
};

/**
 * Explicit provider configuration for coding work.
 * Keys remain server-side (Render secrets in production). Never embed keys here.
 */
export const CODING_PROVIDER_CONFIGS: Record<CodingProviderId, CodingProviderConfig> = {
  mock: {
    id: "mock",
    label: "Deterministic Mock Coding Provider",
    keyEnvName: null,
    paid: false,
    enabled: true,
    liveInvocationAllowed: false,
    maxClassification: CODING_PROVIDER_PRIVACY.mock.maxClassification,
    privacyRank: CODING_PROVIDER_PRIVACY.mock.privacyRank,
    defaultModel: "mock-codegen-v1",
    supportsCancellation: true,
    supportsUsageAccounting: true,
  },
  groq: {
    id: "groq",
    label: "Groq",
    keyEnvName: "GROQ_API_KEY",
    paid: false,
    enabled: true,
    liveInvocationAllowed: false,
    maxClassification: CODING_PROVIDER_PRIVACY.groq.maxClassification,
    privacyRank: CODING_PROVIDER_PRIVACY.groq.privacyRank,
    defaultModel: "openai/gpt-oss-120b",
    supportsCancellation: true,
    supportsUsageAccounting: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    keyEnvName: "OPENAI_API_KEY",
    paid: true,
    enabled: true,
    liveInvocationAllowed: false,
    maxClassification: CODING_PROVIDER_PRIVACY.openai.maxClassification,
    privacyRank: CODING_PROVIDER_PRIVACY.openai.privacyRank,
    defaultModel: "gpt-4.1-mini",
    supportsCancellation: true,
    supportsUsageAccounting: true,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    keyEnvName: "ANTHROPIC_API_KEY",
    paid: true,
    enabled: true,
    liveInvocationAllowed: false,
    maxClassification: CODING_PROVIDER_PRIVACY.anthropic.maxClassification,
    privacyRank: CODING_PROVIDER_PRIVACY.anthropic.privacyRank,
    defaultModel: "claude-sonnet-4-5",
    supportsCancellation: true,
    supportsUsageAccounting: true,
  },
};

export const CODEGEN_LIVE_FLAG = "GHOST_CODEGEN_LIVE_ENABLED";

export function isCodegenLiveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[CODEGEN_LIVE_FLAG]?.trim() === "1";
}

export function resolveCodingProviderConfig(
  id: CodingProviderId,
): { ok: true; config: CodingProviderConfig } | { ok: false; reason: string; message: string } {
  const config = CODING_PROVIDER_CONFIGS[id];
  if (!config || !config.enabled) {
    return { ok: false, reason: "PROVIDER_DISABLED", message: `Coding provider ${id} is not enabled.` };
  }
  if (id !== "mock" && isCodegenLiveEnabled()) {
    // Even with flag, this foundation refuses live until a dedicated live adapter ships.
    return {
      ok: false,
      reason: "LIVE_CODEGEN_NOT_IMPLEMENTED",
      message: "Live coding-provider invocation is not implemented in this foundation. Use mock only.",
    };
  }
  if (id !== "mock" && !isCodegenLiveEnabled()) {
    return {
      ok: false,
      reason: "LIVE_DISABLED",
      message: "Live coding providers remain disabled. Founder must authorize a separate live trial.",
    };
  }
  return { ok: true, config };
}
