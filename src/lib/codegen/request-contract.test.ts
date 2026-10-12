import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCodegenTaskContract,
  describeEvidenceAttribution,
  encodeCodegenScopeFragment,
  isCodegenPilotScope,
  listVerifiedCodingOptions,
  parseCodegenScopeFragment,
  parseCodingOptionValue,
} from "./request-contract";

test("verified coding options include mock and allowlisted models only", () => {
  const options = listVerifiedCodingOptions({ GHOST_CODEGEN_LIVE_ENABLED: undefined });
  assert.ok(options.some((o) => o.providerId === "mock" && o.runnableNow));
  assert.ok(options.some((o) => o.providerId === "openai" && o.model === "gpt-5-mini"));
  assert.ok(!options.some((o) => o.providerId === "anthropic"));
  assert.ok(!options.some((o) => o.providerId === "groq"));
  assert.ok(options.every((o) => !o.liveReady));
});

test("unverified provider/model rejected", () => {
  const bad = parseCodingOptionValue("openai:gpt-totally-fake");
  assert.equal(bad.ok, false);
});

test("codegen contract encodes fingerprint fragment with deploy=false and disabled dispatch", () => {
  const built = buildCodegenTaskContract({
    providerId: "openai",
    model: "gpt-5-mini",
    maxSpendUsd: 1,
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.contract.dispatch, "DISABLED");
  assert.equal(built.contract.maxSpendCents, 100);
  const frag = encodeCodegenScopeFragment(built.contract);
  assert.match(frag, /codegen=pilot03/);
  assert.match(frag, /provider=openai/);
  assert.match(frag, /model=gpt-5-mini/);
  assert.match(frag, /dispatch=DISABLED/);
  assert.match(frag, /deploy=false/);
  assert.equal(isCodegenPilotScope(`repo:x@y|obj:z|${frag}`), true);
  const parsed = parseCodegenScopeFragment(`repo:x@y|obj:z|${frag}`);
  assert.ok(parsed);
  assert.equal(parsed?.providerId, "openai");
});

test("mock contract is MOCK_ONLY with zero estimate", () => {
  const built = buildCodegenTaskContract({ providerId: "mock", model: "mock-codegen-v1" });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.contract.dispatch, "MOCK_ONLY");
  assert.equal(built.contract.estimatedCostCents, 0);
});

test("evidence attribution separates mock codegen from simulated remote-dev", () => {
  const mock = describeEvidenceAttribution({
    actionScope: "repo:a@b|obj:c|codegen=pilot03;provider=mock;model=mock-codegen-v1",
    simulationLabel: "NONE",
    hasLiveUsage: false,
  });
  assert.equal(mock.mode, "MOCK_GENERATION");

  const sim = describeEvidenceAttribution({
    actionScope: "repo:a@b|obj:c",
    simulationLabel: "SIMULATED",
    hasLiveUsage: false,
  });
  assert.equal(sim.mode, "SIMULATED_REMOTE_DEV");

  const durable = describeEvidenceAttribution({
    actionScope: "repo:a@b|obj:pilot-02",
    simulationLabel: "NONE",
    hasLiveUsage: false,
  });
  assert.equal(durable.mode, "DURABLE_NON_CODEGEN");
});

test("development-tasks page wires Pilot 03 fields and separates MOCK vs LIVE", () => {
  const page = readFileSync(
    new URL("../../app/(workspace)/development-tasks/page.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(page.includes("Pilot03RequestFields"));
  assert.ok(page.includes("listVerifiedCodingOptions"));
  assert.ok(page.includes("loadProjectAllowanceSnapshot"));
  assert.ok(page.includes("GHOST_CODEGEN_LIVE_ENABLED"));
  assert.ok(page.includes("MOCK_GENERATION"));
  assert.ok(page.includes("LIVE_PROVIDER"));
  assert.ok(page.includes("executeDurableCodegenLiveWorkflow"));
  assert.ok(page.includes('data-live-entrypoint="disabled"'));
  assert.ok(!page.includes('liveDispatch" value="1"'));
});

test("actions refuse liveDispatch=1 on mock path and gate separate live entrypoint", () => {
  const actions = readFileSync(new URL("../remote-development/actions.ts", import.meta.url), "utf8");
  assert.ok(actions.includes("liveDispatchRequested"));
  assert.ok(actions.includes("Live codegen dispatch is disabled"));
  assert.ok(actions.includes("executeDurableCodegenLiveWorkflow"));
  assert.ok(actions.includes("LIVE_OPENAI_GPT5MINI_USD1"));
  assert.ok(actions.includes("CODEGEN_PILOT_03"));
  assert.ok(actions.includes("encodeCodegenScopeFragment"));
});
