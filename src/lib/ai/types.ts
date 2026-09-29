import type { GhostContext } from "../brain/types";

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ModelRequest = {
  system: string;
  context: GhostContext;
  messages: ConversationTurn[];
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ModelResponse = {
  content: string;
  provider: string;
  model: string;
  usage?: ModelUsage;
};

export type ModelProvider = {
  id: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
};

export const UNCONFIGURED_NOTICE =
  "No model provider is configured. Ghost did not call a model and did not invent an answer.";
