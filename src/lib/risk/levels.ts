export const RISK_LEVELS = ["SAFE", "CAUTION", "HIGH", "CRITICAL"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Intended handling. Alpha does not enforce these levels yet.
 * Production data, authentication, row level security, payments,
 * destructive migrations, and bulk deletion should later be HIGH or CRITICAL.
 */
export const RISK_HANDLING: Record<RiskLevel, string> = {
  SAFE: "May execute automatically.",
  CAUTION: "Show the intended change before sensitive execution.",
  HIGH: "Require explicit approval and a dry run where possible.",
  CRITICAL: "Require explicit approval, a rollback or backup plan, and verification.",
};
