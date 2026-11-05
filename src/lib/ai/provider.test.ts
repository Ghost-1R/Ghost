import assert from "node:assert/strict";
import test from "node:test";
import type { GhostContext } from "../brain/types";
import { brandMockFetch } from "./live-provider-mode";
import { classifyProviderFailure, describeProviderPolicy, describeProviderStatus, ProviderError, resolveModelProvider } from "./provider";
import { prepareReply } from "./reply";

const GROQ_KEY = "gsk_testkeyvalue000000000000000000000000000000";
const PAID_ENV = { OPENAI_API_KEY: "sk-test-paid-openai-key", XAI_API_KEY: "xai-test-paid-key-000000000000", ANTHROPIC_API_KEY: "test-anthropic" };

const context: GhostContext = {
  scope: "project",
  project: {
    id: "a",
    name: "GHOST",
    description: "Founder operating system.",
    status: "BUILDING",
    currentMilestone: "Experience",
    repositoryProvider: null,
    repositoryUrl: null,
    repositoryBranch: null,
    repositoryCommit: null,
  },
  projects: [],
  milestone: null,
  requirements: [],
  decisions: [],
  constraints: [],
  blockers: [],
  nextActions: [],
  verification: [],
  founderRules: [{ id: "rule-1", title: "RULE-001 — Test Before Scaling Changes", content: "Test a sample first." }],
  truncated: false,
};

type Call = { url: string; headers: Record<string, string>; body: { model?: string; messages?: Array<{ content: string }> } };

function recorder(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = brandMockFetch(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({
      url: href,
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return respond(href);
  });
  return { calls, fetchImpl };
}

function paidCalls(calls: Call[]): number {
  return calls.filter((call) => !call.url.startsWith("https://api.groq.com/")).length;
}

test("an unset provider resolves to free Groq, never to a configured paid key", () => {
  const withBoth = resolveModelProvider({ GROQ_API_KEY: GROQ_KEY, ...PAID_ENV });
  assert.equal(withBoth.providerId, "groq");
  assert.equal(withBoth.model, "openai/gpt-oss-120b");
  assert.equal(withBoth.paid, false);
  assert.equal(withBoth.status, "READY");

  const paidOnly = resolveModelProvider({ ...PAID_ENV });
  assert.equal(paidOnly.status, "NOT_CONFIGURED");
  assert.equal(paidOnly.providerId, "groq");
  assert.equal(paidOnly.provider, null);
});

test("paid providers run only when explicitly selected, and xAI stays disabled", () => {
  const openai = resolveModelProvider({ GHOST_MODEL_PROVIDER: "openai", GHOST_AI_MODEL: "gpt-4.1-mini", ...PAID_ENV });
  assert.equal(openai.status, "READY");
  assert.equal(openai.providerId, "openai");
  assert.equal(openai.paid, true);

  const xai = resolveModelProvider({ GHOST_MODEL_PROVIDER: "xai", ...PAID_ENV });
  assert.equal(xai.status, "NOT_CONFIGURED");
  assert.equal(xai.provider, null);

  const unknown = resolveModelProvider({ GHOST_MODEL_PROVIDER: "grok", ...PAID_ENV });
  assert.equal(unknown.status, "NOT_CONFIGURED");
  assert.equal(unknown.provider, null);
});

test("a Groq request carries the Ghost grounding to the OpenAI-compatible endpoint", async () => {
  const { calls, fetchImpl } = recorder(
    () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Grounded answer." } }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        }),
        { status: 200 },
      ),
  );
  const selection = resolveModelProvider({ GHOST_MODEL_PROVIDER: "groq", GHOST_AI_MODEL: "openai/gpt-oss-120b", GROQ_API_KEY: GROQ_KEY }, fetchImpl);
  const reply = await prepareReply({
    requestedProjectId: "a",
    visibleProjectId: "a",
    context,
    grounding: '{"project":"GHOST","founderRules":["RULE-001"]}',
    messages: [{ role: "user", content: "What is next?" }],
    provider: selection.provider,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(calls[0]?.body.model, "openai/gpt-oss-120b");
  assert.equal(calls[0]?.headers.authorization, `Bearer ${GROQ_KEY}`);
  assert.equal(calls[0]?.body.messages?.some((message) => message.content.includes("RULE-001")), true);
  assert.equal(reply.ok, true);
  if (reply.ok) {
    assert.equal(reply.provider, "groq");
    assert.equal(reply.model, "openai/gpt-oss-120b");
    assert.equal(JSON.stringify(reply).includes(GROQ_KEY), false);
  }
});

test("Groq failure is never a paid fallback", async () => {
  const cases: Array<{ name: string; respond: () => Response | Promise<Response>; status: string }> = [
    { name: "invalid auth", respond: () => new Response(JSON.stringify({ error: { code: "invalid_api_key", message: "Invalid API Key" } }), { status: 401 }), status: "AUTH_FAILED" },
    {
      name: "rate limit",
      respond: () =>
        new Response(
          JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Rate limit reached on tokens per minute (TPM). Upgrade at https://console.groq.com/settings/billing" } }),
          { status: 429, headers: { "retry-after": "7" } },
        ),
      status: "RATE_LIMITED",
    },
    {
      name: "daily quota",
      respond: () => new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Rate limit reached on tokens per day (TPD)." } }), { status: 429 }),
      status: "QUOTA_EXHAUSTED",
    },
    {
      name: "request too large",
      respond: () => new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Request too large on tokens per minute (TPM)." } }), { status: 413 }),
      status: "RATE_LIMITED",
    },
    { name: "model missing", respond: () => new Response(JSON.stringify({ error: { code: "model_not_found", message: "The model does not exist." } }), { status: 404 }), status: "MODEL_UNAVAILABLE" },
    { name: "provider down", respond: () => new Response("upstream", { status: 503 }), status: "PROVIDER_UNAVAILABLE" },
    {
      name: "network failure",
      respond: () => {
        throw new TypeError("fetch failed");
      },
      status: "PROVIDER_UNAVAILABLE",
    },
  ];

  for (const item of cases) {
    const { calls, fetchImpl } = recorder(item.respond);
    const selection = resolveModelProvider({ GHOST_MODEL_PROVIDER: "groq", GROQ_API_KEY: GROQ_KEY, ...PAID_ENV }, fetchImpl);
    await assert.rejects(
      prepareReply({ requestedProjectId: "a", visibleProjectId: "a", context, messages: [{ role: "user", content: "hi" }], provider: selection.provider }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError, item.name);
        assert.equal(error.status, item.status, item.name);
        assert.equal(error.providerId, "groq", item.name);
        assert.equal(error.message.includes(GROQ_KEY), false, item.name);
        const notice = describeProviderStatus({ status: error.status, providerId: error.providerId, model: error.model, detail: error.message });
        assert.equal(notice.includes(item.status), true, item.name);
        assert.equal(notice.includes("did not switch"), true, item.name);
        return true;
      },
    );
    assert.equal(calls.length, 1, item.name);
    assert.equal(paidCalls(calls), 0, item.name);
  }

  const missing = recorder(() => new Response("{}", { status: 200 }));
  const unconfigured = resolveModelProvider({ GHOST_MODEL_PROVIDER: "groq", ...PAID_ENV }, missing.fetchImpl);
  assert.equal(unconfigured.status, "NOT_CONFIGURED");
  const reply = await prepareReply({ requestedProjectId: "a", visibleProjectId: "a", context, messages: [{ role: "user", content: "hi" }], provider: unconfigured.provider });
  assert.equal(reply.ok, false);
  assert.equal(missing.calls.length, 0);
  assert.equal(describeProviderStatus(unconfigured).includes("GROQ_API_KEY is not set"), true);
});

test("the settings summary names the provider and policy without key material", () => {
  const summary = describeProviderPolicy({ GROQ_API_KEY: GROQ_KEY, ...PAID_ENV });
  assert.deepEqual(summary, {
    provider: "Groq",
    model: "openai/gpt-oss-120b",
    status: "READY",
    costPolicy: "Free-first",
    paidFallback: "Disabled",
    paidSelected: false,
  });
  const serialized = JSON.stringify(summary);
  for (const secret of [GROQ_KEY, ...Object.values(PAID_ENV)]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(serialized.includes(String(GROQ_KEY.length)), false);
  assert.equal(describeProviderPolicy({ ...PAID_ENV }).status, "NOT_CONFIGURED");
});

test("failure classification distinguishes each provider status", () => {
  assert.equal(classifyProviderFailure(401, null), "AUTH_FAILED");
  assert.equal(classifyProviderFailure(403, { error: { message: "Organization restricted" } }), "AUTH_FAILED");
  assert.equal(classifyProviderFailure(429, { error: { code: "insufficient_quota" } }), "QUOTA_EXHAUSTED");
  assert.equal(classifyProviderFailure(429, { error: { code: "rate_limit_exceeded", message: "Upgrade in billing" } }), "RATE_LIMITED");
  assert.equal(classifyProviderFailure(400, { error: { code: "model_decommissioned" } }), "MODEL_UNAVAILABLE");
  assert.equal(classifyProviderFailure(500, null), "PROVIDER_UNAVAILABLE");
  assert.equal(classifyProviderFailure(498, null), "PROVIDER_UNAVAILABLE");
});
