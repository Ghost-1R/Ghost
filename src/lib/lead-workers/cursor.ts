import type { LeadSearchCursor } from "./types";

export function normalizeCursor(
  raw: unknown,
  counts: { industries: number; markets: number; services: number },
): LeadSearchCursor {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const industryIdx = Math.max(0, Number(row.industryIdx) || 0) % Math.max(counts.industries, 1);
  const marketIdx = Math.max(0, Number(row.marketIdx) || 0) % Math.max(counts.markets, 1);
  const serviceIdx = Math.max(0, Number(row.serviceIdx) || 0) % Math.max(counts.services, 1);
  return { industryIdx, marketIdx, serviceIdx };
}

export function pickFromCursor<T>(items: readonly T[], index: number): T | null {
  if (!items.length) return null;
  return items[index % items.length] ?? null;
}

/** Advance service → market → industry (nested rotation). */
export function advanceCursor(
  cursor: LeadSearchCursor,
  counts: { industries: number; markets: number; services: number },
): LeadSearchCursor {
  const services = Math.max(counts.services, 1);
  const markets = Math.max(counts.markets, 1);
  const industries = Math.max(counts.industries, 1);
  let serviceIdx = cursor.serviceIdx + 1;
  let marketIdx = cursor.marketIdx;
  let industryIdx = cursor.industryIdx;
  if (serviceIdx >= services) {
    serviceIdx = 0;
    marketIdx += 1;
  }
  if (marketIdx >= markets) {
    marketIdx = 0;
    industryIdx += 1;
  }
  if (industryIdx >= industries) {
    industryIdx = 0;
  }
  return { industryIdx, marketIdx, serviceIdx };
}

export function asStringList(value: unknown, fallback: readonly string[]): string[] {
  if (Array.isArray(value)) {
    const rows = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length >= 2 && entry.length <= 120);
    if (rows.length) return rows;
  }
  return [...fallback];
}
