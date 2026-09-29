import { redactSecrets } from "../security/redact";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types";

export type ProviderId = "groq" | "openai" | "anthropic" | "xai";

export type ProviderStatus =
  | "READY"
  | "NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "MODEL_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE";

export type ProviderSelection = {
  status: "READY" | "NOT_CONFIGURED";
  providerId: ProviderId | string;
  model: string | null;
  paid: boolean;
  detail: string;
  provider: ModelProvider | null;
};

type ProviderEnv = Record<string, string | undefined>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 60_000;

const PROVIDERS: Record<ProviderId, { label: string; paid: boolean; keyName: string; defaultModel: string; enabled: boolean }> = {
  groq: { label: "Groq", paid: false, keyName: "GROQ_API_KEY", defaultModel: "openai/gpt-oss-120b", enabled: true },
  openai: { label: "OpenAI", paid: true, keyName: "OPENAI_API_KEY", defaultModel: "gpt-4.1-mini", enabled: true },
  anthropic: { label: "Anthropic", paid: true, keyName: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-5", enabled: true },
  xai: { label: "xAI", paid: true, keyName: "XAI_API_KEY", defaultModel: "", enabled: false },
};

export class ProviderError extends Error {
  constructor(
    readonly status: Exclude<ProviderStatus, "READY" | "NOT_CONFIGURED">,
    readonly providerId: string,
    readonly model: string,
    detail: string,
  ) {
    super(detail);
    this.name = "ProviderError";
  }
}

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

type ProviderErrorBody = { error?: { type?: unknown; code?: unknown; message?: unknown } } | null;

function safeProviderDetail(value: ProviderErrorBody): string {
  const error = value?.error;
  const parts = [error?.type, error?.code, error?.message].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  const detail = parts.join(": ") || "The provider returned an error.";
  return redactSecrets(detail).slice(0, 500);
}

export function classifyProviderFailure(httpStatus: number, body: ProviderErrorBody): Exclude<ProviderStatus, "READY" | "NOT_CONFIGURED"> {
  const code = typeof body?.error?.code === "string" ? body.error.code : "";
  const type = typeof body?.error?.type === "string" ? body.error.type : "";
  const message = typeof body?.error?.message === "string" ? body.error.message : "";
  const text = `${code} ${type} ${message}`.toLowerCase();

  if (httpStatus === 401 || httpStatus === 403 || /invalid_api_key|authentication|unauthorized/.test(text)) {
    return "AUTH_FAILED";
  }
  if (/insufficient_quota|quota exceeded|exceeded your current quota|per day|\(tpd\)|\(rpd\)|spend limit|credit balance/.test(text)) {
    return "QUOTA_EXHAUSTED";
  }
  if (httpStatus === 429 || /rate_limit/.test(text)) {
    return "RATE_LIMITED";
  }
  if (httpStatus === 404 || /model_not_found|model_decommissioned|does not exist|model_not_active/.test(text)) {
    return "MODEL_UNAVAILABLE";
  }
  return "PROVIDER_UNAVAILABLE";
}

function openAiCompatibleProvider(input: {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
}): ModelProvider {
  const { id, label, baseUrl, apiKey, model, fetchImpl } = input;

  return {
    id,
    async complete(request): Promise<ModelResponse> {
      console.info("ghost.model.invoke", { provider: id, model });
      const startedAt = Date.now();
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
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
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
        throw new ProviderError("PROVIDER_UNAVAILABLE", id, model, `${label} ${reason}.`);
      }

      const body = (await response.json().catch(() => null)) as (ProviderErrorBody & {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: unknown;
      }) | null;

      if (!response.ok) {
        const status = classifyProviderFailure(response.status, body);
        const retryAfter = response.headers.get("retry-after");
        const wait = retryAfter && (status === "RATE_LIMITED" || status === "QUOTA_EXHAUSTED") ? ` Retry after ${retryAfter}s.` : "";
        throw new ProviderError(status, id, model, `${label} request failed (${response.status}). ${safeProviderDetail(body)}${wait}`);
      }

      const content = body?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new ProviderError("PROVIDER_UNAVAILABLE", id, model, `${label} returned an empty response.`);
      }

      const usage = readUsage(body?.usage);
      console.info("ghost.model.usage", { provider: id, model, latencyMs: Date.now() - startedAt, ...usage });

      return { content, provider: id, model, usage };
    },
  };
}

function anthropicProvider(apiKey: string, model: string, fetchImpl: FetchLike): ModelProvider {
  return {
    id: "anthropic",
    async complete(request): Promise<ModelResponse> {
      let response: Response;
      try {
        response = await fetchImpl("https://api.anthropic.com/v1/messages", {
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
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new ProviderError("PROVIDER_UNAVAILABLE", "anthropic", model, "Anthropic could not be reached.");
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ProviderErrorBody;
        throw new ProviderError(
          classifyProviderFailure(response.status, body),
          "anthropic",
          model,
          `Anthropic request failed (${response.status}). ${safeProviderDetail(body)}`,
        );
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
        throw new ProviderError("PROVIDER_UNAVAILABLE", "anthropic", model, "Anthropic returned an empty response.");
      }

      return { content, provider: "anthropic", model };
    },
  };
}

// An unset choice resolves to the free provider only. A paid provider runs
// only when GHOST_MODEL_PROVIDER names it, and a failure never moves to another provider.
export function resolveModelProvider(env: ProviderEnv = process.env, fetchImpl: FetchLike = fetch): ProviderSelection {
  const choice = env.GHOST_MODEL_PROVIDER?.trim().toLowerCase() || "groq";
  const spec = PROVIDERS[choice as ProviderId];
  if (!spec) {
    return { status: "NOT_CONFIGURED", providerId: choice, model: null, paid: false, detail: `Unknown model provider "${choice}".`, provider: null };
  }
  if (!spec.enabled) {
    return { status: "NOT_CONFIGURED", providerId: choice, model: null, paid: spec.paid, detail: `${spec.label} is not enabled in Ghost.`, provider: null };
  }

  const model = env.GHOST_AI_MODEL?.trim() || spec.defaultModel;
  const apiKey = env[spec.keyName]?.trim() ?? "";
  if (!apiKey) {
    return { status: "NOT_CONFIGURED", providerId: choice, model, paid: spec.paid, detail: `${spec.keyName} is not set.`, provider: null };
  }

  const id = choice as ProviderId;
  const provider =
    id === "anthropic"
      ? anthropicProvider(apiKey, model, fetchImpl)
      : openAiCompatibleProvider({
          id,
          label: spec.label,
          baseUrl: id === "groq" ? GROQ_BASE_URL : OPENAI_BASE_URL,
          apiKey,
          model,
          fetchImpl,
        });
  return { status: "READY", providerId: id, model, paid: spec.paid, detail: `${spec.label} ${model}`, provider };
}

export function describeProviderStatus(input: { status: ProviderStatus; providerId: string; model: string | null; detail: string }): string {
  const label = PROVIDERS[input.providerId as ProviderId]?.label ?? input.providerId;
  const target = input.model ? `${label} (${input.model})` : label;
  if (input.status === "READY") {
    return `${target} is READY.`;
  }
  return `Model provider ${input.status}: ${target}. ${redactSecrets(input.detail)} Ghost did not switch to another provider and did not invent an answer.`;
}

export type ProviderPolicySummary = {
  provider: string;
  model: string;
  status: "READY" | "NOT_CONFIGURED";
  costPolicy: "Free-first";
  paidFallback: "Disabled";
  paidSelected: boolean;
};

// Display-only: no provider call, and nothing derived from a key beyond whether one is set.
export function describeProviderPolicy(env: ProviderEnv = process.env): ProviderPolicySummary {
  const selection = resolveModelProvider(env);
  return {
    provider: PROVIDERS[selection.providerId as ProviderId]?.label ?? selection.providerId,
    model: selection.model ?? "none",
    status: selection.status,
    costPolicy: "Free-first",
    paidFallback: "Disabled",
    paidSelected: selection.paid,
  };
}

export function getModelProvider(): ModelProvider | null {
  return resolveModelProvider().provider;
}

export function isModelConfigured(): boolean {
  return getModelProvider() !== null;
}
