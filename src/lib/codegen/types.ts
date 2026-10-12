/**
 * Code-generation foundation types (local / mock-first).
 * Live provider invocation stays disabled until separate founder authorization.
 */

export type DataClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

export type CodingProviderId = "mock" | "groq" | "openai" | "anthropic" | "gemini" | "openrouter";

export type CodingProviderPrivacyTier = {
  /** Highest classification this provider may receive. */
  maxClassification: DataClassification;
  /** Relative privacy strength; higher is stricter (never auto-fallback downward). */
  privacyRank: number;
};

export type CodingBudget = {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostUsd: number;
  maxDurationMs: number;
  maxSteps: number;
  maxRetries: number;
  maxOutputBytes: number;
};

export type FileChangeOp = "CREATE" | "UPDATE" | "DELETE";

export type FileChangeProposal = {
  relativePath: string;
  op: FileChangeOp;
  content: string | null;
  languageHint?: string;
};

export type CodeGenerationRequest = {
  objective: string;
  ownerId: string;
  projectId: string;
  authorizationId: string;
  environmentLabel: string;
  classification: DataClassification;
  allowedRelativeRoots: string[];
  budget: CodingBudget;
  idempotencyKey: string;
  at?: string;
};

export type CodeGenerationAttribution = {
  mode: "MOCK_GENERATION" | "LIVE_PROVIDER" | "DISABLED";
  providerId: CodingProviderId | "none";
  model: string;
  note: string;
};

export type CodeGenerationResult =
  | {
      ok: true;
      proposals: FileChangeProposal[];
      attribution: CodeGenerationAttribution;
      usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
      checkpointId: string;
      durationMs: number;
    }
  | {
      ok: false;
      reason: string;
      message: string;
      attribution: CodeGenerationAttribution;
      checkpointId: string | null;
    };

export type CodingProvider = {
  id: CodingProviderId;
  privacy: CodingProviderPrivacyTier;
  generate(request: CodeGenerationRequest, signal?: AbortSignal): Promise<CodeGenerationResult>;
};

export const DEFAULT_CODING_BUDGET: CodingBudget = {
  maxInputTokens: 4_000,
  maxOutputTokens: 4_000,
  maxCostUsd: 0,
  maxDurationMs: 60_000,
  maxSteps: 8,
  maxRetries: 2,
  maxOutputBytes: 200_000,
};
