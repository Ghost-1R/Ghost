import type { RiskLevel } from "@/lib/inspector/types";

const RANK: Record<RiskLevel, number> = { SAFE: 0, CAUTION: 1, HIGH: 2, CRITICAL: 3 };

const KNOWN_OPERATIONS = new Set([
  "copy",
  "styling",
  "docs",
  "isolated-ui",
  "refactor",
  "query",
  "auth-adjacent",
  "dependency",
  "migration",
  "bulk-data",
  "payment",
  "permission",
  "rls",
  "production-config",
  "secret",
]);

export function classifyPathRisk(paths: string[]): RiskLevel {
  const normalized = paths.map((filePath) => filePath.replaceAll("\\", "/").toLocaleLowerCase());
  if (normalized.some((filePath) => filePath.startsWith("supabase/migrations/") || filePath.includes("/migrations/"))) {
    return "HIGH";
  }
  if (normalized.some((filePath) => /payment|stripe/.test(filePath))) {
    return "HIGH";
  }
  if (normalized.some((filePath) => /rls|policy/.test(filePath))) {
    return "HIGH";
  }
  if (normalized.some((filePath) => /production|vercel\.json|\.env/.test(filePath))) {
    return "HIGH";
  }
  if (normalized.some((filePath) => /auth|permission/.test(filePath))) {
    return "CAUTION";
  }
  return "SAFE";
}

export function classifyOperationRisk(operation: string, paths: string[] = []): RiskLevel {
  const pathRisk = classifyPathRisk(paths);
  if (!KNOWN_OPERATIONS.has(operation)) {
    return higherRisk(pathRisk, "HIGH");
  }
  if (operation === "copy" || operation === "styling" || operation === "docs" || operation === "isolated-ui") {
    return pathRisk;
  }
  if (operation === "refactor" || operation === "query" || operation === "auth-adjacent" || operation === "dependency") {
    return higherRisk(pathRisk, "CAUTION");
  }
  return higherRisk(pathRisk, "HIGH");
}

export function raiseRisk(determined: RiskLevel, requested: RiskLevel | null): RiskLevel {
  if (!requested) {
    return determined;
  }
  return RANK[requested] > RANK[determined] ? requested : determined;
}

function higherRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return RANK[left] >= RANK[right] ? left : right;
}
