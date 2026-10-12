import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryAllowanceLedger } from "@/lib/allowance";
import { PILOT_03_ALLOWED_FILES, PILOT_03_OBJECTIVE } from "./pilot03-constants";
import {
  brandCodegenMockFetch,
  createOpenAiHttpCodingAdapter,
} from "./openai-http";
import { OPENAI_CHAT_COMPLETIONS_URL, PILOT_03_MAX_TRIAL_CENTS } from "./openai-models";
import {
  resetLiveDispatchCacheForTests,
  runPilot03LiveOpenAiDispatch,
} from "./live-dispatch";
import { makeApprovedCodingAuth } from "./test-fixtures";
import { createOpenAiCodingAdapter } from "./live-adapters";
import { developmentApprovalGrantsDeployment } from "@/lib/agent-runtime/authorization-kind";

function pilotFilesJson() {
  return JSON.stringify({
    files: PILOT_03_ALLOWED_FILES.map((relativePath) => ({
      relativePath,
      op: "CREATE",
      content: `// ${relativePath}\nexport const ok = true;\n`,
    })),
  });
}

function mockOpenAiFetch(handler: (init?: RequestInit) => Response | Promise<Response>) {
  return brandCodegenMockFetch(async (url, init) => {
    assert.match(String(url), /api\.openai\.com\/v1\/chat\/completions/);
    return handler(init);
  });
}

const baseBudget = {
  maxInputTokens: 4_000,
  maxOutputTokens: 4_000,
  maxCostUsd: 1,
  maxDurationMs: 30_000,
  maxSteps: 4,
  maxRetries: 2,
  maxOutputBytes: 200_000,
};

test("OpenAI GPT-5 request uses max_completion_tokens and omits max_tokens/temperature", async () => {
  let captured: string | null = null;
  const fetchImpl = mockOpenAiFetch((init) => {
    captured = typeof init?.body === "string" ? init.body : null;
    return new Response(
      JSON.stringify({
        id: "chatcmpl-contract",
        choices: [{ message: { content: pilotFilesJson() }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
      { status: 200 },
    );
  });
  const adapter = createOpenAiHttpCodingAdapter({
    env: {
      GHOST_CODEGEN_LIVE_ENABLED: "1",
      OPENAI_API_KEY: "sk-test-mock-key-not-real",
      GHOST_NO_LIVE_PROVIDER_CALLS: "1",
    },
    fetchImpl,
    model: "gpt-5-mini",
  });
  const result = await adapter.generate({
    objective: PILOT_03_OBJECTIVE,
    ownerId: randomUUID(),
    projectId: randomUUID(),
    authorizationId: randomUUID(),
    environmentLabel: "LOCAL_PILOT_03",
    classification: "PUBLIC",
    allowedRelativeRoots: ["generated"],
    budget: baseBudget,
    idempotencyKey: "api-contract-params",
  });
  assert.equal(result.ok, true);
  assert.ok(captured);
  const body = JSON.parse(captured!) as Record<string, unknown>;
  assert.equal(body.model, "gpt-5-mini");
  assert.equal(typeof body.max_completion_tokens, "number");
  assert.equal("max_tokens" in body, false);
  assert.equal("temperature" in body, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(String(body.messages ? "ok" : ""), "ok");
});

test("OpenAI adapter stays disabled by default — no HTTP", async () => {
  let called = 0;
  const adapter = createOpenAiCodingAdapter({
    env: { GHOST_CODEGEN_LIVE_ENABLED: undefined, OPENAI_API_KEY: "sk-test-should-not-use" },
    fetchImpl: brandCodegenMockFetch(async () => {
      called += 1;
      return new Response("nope", { status: 500 });
    }),
  });
  const result = await adapter.generate({
    objective: PILOT_03_OBJECTIVE,
    ownerId: randomUUID(),
    projectId: randomUUID(),
    authorizationId: randomUUID(),
    environmentLabel: "LOCAL_PILOT_03",
    classification: "PUBLIC",
    allowedRelativeRoots: ["generated"],
    budget: baseBudget,
    idempotencyKey: "disabled-probe",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "LIVE_DISABLED");
    assert.equal(result.attribution.mode, "DISABLED");
  }
  assert.equal(called, 0);
});

test("OpenAI HTTP happy path with branded mock fetch + usage reconciliation", async () => {
  resetLiveDispatchCacheForTests();
  const fetchImpl = mockOpenAiFetch(() =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        choices: [{ message: { content: pilotFilesJson() }, finish_reason: "stop" }],
        usage: { prompt_tokens: 120, completion_tokens: 800, total_tokens: 920 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  const ownerId = randomUUID();
  const projectId = randomUUID();
  const ledger = new MemoryAllowanceLedger();
  ledger.setAllowance({ ownerId, projectId, allowanceCents: 200 });
  const auth = makeApprovedCodingAuth({
    ownerId,
    projectId,
    objective: PILOT_03_OBJECTIVE,
    environmentLabel: "LOCAL_PILOT_03",
  });
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "ghost-p03-live-"));

  const run = await runPilot03LiveOpenAiDispatch({
    authorization: auth,
    ownerId,
    projectId,
    ledger,
    workspaceRoot,
    objective: PILOT_03_OBJECTIVE,
    estimatedCents: 100,
    idempotencyKey: "live-happy-001",
    env: {
      GHOST_CODEGEN_LIVE_ENABLED: "1",
      OPENAI_API_KEY: "sk-test-mock-key-not-real",
      GHOST_NO_LIVE_PROVIDER_CALLS: "1",
    },
    adapterOptions: { fetchImpl, model: "gpt-5-mini" },
  });
  assert.equal(run.ok, true);
  if (!run.ok) return;
  assert.equal(run.mode, "LIVE_PROVIDER");
  assert.equal(run.founderReviewStatus, "AWAITING_FOUNDER_REVIEW");
  assert.equal(run.deploymentAttempted, false);
  assert.ok(run.chargedCents >= 1 && run.chargedCents <= PILOT_03_MAX_TRIAL_CENTS);
  assert.ok(run.materializeSha256);
  assert.equal(run.liveHttpInvoked, true);

  const again = await runPilot03LiveOpenAiDispatch({
    authorization: auth,
    ownerId,
    projectId,
    ledger,
    workspaceRoot,
    objective: PILOT_03_OBJECTIVE,
    estimatedCents: 100,
    idempotencyKey: "live-happy-001",
    env: {
      GHOST_CODEGEN_LIVE_ENABLED: "1",
      OPENAI_API_KEY: "sk-test-mock-key-not-real",
      GHOST_NO_LIVE_PROVIDER_CALLS: "1",
    },
    adapterOptions: {
      fetchImpl: mockOpenAiFetch(() => {
        throw new Error("duplicate must not call provider");
      }),
      model: "gpt-5-mini",
    },
  });
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.idempotentReplay, true);
});

test("rejects non-PUBLIC, missing usage, rate limit, and malformed JSON", async () => {
  const env = {
    GHOST_CODEGEN_LIVE_ENABLED: "1",
    OPENAI_API_KEY: "sk-test-mock-key-not-real",
    GHOST_NO_LIVE_PROVIDER_CALLS: "1",
  };

  const publicOnly = createOpenAiHttpCodingAdapter({
    env,
    fetchImpl: mockOpenAiFetch(() => new Response("{}", { status: 200 })),
    model: "gpt-5-mini",
  });
  const internal = await publicOnly.generate({
    objective: PILOT_03_OBJECTIVE,
    ownerId: randomUUID(),
    projectId: randomUUID(),
    authorizationId: randomUUID(),
    environmentLabel: "LOCAL_PILOT_03",
    classification: "INTERNAL",
    allowedRelativeRoots: ["generated"],
    budget: baseBudget,
    idempotencyKey: "internal-deny",
  });
  assert.equal(internal.ok, false);
  if (!internal.ok) assert.equal(internal.reason, "PUBLIC_ONLY");

  const missingUsage = createOpenAiHttpCodingAdapter({
    env,
    fetchImpl: mockOpenAiFetch(() =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: pilotFilesJson() } }],
        }),
        { status: 200 },
      ),
    ),
    model: "gpt-5-mini",
  });
  const uncertain = await missingUsage.generate({
    objective: PILOT_03_OBJECTIVE,
    ownerId: randomUUID(),
    projectId: randomUUID(),
    authorizationId: randomUUID(),
    environmentLabel: "LOCAL_PILOT_03",
    classification: "PUBLIC",
    allowedRelativeRoots: ["generated"],
    budget: baseBudget,
    idempotencyKey: "missing-usage",
  });
  assert.equal(uncertain.ok, false);
  if (!uncertain.ok) assert.equal(uncertain.reason, "UNCERTAIN_BILLING");

  const rateLimited = createOpenAiHttpCodingAdapter({
    env,
    maxRetries: 0,
    fetchImpl: mockOpenAiFetch(() =>
      new Response(JSON.stringify({ error: { message: "rate_limit exceeded", type: "rate_limit" } }), {
        status: 429,
      }),
    ),
    model: "gpt-5-mini",
  });
  const limited = await rateLimited.generate({
    objective: PILOT_03_OBJECTIVE,
    ownerId: randomUUID(),
    projectId: randomUUID(),
    authorizationId: randomUUID(),
    environmentLabel: "LOCAL_PILOT_03",
    classification: "PUBLIC",
    allowedRelativeRoots: ["generated"],
    budget: baseBudget,
    idempotencyKey: "rate-limit",
  });
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.equal(limited.reason, "RATE_LIMITED");

  const malformed = createOpenAiHttpCodingAdapter({
    env,
    fetchImpl: mockOpenAiFetch(() =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "not-json-files" } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
        { status: 200 },
      ),
    ),
    model: "gpt-5-mini",
  });
  const bad = await malformed.generate({
    objective: PILOT_03_OBJECTIVE,
    ownerId: randomUUID(),
    projectId: randomUUID(),
    authorizationId: randomUUID(),
    environmentLabel: "LOCAL_PILOT_03",
    classification: "PUBLIC",
    allowedRelativeRoots: ["generated"],
    budget: baseBudget,
    idempotencyKey: "malformed",
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, "MALFORMED_RESPONSE");
});

test("insufficient allowance and concurrent open reservation fail closed", async () => {
  resetLiveDispatchCacheForTests();
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const ledger = new MemoryAllowanceLedger();
  ledger.setAllowance({ ownerId, projectId, allowanceCents: 50 });
  const auth = makeApprovedCodingAuth({
    ownerId,
    projectId,
    objective: PILOT_03_OBJECTIVE,
    environmentLabel: "LOCAL_PILOT_03",
  });
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "ghost-p03-allow-"));
  const low = await runPilot03LiveOpenAiDispatch({
    authorization: auth,
    ownerId,
    projectId,
    ledger,
    workspaceRoot,
    estimatedCents: 100,
    idempotencyKey: "low-allow",
    env: { GHOST_CODEGEN_LIVE_ENABLED: "1", OPENAI_API_KEY: "sk-test" },
  });
  assert.equal(low.ok, false);
  if (!low.ok) assert.equal(low.reason, "INSUFFICIENT_ALLOWANCE");

  const rich = new MemoryAllowanceLedger();
  rich.setAllowance({ ownerId, projectId, allowanceCents: 500 });
  rich.reserve({
    ownerId,
    projectId,
    taskKey: `pilot03-live-${auth.id}`,
    estimatedCents: 100,
    idempotencyKey: "pre-open",
  });
  const dupOpen = await runPilot03LiveOpenAiDispatch({
    authorization: auth,
    ownerId,
    projectId,
    ledger: rich,
    workspaceRoot,
    estimatedCents: 100,
    idempotencyKey: "dup-open-res",
    env: { GHOST_CODEGEN_LIVE_ENABLED: "1", OPENAI_API_KEY: "sk-test" },
  });
  assert.equal(dupOpen.ok, false);
  if (!dupOpen.ok) assert.equal(dupOpen.reason, "DUPLICATE_OPEN_RESERVATION");
});

test("auth required; development never grants deployment; official API URL constant", async () => {
  assert.equal(OPENAI_CHAT_COMPLETIONS_URL, "https://api.openai.com/v1/chat/completions");
  assert.equal(developmentApprovalGrantsDeployment("agent_task.develop", "DEPLOYMENT"), false);

  resetLiveDispatchCacheForTests();
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const ledger = new MemoryAllowanceLedger();
  ledger.setAllowance({ ownerId, projectId, allowanceCents: 200 });
  const denied = await runPilot03LiveOpenAiDispatch({
    authorization: null,
    ownerId,
    projectId,
    ledger,
    workspaceRoot: mkdtempSync(path.join(os.tmpdir(), "ghost-p03-auth-")),
    idempotencyKey: "no-auth",
    env: { GHOST_CODEGEN_LIVE_ENABLED: "1", OPENAI_API_KEY: "sk-test" },
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "MISSING_AUTHORIZATION");

  const revoked = makeApprovedCodingAuth({
    ownerId,
    projectId,
    status: "REVOKED",
    environmentLabel: "LOCAL_PILOT_03",
  });
  const rev = await runPilot03LiveOpenAiDispatch({
    authorization: revoked,
    ownerId,
    projectId,
    ledger,
    workspaceRoot: mkdtempSync(path.join(os.tmpdir(), "ghost-p03-rev-")),
    idempotencyKey: "revoked",
    env: { GHOST_CODEGEN_LIVE_ENABLED: "1", OPENAI_API_KEY: "sk-test" },
  });
  assert.equal(rev.ok, false);
});

test("path escape / secret-bearing output rejected", async () => {
  const env = {
    GHOST_CODEGEN_LIVE_ENABLED: "1",
    OPENAI_API_KEY: "sk-test-mock-key-not-real",
    GHOST_NO_LIVE_PROVIDER_CALLS: "1",
  };
  const adapter = createOpenAiHttpCodingAdapter({
    env,
    fetchImpl: mockOpenAiFetch(() =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  files: [{ relativePath: "../etc/passwd", op: "CREATE", content: "x" }],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
        { status: 200 },
      ),
    ),
    model: "gpt-5-mini",
  });
  const result = await adapter.generate({
    objective: PILOT_03_OBJECTIVE,
    ownerId: randomUUID(),
    projectId: randomUUID(),
    authorizationId: randomUUID(),
    environmentLabel: "LOCAL_PILOT_03",
    classification: "PUBLIC",
    allowedRelativeRoots: ["generated"],
    budget: baseBudget,
    idempotencyKey: "path-escape",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /PATH_ESCAPE|OUTSIDE_ALLOWED_ROOT/);
});
