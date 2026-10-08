import assert from "node:assert/strict";
import test from "node:test";
import type { GhostContext } from "../brain/types";
import {
  armNoLiveProviderCallsForReleaseGate,
  assertOutboundLiveModelCallAllowed,
  brandMockFetch,
  isLiveProviderTestAuthorized,
  isNoLiveProviderCallsMode,
} from "./live-provider-mode";
import { ProviderError, resolveModelProvider } from "./provider";

const EMPTY: GhostContext = {
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
};

test("NO_LIVE_PROVIDER_CALLS blocks default-fetch outbound model HTTP", async () => {
  const env = {
    GHOST_NO_LIVE_PROVIDER_CALLS: "1",
    GHOST_MODEL_PROVIDER: "groq",
    GROQ_API_KEY: "gsk_testkeyvalue000000000000000000000000000000",
  };
  let outbound = 0;
  const unbrandedTracking = async (...args: Parameters<typeof fetch>) => {
    outbound += 1;
    return fetch(...args);
  };
  const sneaky = resolveModelProvider(env, unbrandedTracking as typeof fetch);
  assert.ok(sneaky.provider);
  await assert.rejects(
    () =>
      sneaky.provider!.complete({
        system: "x",
        context: EMPTY,
        messages: [{ role: "user", content: "x" }],
      }),
    (error: unknown) => error instanceof ProviderError && /NO_LIVE_PROVIDER_CALLS/.test(error.message),
  );
  const liveSelection = resolveModelProvider(env);
  assert.ok(liveSelection.provider);
  await assert.rejects(
    () =>
      liveSelection.provider!.complete({
        system: "x",
        context: EMPTY,
        messages: [{ role: "user", content: "x" }],
      }),
    (error: unknown) => error instanceof ProviderError && /NO_LIVE_PROVIDER_CALLS/.test(error.message),
  );
  assert.equal(outbound, 0);
  assert.equal(isNoLiveProviderCallsMode(env), true);
});

test("branded mock fetch still allowed under NO_LIVE for synthetic probes", async () => {
  const env = {
    GHOST_NO_LIVE_PROVIDER_CALLS: "1",
    GHOST_MODEL_PROVIDER: "groq",
    GROQ_API_KEY: "probe-invalid",
  };
  let calls = 0;
  const mockFetch = brandMockFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: "invalid_api_key", message: "probe" } }), { status: 401 });
  });
  assertOutboundLiveModelCallAllowed(env, mockFetch);
  const selection = resolveModelProvider(env, mockFetch);
  await assert.rejects(() =>
    selection.provider!.complete({
      system: "probe",
      context: EMPTY,
      messages: [{ role: "user", content: "probe" }],
    }),
  );
  assert.equal(calls, 1);
});

test("live provider test authorization requires explicit flag without NO_LIVE", () => {
  assert.equal(isLiveProviderTestAuthorized({ GHOST_LIVE_PROVIDER_TEST: "1" }), true);
  assert.equal(
    isLiveProviderTestAuthorized({ GHOST_LIVE_PROVIDER_TEST: "1", GHOST_NO_LIVE_PROVIDER_CALLS: "1" }),
    false,
  );
  const env: Record<string, string | undefined> = {};
  armNoLiveProviderCallsForReleaseGate(env);
  assert.equal(env.GHOST_NO_LIVE_PROVIDER_CALLS, "1");
});
