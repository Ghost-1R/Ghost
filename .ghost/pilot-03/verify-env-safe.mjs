/** Safe adapter config probe — no real HTTP, no secret print. */
import { isCodegenLiveEnabled, CODEGEN_LIVE_FLAG } from "../../src/lib/codegen/provider-config.ts";
import { createOpenAiHttpCodingAdapter } from "../../src/lib/codegen/openai-http.ts";
import {
  OPENAI_CHAT_COMPLETIONS_URL,
  isOpenAiCodingModelAllowlisted,
} from "../../src/lib/codegen/openai-models.ts";

let fetchCalled = false;
const adapter = createOpenAiHttpCodingAdapter({
  env: {
    GHOST_CODEGEN_LIVE_ENABLED: "0",
    OPENAI_API_KEY: "sk-probe-not-sent",
  },
  fetchImpl: async () => {
    fetchCalled = true;
    throw new Error("fetch must not run");
  },
  model: "gpt-5-mini",
});

const result = await adapter.generate({
  objective: "noop",
  ownerId: "00000000-0000-0000-0000-000000000001",
  projectId: "00000000-0000-0000-0000-000000000002",
  authorizationId: "00000000-0000-0000-0000-000000000003",
  environmentLabel: "LOCAL_PILOT_03",
  classification: "PUBLIC",
  allowedRelativeRoots: ["generated"],
  budget: {
    maxInputTokens: 100,
    maxOutputTokens: 100,
    maxCostUsd: 1,
    maxDurationMs: 1000,
    maxSteps: 1,
    maxRetries: 0,
    maxOutputBytes: 1000,
  },
  idempotencyKey: "env-verify-no-http",
});

console.log(
  JSON.stringify({
    liveFlagName: CODEGEN_LIVE_FLAG,
    processLiveEnabled: isCodegenLiveEnabled(),
    allowlistedGpt5Mini: isOpenAiCodingModelAllowlisted("gpt-5-mini"),
    endpoint: OPENAI_CHAT_COMPLETIONS_URL,
    adapterId: adapter.id,
    generateOk: result.ok,
    generateReason: result.ok ? null : result.reason,
    fetchCalled,
  }),
);
