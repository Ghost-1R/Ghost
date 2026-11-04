/**
 * Separate per-provider usage and quota tracking.
 * Secrets stay out of this module. Fail closed when a quota would be exceeded.
 */

export type ProviderUsageRecord = {
  providerId: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  at: string;
  detail: string;
};

export type ProviderQuota = {
  providerId: string;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  requestsUsed: number;
  tokensUsed: number;
};

const DEFAULT_QUOTAS: Record<string, Omit<ProviderQuota, "providerId" | "requestsUsed" | "tokensUsed">> = {
  groq: { dailyRequestLimit: 1000, dailyTokenLimit: 200_000 },
  openai: { dailyRequestLimit: 200, dailyTokenLimit: 100_000 },
  anthropic: { dailyRequestLimit: 200, dailyTokenLimit: 100_000 },
  mock: { dailyRequestLimit: 10_000, dailyTokenLimit: 10_000_000 },
};

/** Process-local ledger for deterministic tests and fail-closed gates. Not a browser store. */
const usageLog: ProviderUsageRecord[] = [];

export function resetProviderUsageForTests(): void {
  usageLog.length = 0;
}

export function recordProviderUsage(input: Omit<ProviderUsageRecord, "at"> & { at?: string }): ProviderUsageRecord {
  const row: ProviderUsageRecord = {
    ...input,
    at: input.at ?? new Date().toISOString(),
  };
  usageLog.push(row);
  return row;
}

export function listProviderUsage(providerId?: string): ProviderUsageRecord[] {
  return providerId ? usageLog.filter((row) => row.providerId === providerId) : [...usageLog];
}

export function getProviderQuota(providerId: string): ProviderQuota {
  const base = DEFAULT_QUOTAS[providerId] ?? { dailyRequestLimit: 50, dailyTokenLimit: 20_000 };
  const rows = listProviderUsage(providerId);
  const tokensUsed = rows.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
  return {
    providerId,
    dailyRequestLimit: base.dailyRequestLimit,
    dailyTokenLimit: base.dailyTokenLimit,
    requestsUsed: rows.length,
    tokensUsed,
  };
}

export function assertProviderQuotaAvailable(input: {
  providerId: string;
  additionalTokens?: number;
}): { ok: true; quota: ProviderQuota } | { ok: false; reason: "QUOTA_EXCEEDED"; message: string; quota: ProviderQuota } {
  const quota = getProviderQuota(input.providerId);
  const nextRequests = quota.requestsUsed + 1;
  const nextTokens = quota.tokensUsed + Math.max(0, input.additionalTokens ?? 0);
  if (nextRequests > quota.dailyRequestLimit || nextTokens > quota.dailyTokenLimit) {
    return {
      ok: false,
      reason: "QUOTA_EXCEEDED",
      message: `Provider ${input.providerId} quota would be exceeded. Fail closed — no weaker fallback.`,
      quota,
    };
  }
  return { ok: true, quota };
}
