import type { CodingBudget, CodeGenerationRequest } from "./types";

export type BudgetDenial =
  | "BUDGET_COST"
  | "BUDGET_TOKENS"
  | "BUDGET_DURATION"
  | "BUDGET_STEPS"
  | "BUDGET_RETRIES";

export function assertBudgetAllows(request: CodeGenerationRequest): { ok: true } | { ok: false; reason: BudgetDenial; message: string } {
  const b = request.budget;
  if (b.maxCostUsd < 0 || b.maxCostUsd > 500) {
    return { ok: false, reason: "BUDGET_COST", message: "Cost budget out of allowed range." };
  }
  if (b.maxInputTokens < 1 || b.maxOutputTokens < 1 || b.maxInputTokens + b.maxOutputTokens > 200_000) {
    return { ok: false, reason: "BUDGET_TOKENS", message: "Token budget out of allowed range." };
  }
  if (b.maxDurationMs < 1_000 || b.maxDurationMs > 600_000) {
    return { ok: false, reason: "BUDGET_DURATION", message: "Duration budget out of allowed range." };
  }
  if (b.maxSteps < 1 || b.maxSteps > 32) {
    return { ok: false, reason: "BUDGET_STEPS", message: "Step budget out of allowed range." };
  }
  if (b.maxRetries < 0 || b.maxRetries > 5) {
    return { ok: false, reason: "BUDGET_RETRIES", message: "Retry budget out of allowed range." };
  }
  return { ok: true };
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function wouldExceedTokenBudget(
  budget: CodingBudget,
  inputTokens: number,
  outputTokens: number,
): boolean {
  return inputTokens > budget.maxInputTokens || outputTokens > budget.maxOutputTokens;
}

export function wouldExceedCost(budget: CodingBudget, estimatedCostUsd: number): boolean {
  return estimatedCostUsd > budget.maxCostUsd + 1e-9;
}
