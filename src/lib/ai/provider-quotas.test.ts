import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProviderQuotaAvailable,
  recordProviderUsage,
  resetProviderUsageForTests,
} from "./provider-quotas";

test("provider quotas are tracked separately and fail closed", () => {
  resetProviderUsageForTests();
  const first = assertProviderQuotaAvailable({ providerId: "openai", additionalTokens: 10 });
  assert.equal(first.ok, true);
  recordProviderUsage({
    providerId: "openai",
    model: "gpt-5-mini",
    inputTokens: 5,
    outputTokens: 5,
    estimated: false,
    detail: "fixture",
  });
  const groq = assertProviderQuotaAvailable({ providerId: "groq", additionalTokens: 10 });
  assert.equal(groq.ok, true);
  // Exhaust openai request budget deterministically for the fixture ceiling.
  for (let i = 0; i < 200; i += 1) {
    recordProviderUsage({
      providerId: "openai",
      model: "gpt-5-mini",
      inputTokens: 1,
      outputTokens: 0,
      estimated: true,
      detail: `fill-${i}`,
    });
  }
  const denied = assertProviderQuotaAvailable({ providerId: "openai" });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "QUOTA_EXCEEDED");
  const stillGroq = assertProviderQuotaAvailable({ providerId: "groq" });
  assert.equal(stillGroq.ok, true);
});
