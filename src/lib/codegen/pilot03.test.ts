import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MemoryAllowanceLedger } from "@/lib/allowance";
import { resolveCodingProvider } from "./adapter";
import { makeApprovedCodingAuth } from "./test-fixtures";
import { PILOT_03_OBJECTIVE, runPilot03MockPipeline } from "./pilot03-pipeline";
import { createOpenAiCodingAdapter } from "./live-adapters";

test("live adapters refuse HTTP and stay disabled", async () => {
  const openai = createOpenAiCodingAdapter();
  const auth = makeApprovedCodingAuth({ objective: PILOT_03_OBJECTIVE });
  const result = await openai.generate({
    objective: PILOT_03_OBJECTIVE,
    ownerId: auth.ownerId,
    projectId: auth.projectId,
    authorizationId: auth.id,
    environmentLabel: auth.environmentLabel,
    classification: "PUBLIC",
    allowedRelativeRoots: ["generated"],
    budget: {
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      maxCostUsd: 1,
      maxDurationMs: 10_000,
      maxSteps: 2,
      maxRetries: 0,
      maxOutputBytes: 10_000,
    },
    idempotencyKey: "live-probe",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.attribution.mode, "DISABLED");

  const resolved = resolveCodingProvider({
    providerId: "openai",
    requiredClassification: "PUBLIC",
    returnDisabledLiveAdapter: true,
  });
  assert.equal(resolved.ok, true);
});

test("pilot 03 mock pipeline reserves, generates, reconciles", async () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "ghost-p03-"));
  const ownerId = randomUUID();
  const projectId = randomUUID();
  const ledger = new MemoryAllowanceLedger();
  ledger.setAllowance({ ownerId, projectId, allowanceCents: 2000 });
  const auth = makeApprovedCodingAuth({
    ownerId,
    projectId,
    objective: PILOT_03_OBJECTIVE,
    environmentLabel: "LOCAL_PILOT_03",
  });

  const missing = await runPilot03MockPipeline({
    authorization: null,
    ownerId,
    projectId,
    ledger,
    workspaceRoot,
  });
  assert.equal(missing.ok, false);

  const insufficient = new MemoryAllowanceLedger();
  insufficient.setAllowance({ ownerId, projectId, allowanceCents: 10 });
  const low = await runPilot03MockPipeline({
    authorization: auth,
    ownerId,
    projectId,
    ledger: insufficient,
    workspaceRoot,
    estimatedCents: 100,
  });
  assert.equal(low.ok, false);

  const run = await runPilot03MockPipeline({
    authorization: auth,
    ownerId,
    projectId,
    ledger,
    workspaceRoot,
    estimatedCents: 100,
    actualCents: 0,
  });
  assert.equal(run.ok, true);
  if (!run.ok) return;
  assert.equal(run.mode, "MOCK_GENERATION");
  assert.equal(run.founderReviewStatus, "AWAITING_FOUNDER_REVIEW");
  assert.equal(run.liveCalls, 0);
  assert.equal(run.deploymentAttempted, false);
  assert.ok(run.materializeSha256);

  const revoked = makeApprovedCodingAuth({
    ownerId,
    projectId,
    objective: PILOT_03_OBJECTIVE,
    status: "REVOKED",
    environmentLabel: "LOCAL_PILOT_03",
  });
  const denied = await runPilot03MockPipeline({
    authorization: revoked,
    ownerId,
    projectId,
    ledger,
    workspaceRoot,
  });
  assert.equal(denied.ok, false);
});
