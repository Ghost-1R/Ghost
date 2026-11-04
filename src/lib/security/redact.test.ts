import assert from "node:assert/strict";
import test from "node:test";
import { describeProviderStatus, ProviderError, resolveModelProvider } from "../ai/provider";
import { sanitizeOutput } from "../inspector/sanitize";
import { customerHandoff } from "../presentation/gate";
import { logExcerpt, outputHash } from "../presentation/ledger";
import { publicReason } from "../presentation/remote";
import { containsSecretMaterial } from "../repository/exclude";
import { redactSecrets } from "./redact";

// Synthetic keys are assembled at runtime so no key-shaped literal exists in the source.
const body = "SyntheticFakeKeyValue0000000000000000000000000000";
const FAKE = {
  openai: ["sk", "proj", body].join("-"),
  openaiLegacy: ["sk", body].join("-"),
  groq: ["gsk", body].join("_"),
  xai: ["xai", body].join("-"),
};
const KEYS = Object.entries(FAKE);

function assertClean(label: string, output: string) {
  for (const [name, key] of KEYS) {
    assert.equal(output.includes(key), false, `${label} leaked the ${name} key`);
    assert.equal(output.includes(body), false, `${label} leaked part of the ${name} key`);
  }
}

test("the shared redactor removes OpenAI, Groq, and xAI keys", () => {
  for (const [name, key] of KEYS) {
    const output = redactSecrets(`before ${key} after`);
    assert.equal(output, "before [redacted] after", name);
  }
  assert.equal(redactSecrets(`authorization: Bearer ${FAKE.groq}`), "authorization: Bearer [redacted]");
  assert.equal(redactSecrets("task-management and ask-scope stay readable"), "task-management and ask-scope stay readable");
});

test("inspector output and evidence excerpts redact every provider key", () => {
  const output = KEYS.map(([name, key]) => `${name.toUpperCase()}_API_KEY=${key}\nlog ${key}`).join("\n");
  assertClean("sanitizeOutput", sanitizeOutput(output));
  assertClean("logExcerpt", logExcerpt(output));
  assert.equal(outputHash(output), outputHash(output.replaceAll(FAKE.groq, FAKE.xai)));
});

test("presentation handoff and remote rejection reasons redact every provider key", () => {
  const handoff = customerHandoff({
    result: "READY",
    current: true,
    built: KEYS.map(([, key]) => `built with ${key}`),
    completedRequirements: [],
    flows: [],
    responsive: [],
    deployment: null,
    limitations: [],
    demo: [],
  });
  assert.ok(handoff);
  assertClean("customerHandoff", handoff);
  for (const [name, key] of KEYS) {
    assertClean(`publicReason ${name}`, publicReason(`insert failed near ${key}`));
  }
});

test("provider failures and status notices redact every provider key", async () => {
  for (const [name, key] of KEYS) {
    const selection = resolveModelProvider(
      { GHOST_MODEL_PROVIDER: "groq", GROQ_API_KEY: FAKE.groq },
      async () => new Response(JSON.stringify({ error: { message: `Invalid key ${key}` } }), { status: 401 }),
    );
    await assert.rejects(
      selection.provider!.complete({
        system: "s",
        context: {
          scope: "global",
          project: null,
          projects: [],
          milestone: null,
          requirements: [],
          decisions: [],
          constraints: [],
          blockers: [],
          nextActions: [],
          verification: [],
          founderRules: [],
          truncated: false,
        },
        messages: [{ role: "user", content: "hi" }],
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assertClean(`ProviderError ${name}`, error.message);
        assertClean(
          `describeProviderStatus ${name}`,
          describeProviderStatus({ status: error.status, providerId: error.providerId, model: error.model, detail: `${error.message} ${key}` }),
        );
        return true;
      },
    );
  }
});

test("repository snapshots refuse text that carries any provider key", () => {
  for (const [name, key] of KEYS) {
    assert.equal(containsSecretMaterial(`const value = "${key}";`), true, name);
  }
});
