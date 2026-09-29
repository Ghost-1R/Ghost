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

function openAiProvider(apiKey: string): ModelProvider {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";

  return {
    id: "openai",
    async complete(request): Promise<ModelResponse> {
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

      if (!response.ok) {
        throw new Error(`OpenAI request failed (${response.status}).`);
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("OpenAI returned an empty response.");
      }

      return { content, provider: "openai", model };
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
