/**
 * OpenAI Chat Completions HTTP adapter for Pilot 03 coding.
 * Official contract: POST https://api.openai.com/v1/chat/completions
 * Live calls require GHOST_CODEGEN_LIVE_ENABLED=1 + allowlisted model + key.
 * Default: disabled. Tests must inject brandMockFetch — no real network.
 */

import { randomUUID } from "node:crypto";
import {
  assertOutboundLiveModelCallAllowed,
  brandMockFetch,
  type ProviderEnv,
} from "@/lib/ai/live-provider-mode";
import { redactSecrets } from "@/lib/security/redact";
import { CODING_PROVIDER_PRIVACY, providerSatisfiesClassification } from "./privacy";
import {
  getOpenAiCodingModelSpec,
  isOpenAiCodingModelAllowlisted,
  OPENAI_CHAT_COMPLETIONS_URL,
  OPENAI_DEFAULT_TIMEOUT_MS,
  OPENAI_MAX_RETRIES,
  estimateOpenAiCostUsd,
  PILOT_03_MAX_TRIAL_CENTS,
} from "./openai-models";
import { isCodegenLiveEnabled } from "./provider-config";
import { assertObjectiveSafe, validateProposals } from "./security";
import type {
  CodeGenerationRequest,
  CodeGenerationResult,
  CodingProvider,
  FileChangeProposal,
} from "./types";

export type OpenAiHttpAdapterOptions = {
  env?: ProviderEnv;
  fetchImpl?: typeof fetch;
  /** Override model (must remain allowlisted). */
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

type ChatCompletionResponse = {
  id?: string;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string };
};

function attribution(model: string, note: string, mode: "DISABLED" | "LIVE_PROVIDER" = "DISABLED") {
  return {
    mode,
    providerId: "openai" as const,
    model,
    note,
  };
}

function fail(
  reason: string,
  message: string,
  model: string,
  checkpointId: string | null,
  mode: "DISABLED" | "LIVE_PROVIDER" = "DISABLED",
): CodeGenerationResult {
  return {
    ok: false,
    reason,
    message: redactSecrets(message),
    attribution: attribution(model, redactSecrets(message), mode),
    checkpointId,
  };
}

function classifyHttpFailure(status: number, body: ChatCompletionResponse | null): string {
  const text = `${body?.error?.code ?? ""} ${body?.error?.type ?? ""} ${body?.error?.message ?? ""}`.toLowerCase();
  if (status === 401 || status === 403 || /invalid_api_key|authentication|unauthorized/.test(text)) {
    return "AUTH_FAILED";
  }
  if (/insufficient_quota|quota|credit|billing|spend limit/.test(text)) {
    return "INSUFFICIENT_CREDITS";
  }
  if (status === 429 || /rate_limit/.test(text)) {
    return "RATE_LIMITED";
  }
  if (status === 404 || /model_not_found|does not exist/.test(text)) {
    return "MODEL_UNAVAILABLE";
  }
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "PROVIDER_ERROR";
}

function parseStructuredFiles(content: string): {
  ok: true; proposals: FileChangeProposal[];
} | { ok: false; reason: string; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: "MALFORMED_RESPONSE", message: "Provider returned non-JSON content." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "MALFORMED_RESPONSE", message: "Provider JSON root must be an object." };
  }
  const files = (parsed as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    return { ok: false, reason: "MALFORMED_RESPONSE", message: "Provider JSON must include a files array." };
  }
  const proposals: FileChangeProposal[] = [];
  for (const row of files) {
    if (!row || typeof row !== "object") {
      return { ok: false, reason: "MALFORMED_RESPONSE", message: "Each file entry must be an object." };
    }
    const relativePath = (row as { relativePath?: unknown }).relativePath;
    const op = (row as { op?: unknown }).op;
    const contentField = (row as { content?: unknown }).content;
    if (typeof relativePath !== "string" || !relativePath.trim()) {
      return { ok: false, reason: "MALFORMED_RESPONSE", message: "File relativePath must be a string." };
    }
    if (op !== "CREATE" && op !== "UPDATE" && op !== "DELETE") {
      return { ok: false, reason: "MALFORMED_RESPONSE", message: "File op must be CREATE, UPDATE, or DELETE." };
    }
    if (op === "DELETE") {
      proposals.push({ relativePath: relativePath.trim(), op, content: null });
      continue;
    }
    if (typeof contentField !== "string") {
      return { ok: false, reason: "MALFORMED_RESPONSE", message: "CREATE/UPDATE require string content." };
    }
    proposals.push({
      relativePath: relativePath.trim(),
      op,
      content: contentField,
    });
  }
  return { ok: true, proposals };
}

function buildMessages(request: CodeGenerationRequest): Array<{ role: "system" | "user"; content: string }> {
  const roots = request.allowedRelativeRoots.join(", ");
  return [
    {
      role: "system",
      content: [
        "You are Ghost's coding generator for a PUBLIC fictional demo only.",
        "Return ONLY valid JSON: {\"files\":[{\"relativePath\":\"...\",\"op\":\"CREATE|UPDATE|DELETE\",\"content\":\"...\"}]}",
        `All relativePath values must stay under: ${roots}`,
        "No secrets, no network calls in generated code, no deployment scripts, no payment/PII.",
        "Do not wrap JSON in markdown fences.",
      ].join(" "),
    },
    {
      role: "user",
      content: request.objective.trim(),
    },
  ];
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
      },
      { once: true },
    );
  });
}

/**
 * Create OpenAI coding adapter. Live HTTP is off unless GHOST_CODEGEN_LIVE_ENABLED=1.
 * Never logs API key material.
 */
export function createOpenAiHttpCodingAdapter(options: OpenAiHttpAdapterOptions = {}): CodingProvider {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model?.trim() || "gpt-5-mini";
  const baseUrl = (options.baseUrl ?? OPENAI_CHAT_COMPLETIONS_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? OPENAI_DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? OPENAI_MAX_RETRIES;

  return {
    id: "openai",
    privacy: CODING_PROVIDER_PRIVACY.openai,
    async generate(request: CodeGenerationRequest, signal?: AbortSignal): Promise<CodeGenerationResult> {
      const started = Date.now();
      const checkpointId = randomUUID();

      if (!isCodegenLiveEnabled(env)) {
        return fail(
          "LIVE_DISABLED",
          "OpenAI live coding is disabled until founder sets GHOST_CODEGEN_LIVE_ENABLED=1.",
          model,
          checkpointId,
        );
      }

      if (request.classification !== "PUBLIC") {
        return fail(
          "PUBLIC_ONLY",
          "First live coding trial accepts PUBLIC classification only.",
          model,
          checkpointId,
        );
      }

      if (!providerSatisfiesClassification(this.privacy, request.classification)) {
        return fail("PRIVACY_MISMATCH", "Provider cannot satisfy classification.", model, checkpointId);
      }

      if (!isOpenAiCodingModelAllowlisted(model)) {
        return fail("MODEL_NOT_ALLOWLISTED", `Model ${model} is not on the OpenAI coding allowlist.`, model, checkpointId);
      }

      const spec = getOpenAiCodingModelSpec(model)!;
      if (request.budget.maxCostUsd > PILOT_03_MAX_TRIAL_CENTS / 100 + 1e-9) {
        return fail(
          "TRIAL_CEILING",
          `Request maxCostUsd exceeds Pilot 03 hard ceiling of $${(PILOT_03_MAX_TRIAL_CENTS / 100).toFixed(2)}.`,
          model,
          checkpointId,
        );
      }

      const objectiveOk = assertObjectiveSafe(request.objective);
      if (!objectiveOk.ok) {
        return fail(objectiveOk.reason, objectiveOk.message, model, checkpointId);
      }

      if (signal?.aborted) {
        return fail("CANCELLED", "Generation cancelled before start.", model, checkpointId);
      }

      const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
      if (!apiKey) {
        return fail("MISSING_API_KEY", "OPENAI_API_KEY is not set (server-side only).", model, checkpointId);
      }

      try {
        assertOutboundLiveModelCallAllowed(env, fetchImpl);
      } catch (error) {
        return fail(
          "NO_LIVE_PROVIDER_CALLS",
          error instanceof Error ? error.message : "Outbound model HTTP blocked.",
          model,
          checkpointId,
        );
      }

      // GPT-5 family: max_completion_tokens (not max_tokens); omit temperature.
      const body: Record<string, unknown> = {
        model,
        max_completion_tokens: Math.min(request.budget.maxOutputTokens, spec.maxOutputTokens),
        response_format: { type: "json_object" as const },
        messages: buildMessages(request),
      };

      let lastError: CodeGenerationResult | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) {
          return fail("CANCELLED", "Generation cancelled.", model, checkpointId, "LIVE_PROVIDER");
        }
        if (Date.now() - started > request.budget.maxDurationMs) {
          return fail("TIMEOUT", "Generation exceeded duration budget before request.", model, checkpointId, "LIVE_PROVIDER");
        }

        const controller = new AbortController();
        const onAbort = () => controller.abort();
        signal?.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, request.budget.maxDurationMs));

        let response: Response;
        try {
          console.info("ghost.codegen.openai.invoke", {
            provider: "openai",
            model,
            attempt,
            idempotencyKey: request.idempotencyKey.slice(0, 64),
            // never log apiKey
          });
          const headers: Record<string, string> = {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          };
          const org = env.OPENAI_ORG_ID?.trim();
          if (org) headers["openai-organization"] = org;
          response = await fetchImpl(baseUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (error) {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          // Request may have reached the provider — never auto-retry; treat as uncertain billing.
          const cancelled = error instanceof Error && (error.name === "AbortError" || signal?.aborted);
          if (cancelled) {
            return fail(
              "UNCERTAIN_BILLING",
              "OpenAI request timed out or was cancelled after dispatch may have started — reservation preserved; do not retry automatically.",
              model,
              checkpointId,
              "LIVE_PROVIDER",
            );
          }
          return fail(
            "UNCERTAIN_BILLING",
            "OpenAI connection failed after dispatch may have started — reservation preserved; do not retry automatically.",
            model,
            checkpointId,
            "LIVE_PROVIDER",
          );
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        }

        const rawText = await response.text().catch(() => "");
        let parsedBody: ChatCompletionResponse | null = null;
        try {
          parsedBody = rawText ? (JSON.parse(rawText) as ChatCompletionResponse) : null;
        } catch {
          parsedBody = null;
        }

        if (!response.ok) {
          const reason = classifyHttpFailure(response.status, parsedBody);
          const detail = redactSecrets(parsedBody?.error?.message ?? `HTTP ${response.status}`);
          lastError = fail(reason, `OpenAI request failed: ${detail}`, model, checkpointId, "LIVE_PROVIDER");
          const retryable = reason === "RATE_LIMITED" || reason === "PROVIDER_UNAVAILABLE";
          if (retryable && attempt < maxRetries) {
            const retryAfter = Number(response.headers.get("retry-after") ?? "0");
            await sleep(Math.max(50 * (attempt + 1), retryAfter * 1000), signal).catch(() => null);
            continue;
          }
          return lastError;
        }

        const content = parsedBody?.choices?.[0]?.message?.content?.trim() ?? "";
        if (!content) {
          return fail("MALFORMED_RESPONSE", "OpenAI returned empty content.", model, checkpointId, "LIVE_PROVIDER");
        }

        const structured = parseStructuredFiles(content);
        if (!structured.ok) {
          return fail(structured.reason, structured.message, model, checkpointId, "LIVE_PROVIDER");
        }

        const validated = validateProposals(
          structured.proposals,
          request.allowedRelativeRoots,
          request.budget.maxOutputBytes,
        );
        if (!validated.ok) {
          return fail(validated.reason, validated.message, model, checkpointId, "LIVE_PROVIDER");
        }

        const inputTokens = parsedBody?.usage?.prompt_tokens;
        const outputTokens = parsedBody?.usage?.completion_tokens;
        if (
          typeof inputTokens !== "number" ||
          typeof outputTokens !== "number" ||
          !Number.isFinite(inputTokens) ||
          !Number.isFinite(outputTokens) ||
          inputTokens < 0 ||
          outputTokens < 0
        ) {
          return fail(
            "UNCERTAIN_BILLING",
            "OpenAI response missing usable token usage — refusing to accept output without reconciliation data.",
            model,
            checkpointId,
            "LIVE_PROVIDER",
          );
        }

        if (inputTokens > request.budget.maxInputTokens || outputTokens > request.budget.maxOutputTokens) {
          return fail("BUDGET_EXCEEDED", "Token usage exceeded request budget.", model, checkpointId, "LIVE_PROVIDER");
        }

        const cost = estimateOpenAiCostUsd({ model, inputTokens, outputTokens });
        if (!cost.ok) {
          return fail(cost.reason, cost.message, model, checkpointId, "LIVE_PROVIDER");
        }
        if (cost.costUsd > request.budget.maxCostUsd + 1e-9 || cost.cents > PILOT_03_MAX_TRIAL_CENTS) {
          return fail(
            "BUDGET_EXCEEDED",
            "Estimated cost exceeds trial ceiling — output rejected for founder safety.",
            model,
            checkpointId,
            "LIVE_PROVIDER",
          );
        }

        const durationMs = Date.now() - started;
        console.info("ghost.codegen.openai.usage", {
          provider: "openai",
          model,
          inputTokens,
          outputTokens,
          estimatedCostUsd: Number(cost.costUsd.toFixed(6)),
          durationMs,
          files: validated.proposals.length,
        });

        return {
          ok: true,
          proposals: validated.proposals,
          attribution: attribution(
            model,
            "LIVE_PROVIDER OpenAI Chat Completions — awaiting founder review. Not Project Truth.",
            "LIVE_PROVIDER",
          ),
          usage: {
            inputTokens,
            outputTokens,
            estimatedCostUsd: cost.costUsd,
          },
          checkpointId,
          durationMs,
        };
      }

      return (
        lastError ??
        fail("PROVIDER_UNAVAILABLE", "OpenAI generation failed after retries.", model, checkpointId, "LIVE_PROVIDER")
      );
    },
  };
}

/** Test helper — brands a mock fetch so NO_LIVE gates allow synthetic probes. */
export function brandCodegenMockFetch(
  fetchImpl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return brandMockFetch(fetchImpl) as typeof fetch;
}
