/**
 * Pilot 04 mock provider response matrix — no paid provider calls.
 * Distinguishes OpenAI/provider failures from Ghost parser defects.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PILOT_04_ALLOWED_FILES, PILOT_04_OBJECTIVE } from "./pilot04-constants";
import { brandCodegenMockFetch, createOpenAiHttpCodingAdapter } from "./openai-http";
import { isUncertainBillingReason } from "./live-scope";
import { createMockCodingProvider } from "./mock-provider";
import { DEFAULT_CODING_BUDGET } from "./types";
import { developmentApprovalGrantsDeployment } from "@/lib/agent-runtime/authorization-kind";

function mockFetch(handler: (init?: RequestInit) => Response | Promise<Response>) {
  return brandCodegenMockFetch(async (url, init) => {
    assert.match(String(url), /api\.openai\.com\/v1\/chat\/completions/);
    return handler(init);
  });
}

const liveEnv = {
  GHOST_CODEGEN_LIVE_ENABLED: "1",
  OPENAI_API_KEY: "sk-test-mock-key-not-real",
  GHOST_NO_LIVE_PROVIDER_CALLS: "1",
};

const budget = {
  ...DEFAULT_CODING_BUDGET,
  maxInputTokens: 4_000,
  maxOutputTokens: 12_000,
  maxCostUsd: 0.99,
  maxDurationMs: 30_000,
  maxRetries: 0,
};

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    objective: PILOT_04_OBJECTIVE,
    ownerId: randomUUID(),
    projectId: randomUUID(),
    authorizationId: randomUUID(),
    environmentLabel: "LOCAL_PILOT_04",
    classification: "PUBLIC" as const,
    allowedRelativeRoots: ["generated"],
    budget,
    idempotencyKey: `p4-${randomUUID()}`,
    ...overrides,
  };
}

function okFilesJson() {
  return JSON.stringify({
    files: PILOT_04_ALLOWED_FILES.map((relativePath) => ({
      relativePath,
      op: "CREATE",
      content:
        relativePath.endsWith(".html")
          ? `<!doctype html><html lang="en"><body><h1>Vehicle comparison</h1><section id="vehicles"></section></body></html>`
          : relativePath.endsWith(".css")
            ? `body{font-family:Georgia,serif}`
            : relativePath.endsWith("app.js")
              ? `const vehicles=[{id:"v1"},{id:"v2"},{id:"v3"}];`
              : relativePath.endsWith("test.mjs")
                ? `import assert from "node:assert/strict"; assert.ok(true); console.log("ok");`
                : "# Pilot 04 mock",
    })),
  });
}

async function generateWith(body: unknown, status = 200) {
  const adapter = createOpenAiHttpCodingAdapter({
    env: liveEnv,
    fetchImpl: mockFetch(() => new Response(JSON.stringify(body), { status })),
    model: "gpt-5-mini",
  });
  return adapter.generate(baseRequest());
}

test("matrix: successful visible HTML/CSS/JS", async () => {
  const result = await generateWith({
    id: "chatcmpl-ok",
    choices: [{ message: { content: okFilesJson() }, finish_reason: "stop" }],
    usage: { prompt_tokens: 200, completion_tokens: 800 },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.attribution.mode, "LIVE_PROVIDER");
    assert.ok(result.proposals.some((p) => p.relativePath.endsWith("index.html")));
  }
});

test("matrix: empty content finish_reason=length is EMPTY_PROVIDER_CONTENT (provider)", async () => {
  const result = await generateWith({
    id: "chatcmpl-empty-length",
    choices: [{ message: { content: "" }, finish_reason: "length" }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 4000,
      completion_tokens_details: { reasoning_tokens: 3990 },
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "EMPTY_PROVIDER_CONTENT");
    assert.equal(isUncertainBillingReason(result.reason), true);
    assert.equal(result.providerMeta?.finishReason, "length");
    assert.equal(result.providerMeta?.reasoningTokens, 3990);
  }
});

test("matrix: empty content reasoning exhausted still preserves usage", async () => {
  const result = await generateWith({
    choices: [{ message: { content: null }, finish_reason: "length" }],
    usage: {
      prompt_tokens: 50,
      completion_tokens: 12000,
      completion_tokens_details: { reasoning_tokens: 12000 },
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "EMPTY_PROVIDER_CONTENT");
    assert.equal(result.usage?.outputTokens, 12000);
  }
});

test("matrix: empty content unknown finish reason", async () => {
  const result = await generateWith({
    choices: [{ message: { content: "   " }, finish_reason: "content_filter" }],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "EMPTY_PROVIDER_CONTENT");
    assert.equal(result.providerMeta?.finishReason, "content_filter");
  }
});

test("matrix: structured JSON success", async () => {
  const result = await generateWith({
    choices: [{ message: { content: okFilesJson() }, finish_reason: "stop" }],
    usage: { prompt_tokens: 40, completion_tokens: 400 },
  });
  assert.equal(result.ok, true);
});

test("matrix: malformed JSON without length is MALFORMED_RESPONSE (parser)", async () => {
  const result = await generateWith({
    choices: [{ message: { content: "not-json{" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 10 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "MALFORMED_RESPONSE");
});

test("matrix: malformed JSON with finish_reason=length is TRUNCATED_OUTPUT (provider)", async () => {
  const result = await generateWith({
    choices: [{ message: { content: '{"files":[{"relativePath":' }, finish_reason: "length" }],
    usage: { prompt_tokens: 10, completion_tokens: 12000 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "TRUNCATED_OUTPUT");
    assert.equal(isUncertainBillingReason(result.reason), true);
  }
});

test("matrix: output size exceeded", async () => {
  const huge = "x".repeat(250_000);
  const result = await generateWith({
    choices: [
      {
        message: {
          content: JSON.stringify({
            files: [
              {
                relativePath: "generated/pilot-04-vehicle-comparison/app.js",
                op: "CREATE",
                content: huge,
              },
            ],
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 100 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /OUTPUT_TOO_LARGE|BUDGET|SIZE/i);
});

test("matrix: rate limit", async () => {
  const result = await generateWith({ error: { message: "rate_limit exceeded", type: "rate_limit" } }, 429);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "RATE_LIMITED");
});

test("matrix: provider error 500", async () => {
  const result = await generateWith({ error: { message: "internal" } }, 500);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "PROVIDER_UNAVAILABLE");
});

test("matrix: missing usage is UNCERTAIN_BILLING", async () => {
  const result = await generateWith({
    choices: [{ message: { content: okFilesJson() }, finish_reason: "stop" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "UNCERTAIN_BILLING");
    assert.equal(isUncertainBillingReason(result.reason), true);
  }
});

test("matrix: timeout / aborted after request sent", async () => {
  const adapter = createOpenAiHttpCodingAdapter({
    env: liveEnv,
    timeoutMs: 20,
    fetchImpl: brandCodegenMockFetch(async (_url, init) => {
      const signal = init?.signal;
      await new Promise<never>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
      return new Response("{}", { status: 200 });
    }),
    model: "gpt-5-mini",
  });
  const result = await adapter.generate(baseRequest({ budget: { ...budget, maxDurationMs: 20 } }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    // Abort after dispatch may have started — fail closed as uncertain billing (no free release / auto-retry).
    assert.equal(result.reason, "UNCERTAIN_BILLING");
    assert.equal(isUncertainBillingReason(result.reason), true);
  }
});

test("matrix: unsafe generated path rejected", async () => {
  const result = await generateWith({
    choices: [
      {
        message: {
          content: JSON.stringify({
            files: [{ relativePath: "../etc/passwd", op: "CREATE", content: "x" }],
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /PATH|OUTSIDE|ESCAPE/i);
});

test("matrix: secrets in proposed output rejected", async () => {
  const result = await generateWith({
    choices: [
      {
        message: {
          content: JSON.stringify({
            files: [
              {
                relativePath: "generated/pilot-04-vehicle-comparison/app.js",
                op: "CREATE",
                content: 'const key = "sk-proj-ABCDEFGHIJKLMNOPQRSTUV";',
              },
            ],
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /SECRET|SENSITIVE|UNSAFE/i);
});

test("matrix: incorrect model not allowlisted", async () => {
  const adapter = createOpenAiHttpCodingAdapter({
    env: liveEnv,
    fetchImpl: mockFetch(() => new Response("{}", { status: 200 })),
    model: "gpt-4o-mini",
  });
  const result = await adapter.generate(baseRequest());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "MODEL_NOT_ALLOWLISTED");
});

test("matrix: privacy mismatch RESTRICTED", async () => {
  const adapter = createOpenAiHttpCodingAdapter({
    env: liveEnv,
    fetchImpl: mockFetch(() => new Response("{}", { status: 200 })),
    model: "gpt-5-mini",
  });
  const result = await adapter.generate(baseRequest({ classification: "RESTRICTED" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /PRIVACY_MISMATCH|PUBLIC_ONLY|CLASSIFICATION/i);
});

test("matrix: deployment cannot be granted from development authorization", () => {
  assert.equal(developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT"), false);
});

test("matrix: mock provider Pilot 04 paths + MOCK_GENERATION attribution", async () => {
  const provider = createMockCodingProvider();
  const result = await provider.generate(baseRequest({ budget: { ...DEFAULT_CODING_BUDGET, maxCostUsd: 0 } }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.attribution.mode, "MOCK_GENERATION");
    assert.ok(result.proposals.every((p) => p.relativePath.startsWith("generated/pilot-04-vehicle-comparison/")));
  }
});

test("matrix: gpt-5 request includes reasoning_effort=low and raised completion budget", async () => {
  let captured: string | null = null;
  const adapter = createOpenAiHttpCodingAdapter({
    env: liveEnv,
    fetchImpl: mockFetch((init) => {
      captured = typeof init?.body === "string" ? init.body : null;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: okFilesJson() }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
        { status: 200 },
      );
    }),
    model: "gpt-5-mini",
  });
  await adapter.generate(baseRequest());
  assert.ok(captured);
  const body = JSON.parse(captured!) as Record<string, unknown>;
  assert.equal(body.reasoning_effort, "low");
  assert.equal(body.max_completion_tokens, 12_000);
});
