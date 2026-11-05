import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCodingProvider } from "./adapter";
import { cleanupWorkspace } from "./materialize";
import { createMockCodingProvider } from "./mock-provider";
import { assertNoWeakerPrivacyFallback, classifyObjectiveText } from "./privacy";
import { isCodegenLiveEnabled, resolveCodingProviderConfig } from "./provider-config";
import { validateProposals, validateRelativeProposalPath } from "./security";
import { makeApprovedCodingAuth } from "./test-fixtures";
import { DEFAULT_CODING_BUDGET } from "./types";
import { runSupervisedMockCodegen } from "./workflow";

test("privacy fail-closed and no weaker fallback", () => {
  assert.equal(classifyObjectiveText("public marketing blurb"), "PUBLIC");
  assert.equal(classifyObjectiveText("customer pii export"), "CONFIDENTIAL");
  assert.equal(classifyObjectiveText("production secret vault"), "RESTRICTED");
  assert.equal(
    assertNoWeakerPrivacyFallback({
      required: "INTERNAL",
      selected: { maxClassification: "INTERNAL", privacyRank: 10 },
    }).ok,
    true,
  );
  assert.equal(
    assertNoWeakerPrivacyFallback({
      required: "RESTRICTED",
      selected: { maxClassification: "INTERNAL", privacyRank: 10 },
    }).ok,
    false,
  );
  assert.equal(
    assertNoWeakerPrivacyFallback({
      required: "INTERNAL",
      selected: { maxClassification: "CONFIDENTIAL", privacyRank: 7 },
      candidatesTried: [{ maxClassification: "INTERNAL", privacyRank: 4 }],
    }).ok,
    false,
  );
});

test("live coding providers stay disabled; mock resolves", () => {
  assert.equal(isCodegenLiveEnabled({}), false);
  assert.equal(resolveCodingProviderConfig("openai").ok, false);
  assert.equal(resolveCodingProvider({ providerId: "mock", requiredClassification: "INTERNAL" }).ok, true);
  assert.equal(resolveCodingProvider({ providerId: "openai", requiredClassification: "INTERNAL" }).ok, false);
});

test("unsafe paths and secrets rejected", () => {
  assert.equal(validateRelativeProposalPath("../etc/passwd", ["generated"]).ok, false);
  assert.equal(validateRelativeProposalPath("generated/.env", ["generated"]).ok, false);
  assert.equal(validateRelativeProposalPath("generated/ok.js", ["generated"]).ok, true);
  const bad = validateProposals(
    [{ relativePath: "generated/x.js", op: "CREATE", content: "const k='sk-abcdefghijklmnopqrstuvwxyz'" }],
    ["generated"],
    10_000,
  );
  assert.equal(bad.ok, false);
});

test("mock provider generates vehicle comparison proposals", async () => {
  const provider = createMockCodingProvider();
  const auth = makeApprovedCodingAuth();
  const result = await provider.generate({
    objective: "Generate a responsive vehicle comparison component with three dummy vehicles.",
    ownerId: auth.ownerId,
    projectId: auth.projectId,
    authorizationId: auth.id,
    environmentLabel: auth.environmentLabel,
    classification: "INTERNAL",
    allowedRelativeRoots: ["generated"],
    budget: DEFAULT_CODING_BUDGET,
    idempotencyKey: "mock-1",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.attribution.mode, "MOCK_GENERATION");
  assert.ok(result.proposals.some((p) => p.relativePath.endsWith("index.html")));
  assert.equal(result.proposals.filter((p) => p.relativePath.includes("vehicle-comparison")).length, 4);
});

test("supervised workflow requires approval and awaits founder review", async () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "ghost-codegen-"));

  const missing = await runSupervisedMockCodegen({
    authorization: null,
    ownerId: "o",
    projectId: "p",
    objective: "Generate a responsive vehicle comparison component with three dummy vehicles.",
    classification: "INTERNAL",
    workspaceRoot,
  });
  assert.equal(missing.ok, false);

  const pending = makeApprovedCodingAuth({ status: "PENDING" });
  const pendingRun = await runSupervisedMockCodegen({
    authorization: pending,
    ownerId: pending.ownerId,
    projectId: pending.projectId,
    objective: "Generate a responsive vehicle comparison component with three dummy vehicles.",
    classification: "INTERNAL",
    workspaceRoot,
  });
  assert.equal(pendingRun.ok, false);

  const auth = makeApprovedCodingAuth();
  const run = await runSupervisedMockCodegen({
    authorization: auth,
    ownerId: auth.ownerId,
    projectId: auth.projectId,
    objective: "Generate a responsive vehicle comparison component with three dummy vehicles.",
    classification: "INTERNAL",
    workspaceRoot,
  });
  assert.equal(run.ok, true);
  if (!run.ok) return;
  assert.equal(run.run.attributionMode, "MOCK_GENERATION");
  assert.equal(run.run.founderReviewStatus, "AWAITING_FOUNDER_REVIEW");
  assert.equal(run.run.deploymentAttempted, false);
  assert.equal(run.run.generation.ok, true);
  assert.ok(run.run.materialize?.ok);
  assert.ok(run.run.checkpoints.length >= 5);
  if (run.run.materialize?.ok) cleanupWorkspace(run.run.materialize.workspacePath);
});

test("failure cases fail closed", async () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "ghost-codegen-fail-"));

  const expired = makeApprovedCodingAuth({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const expiredRun = await runSupervisedMockCodegen({
    authorization: expired,
    ownerId: expired.ownerId,
    projectId: expired.projectId,
    objective: "Generate a responsive vehicle comparison component with three dummy vehicles.",
    classification: "INTERNAL",
    workspaceRoot,
  });
  assert.equal(expiredRun.ok, false);

  const revoked = makeApprovedCodingAuth({ status: "REVOKED" });
  const revokedRun = await runSupervisedMockCodegen({
    authorization: revoked,
    ownerId: revoked.ownerId,
    projectId: revoked.projectId,
    objective: "Generate a responsive vehicle comparison component with three dummy vehicles.",
    classification: "INTERNAL",
    workspaceRoot,
  });
  assert.equal(revokedRun.ok, false);

  const auth = makeApprovedCodingAuth();
  const crossOwner = await runSupervisedMockCodegen({
    authorization: auth,
    ownerId: "00000000-0000-4000-8000-000000000099",
    projectId: auth.projectId,
    objective: "Generate a responsive vehicle comparison component with three dummy vehicles.",
    classification: "INTERNAL",
    workspaceRoot,
  });
  assert.equal(crossOwner.ok, false);

  const privacy = await runSupervisedMockCodegen({
    authorization: auth,
    ownerId: auth.ownerId,
    projectId: auth.projectId,
    objective: "Generate a responsive vehicle comparison component with three dummy vehicles.",
    classification: "RESTRICTED",
    workspaceRoot,
  });
  assert.equal(privacy.ok, false);

  const unavailAuth = makeApprovedCodingAuth({ objective: "provider unavailable" });
  const unavailRun = await runSupervisedMockCodegen({
    authorization: unavailAuth,
    ownerId: unavailAuth.ownerId,
    projectId: unavailAuth.projectId,
    objective: "provider unavailable",
    classification: "INTERNAL",
    workspaceRoot,
  });
  assert.equal(unavailRun.ok, true);
  if (unavailRun.ok) {
    assert.equal(unavailRun.run.generation.ok, false);
    if (!unavailRun.run.generation.ok) {
      assert.equal(unavailRun.run.generation.reason, "PROVIDER_UNAVAILABLE");
    }
  }

  const deployAuth = makeApprovedCodingAuth();
  assert.equal(
    (await import("@/lib/agent-runtime/authorization-kind")).developmentApprovalGrantsDeployment(
      "agent_task.develop",
      "DEPLOYMENT",
    ),
    false,
  );
  void deployAuth;
});
