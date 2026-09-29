import type { ModelProvider, ModelRequest, ModelResponse } from "./types";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function toChatMessages(request: ModelRequest): ChatMessage[] {
  return [
    { role: "system", content: request.system },
    ...request.messages.map((message) => ({ role: message.role, content: message.content })),
  ];
}

function readUsage(value: unknown): ModelResponse["usage"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const usage = value as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  if (
    typeof usage.prompt_tokens !== "number" ||
    typeof usage.completion_tokens !== "number" ||
    typeof usage.total_tokens !== "number"
  ) {
    return undefined;
  }

  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function safeProviderDetail(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "The provider returned an error.";
  }

  const error = (value as { error?: { type?: unknown; code?: unknown; message?: unknown } }).error;
  const parts = [error?.type, error?.code, error?.message].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  const detail = parts.join(": ") || "The provider returned an error.";
  return detail.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500);
}

function openAiProvider(apiKey: string): ModelProvider {
  const model = process.env.GHOST_AI_MODEL?.trim() || "gpt-4.1-mini";

  return {
    id: "openai",
    async complete(request): Promise<ModelResponse> {
      console.info("ghost.model.invoke", { provider: "openai", model });
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: toChatMessages(request),
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: { type?: string; code?: string; message?: string };
        choices?: Array<{ message?: { content?: string } }>;
        usage?: unknown;
      } | null;

      if (!response.ok) {
        throw new Error(`OpenAI request failed (${response.status}). ${safeProviderDetail(body)}`);
      }

      const content = body?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("OpenAI returned an empty response.");
      }

      const usage = readUsage(body?.usage);
      if (usage) {
        console.info("ghost.model.usage", { provider: "openai", model, ...usage });
      }

      return { content, provider: "openai", model, usage };
    },
  };
}

function anthropicProvider(apiKey: string): ModelProvider {
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-5";

  return {
    id: "anthropic",
    async complete(request): Promise<ModelResponse> {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          temperature: 0.2,
          system: request.system,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic request failed (${response.status}).`);
      }

      const body = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const content = body.content
        ?.filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n")
        .trim();

      if (!content) {
        throw new Error("Anthropic returned an empty response.");
      }

      return { content, provider: "anthropic", model };
    },
  };
}

export function getModelProvider(): ModelProvider | null {
  const choice = process.env.GHOST_MODEL_PROVIDER?.trim().toLowerCase() ?? "";
  const openAiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";

  if (choice === "openai" && openAiKey) {
    return openAiProvider(openAiKey);
  }

  if (choice === "anthropic" && anthropicKey) {
    return anthropicProvider(anthropicKey);
  }

  if (!choice && openAiKey) {
    return openAiProvider(openAiKey);
  }

  if (!choice && anthropicKey) {
    return anthropicProvider(anthropicKey);
  }

  return null;
}

export function isModelConfigured(): boolean {
  return getModelProvider() !== null;
}
