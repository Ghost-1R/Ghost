import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "./types";
import { providerEligibleForClassification, routeProviderForClassification } from "./classification-router";

const stub: ModelProvider = {
  id: "groq",
  async complete() {
    return { content: "unused", provider: "groq", model: "stub" };
  },
};

test("restricted classification fails closed without weaker fallback", () => {
  const routed = routeProviderForClassification({
    classification: "RESTRICTED",
    selection: {
      status: "READY",
      providerId: "groq",
      model: "openai/gpt-oss-120b",
      paid: false,
      detail: "Groq ready",
      provider: stub,
    },
  });
  assert.equal(routed.ok, false);
  if (!routed.ok) assert.equal(routed.reason, "PRIVACY_MISMATCH");
});

test("missing credentials are setup-needed, not a successful run", () => {
  const routed = routeProviderForClassification({
    classification: "PUBLIC",
    env: { GHOST_MODEL_PROVIDER: "openai", OPENAI_API_KEY: "" },
  });
  assert.equal(routed.ok, false);
  if (!routed.ok) {
    assert.equal(routed.reason, "NOT_CONFIGURED");
    assert.match(routed.message, /OPENAI_API_KEY|not set|configured/i);
  }
});

test("eligibility is explicit per provider", () => {
  assert.equal(providerEligibleForClassification("openai", "PUBLIC"), true);
  assert.equal(providerEligibleForClassification("openrouter", "CONFIDENTIAL"), false);
});
