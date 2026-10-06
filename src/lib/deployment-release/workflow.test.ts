import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGAL_RELEASE_TRANSITIONS,
  canTransitionDeployment,
  canTransitionRelease,
  computeDeploymentReadiness,
  computeProductionVerification,
  containsSecretLikeText,
  evaluateReleaseBundle,
  nextHumanId,
  rejectSecretConfigValue,
  rejectSecretEvidenceReference,
  shasMatch,
  suggestReleaseNextAction,
  type DeploymentReadinessInput,
  type ProductionVerificationInput,
} from "./workflow";
import type { ReleaseBundle, ReleaseStatus } from "./types";
import { RELEASE_STATUSES } from "./types";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("release lifecycle transitions match the RPC exactly", () => {
  assert.deepEqual(LEGAL_RELEASE_TRANSITIONS.DRAFT, ["DEPLOYMENT_READY"]);
  assert.deepEqual(LEGAL_RELEASE_TRANSITIONS.DEPLOYMENT_READY, ["DEPLOYING", "DRAFT"]);
  assert.deepEqual(LEGAL_RELEASE_TRANSITIONS.DEPLOYING, ["DEPLOYED", "DEPLOYMENT_READY"]);
  assert.deepEqual(LEGAL_RELEASE_TRANSITIONS.DEPLOYED, ["PRODUCTION_VERIFICATION", "DEPLOYING"]);
  assert.deepEqual(LEGAL_RELEASE_TRANSITIONS.PRODUCTION_VERIFICATION, ["PRODUCTION_VERIFIED", "DEPLOYED"]);
  assert.deepEqual(LEGAL_RELEASE_TRANSITIONS.PRODUCTION_VERIFIED, ["PRODUCTION_VERIFICATION", "DEPLOYED"]);
  assert.equal(canTransitionRelease("DRAFT", "DEPLOYMENT_READY"), true);
  assert.equal(canTransitionRelease("DRAFT", "DEPLOYED"), false);
  assert.equal(canTransitionRelease("DEPLOYMENT_READY", "DEPLOYING"), true);
  assert.equal(canTransitionRelease("DEPLOYING", "PRODUCTION_VERIFIED"), false);
  assert.equal(canTransitionRelease("DEPLOYED", "PRODUCTION_VERIFIED"), false);
  assert.equal(canTransitionRelease("PRODUCTION_VERIFICATION", "PRODUCTION_VERIFIED"), true);
  assert.equal(canTransitionRelease("PRODUCTION_VERIFIED", "DRAFT"), false);
});

test("a release can never reach itself and every status has an exit", () => {
  for (const status of RELEASE_STATUSES) {
    assert.equal(canTransitionRelease(status, status), false);
    assert.ok(LEGAL_RELEASE_TRANSITIONS[status].length > 0);
  }
});

test("deployment attempt transitions stay finite; failed attempts are preserved", () => {
  assert.equal(canTransitionDeployment("QUEUED", "IN_PROGRESS"), true);
  assert.equal(canTransitionDeployment("QUEUED", "CANCELLED"), true);
  assert.equal(canTransitionDeployment("QUEUED", "SUCCEEDED"), false);
  assert.equal(canTransitionDeployment("IN_PROGRESS", "SUCCEEDED"), true);
  assert.equal(canTransitionDeployment("IN_PROGRESS", "FAILED"), true);
  assert.equal(canTransitionDeployment("SUCCEEDED", "ROLLED_BACK"), true);
  assert.equal(canTransitionDeployment("FAILED", "SUCCEEDED"), false);
  assert.equal(canTransitionDeployment("FAILED", "QUEUED"), false);
  assert.equal(canTransitionDeployment("CANCELLED", "IN_PROGRESS"), false);
});

test("human ids increment for REL and DEP", () => {
  assert.equal(nextHumanId("REL", []), "REL-001");
  assert.equal(nextHumanId("REL", ["REL-001", "REL-004"]), "REL-005");
  assert.equal(nextHumanId("DEP", ["DEP-009"]), "DEP-010");
  assert.equal(nextHumanId("DEP", ["REL-007"]), "DEP-001");
});

test("shasMatch normalizes case and whitespace and requires non-empty values", () => {
  assert.equal(shasMatch(SHA, SHA.toUpperCase()), true);
  assert.equal(shasMatch(`  ${SHA} `, SHA), true);
  assert.equal(shasMatch(SHA, "fedcba9876543210fedcba9876543210fedcba98"), false);
  assert.equal(shasMatch("", ""), false);
  assert.equal(shasMatch(SHA, ""), false);
  assert.equal(shasMatch(null, SHA), false);
});

test("secret-looking evidence references are rejected but commit SHAs are allowed", () => {
  assert.equal(rejectSecretEvidenceReference("render:dep-abc123").ok, true);
  assert.equal(rejectSecretEvidenceReference(`live-sha:${SHA}`).ok, true);
  assert.equal(rejectSecretEvidenceReference("sk-abcdefghijklmnopqrstuvwxyz").ok, false);
  assert.equal(rejectSecretEvidenceReference("gsk_abcdefghijklmnop").ok, false);
  assert.equal(rejectSecretEvidenceReference("").ok, false);
  assert.equal(containsSecretLikeText("-----BEGIN RSA PRIVATE KEY-----"), true);
});

test("config rows reject values: names with '=' and key material in notes", () => {
  assert.equal(rejectSecretConfigValue({ variableName: "GROQ_API_KEY" }).ok, true);
  assert.equal(rejectSecretConfigValue({ variableName: "GROQ_API_KEY", note: "Set in Render dashboard." }).ok, true);
  assert.equal(rejectSecretConfigValue({ variableName: "GROQ_API_KEY=gsk_abc123" }).ok, false);
  assert.equal(rejectSecretConfigValue({ variableName: "GROQ API KEY" }).ok, false);
  assert.equal(rejectSecretConfigValue({ variableName: "" }).ok, false);
  assert.equal(rejectSecretConfigValue({ variableName: "GROQ_API_KEY", note: "key=gsk_realvalue123" }).ok, false);
  assert.equal(rejectSecretConfigValue({ variableName: "GROQ_API_KEY", note: "eyJhbGciOiJIUzI1NiJ9" }).ok, false);
  assert.equal(
    rejectSecretConfigValue({ variableName: "TLS_CERT", note: "-----BEGIN PRIVATE KEY-----" }).ok,
    false,
  );
});

function readyInput(overrides: Partial<DeploymentReadinessInput> = {}): DeploymentReadinessInput {
  return {
    verificationStatus: "VERIFIED",
    sourceCommitSha: SHA,
    environment: { name: "Production", environmentType: "PRODUCTION" },
    configRequirements: [{ variableName: "GROQ_API_KEY", isRequired: true, presence: "PRESENT" }],
    migrations: [{ migrationPath: "supabase/migrations/a.sql", isRequired: true, status: "APPLIED" }],
    deploymentSequence: ["preflight", "deploy"],
    rollbackStrategy: "Redeploy the last verified commit.",
    openDecisions: 0,
    manualActions: [{ title: "Set env", isRequired: true, status: "COMPLETED" }],
    ...overrides,
  };
}

test("deployment readiness passes only when every gap is closed", () => {
  const result = computeDeploymentReadiness(readyInput());
  assert.equal(result.ready, true);
  assert.equal(result.gaps.length, 0);
  assert.ok(result.reasons.some((reason) => reason.includes("not deployed")));
});

test("deployment readiness reports each gap", () => {
  const codes = (input: Partial<DeploymentReadinessInput>) =>
    computeDeploymentReadiness(readyInput(input)).gaps.map((gap) => gap.code);

  assert.ok(codes({ verificationStatus: "TESTING" }).includes("VERIFICATION_NOT_VERIFIED"));
  assert.ok(codes({ verificationStatus: null }).includes("VERIFICATION_NOT_VERIFIED"));
  assert.ok(codes({ sourceCommitSha: "  " }).includes("NO_SOURCE_SHA"));
  assert.ok(codes({ environment: null }).includes("NO_ENVIRONMENT"));
  assert.ok(
    codes({ configRequirements: [{ variableName: "GROQ_API_KEY", isRequired: true, presence: "UNKNOWN" }] }).includes(
      "CONFIG_GROQ_API_KEY",
    ),
  );
  assert.ok(
    codes({ configRequirements: [{ variableName: "GROQ_API_KEY", isRequired: true, presence: "MISSING" }] }).includes(
      "CONFIG_GROQ_API_KEY",
    ),
  );
  assert.deepEqual(
    codes({ configRequirements: [{ variableName: "OPTIONAL", isRequired: false, presence: "UNKNOWN" }] }),
    [],
  );
  assert.ok(
    codes({ migrations: [{ migrationPath: "m.sql", isRequired: true, status: "PENDING" }] }).includes("MIGRATION_m.sql"),
  );
  assert.ok(
    codes({ migrations: [{ migrationPath: "m.sql", isRequired: true, status: "FAILED" }] }).includes("MIGRATION_m.sql"),
  );
  assert.deepEqual(
    codes({ migrations: [{ migrationPath: "m.sql", isRequired: true, status: "NOT_REQUIRED" }] }),
    [],
  );
  assert.ok(codes({ deploymentSequence: [] }).includes("NO_SEQUENCE"));
  assert.ok(codes({ rollbackStrategy: " " }).includes("NO_ROLLBACK_STRATEGY"));
  assert.ok(codes({ openDecisions: 2 }).includes("OPEN_DECISIONS"));
  assert.ok(
    codes({ manualActions: [{ title: "Set env", isRequired: true, status: "PENDING" }] }).includes("MANUAL_Set env"),
  );
  assert.deepEqual(codes({ manualActions: [{ title: "Optional", isRequired: false, status: "PENDING" }] }), []);
});

test("VERIFIED alone does not make a release deployment-ready", () => {
  const result = computeDeploymentReadiness(
    readyInput({
      configRequirements: [{ variableName: "GROQ_API_KEY", isRequired: true, presence: "UNKNOWN" }],
    }),
  );
  assert.equal(result.ready, false);
});

function productionInput(overrides: Partial<ProductionVerificationInput> = {}): ProductionVerificationInput {
  return {
    deployments: [
      {
        id: "d1",
        humanId: "DEP-001",
        status: "SUCCEEDED",
        expectedCommitSha: SHA,
        liveCommitSha: SHA,
        inspectorResult: "PASSED",
        presentationResult: "READY",
        createdAt: "2026-10-06T00:00:00Z",
      },
    ],
    healthChecks: [{ deploymentId: "d1", checkName: "api health", status: "PASSED" }],
    openDecisions: 0,
    ...overrides,
  };
}

test("production verification passes with a succeeded deployment, SHA match, health, and gates", () => {
  const result = computeProductionVerification(productionInput());
  assert.equal(result.productionVerified, true);
  assert.deepEqual(result.warnings, []);
});

test("production verification needs a SUCCEEDED deployment", () => {
  const failed = computeProductionVerification(
    productionInput({
      deployments: [{ ...productionInput().deployments[0], status: "FAILED" }],
    }),
  );
  assert.equal(failed.productionVerified, false);
  assert.ok(failed.gaps.some((gap) => gap.code === "NO_SUCCEEDED_DEPLOYMENT"));
  assert.equal(computeProductionVerification(productionInput({ deployments: [] })).productionVerified, false);
});

test("expected SHA must match live SHA for production verification", () => {
  const base = productionInput().deployments[0];
  const mismatch = computeProductionVerification(
    productionInput({ deployments: [{ ...base, liveCommitSha: "fedcba9876543210fedcba9876543210fedcba98" }] }),
  );
  assert.ok(mismatch.gaps.some((gap) => gap.code === "SHA_MISMATCH"));
  const noLive = computeProductionVerification(productionInput({ deployments: [{ ...base, liveCommitSha: "" }] }));
  assert.ok(noLive.gaps.some((gap) => gap.code === "NO_LIVE_SHA"));
  const noExpected = computeProductionVerification(
    productionInput({ deployments: [{ ...base, expectedCommitSha: "" }] }),
  );
  assert.ok(noExpected.gaps.some((gap) => gap.code === "NO_EXPECTED_SHA"));
  const upper = computeProductionVerification(
    productionInput({ deployments: [{ ...base, liveCommitSha: SHA.toUpperCase() }] }),
  );
  assert.equal(upper.productionVerified, true);
});

test("health checks must be PASSED; skipped checks are not required", () => {
  const failing = computeProductionVerification(
    productionInput({ healthChecks: [{ deploymentId: "d1", checkName: "api health", status: "FAILED" }] }),
  );
  assert.ok(failing.gaps.some((gap) => gap.code === "HEALTH_api health"));
  const pending = computeProductionVerification(
    productionInput({ healthChecks: [{ deploymentId: "d1", checkName: "api health", status: "PENDING" }] }),
  );
  assert.equal(pending.productionVerified, false);
  const none = computeProductionVerification(productionInput({ healthChecks: [] }));
  assert.ok(none.gaps.some((gap) => gap.code === "NO_HEALTH_CHECKS"));
  const skipped = computeProductionVerification(
    productionInput({
      healthChecks: [
        { deploymentId: "d1", checkName: "api health", status: "PASSED" },
        { deploymentId: "d1", checkName: "optional", status: "SKIPPED" },
      ],
    }),
  );
  assert.equal(skipped.productionVerified, true);
  const otherDeployment = computeProductionVerification(
    productionInput({ healthChecks: [{ deploymentId: "other", checkName: "api health", status: "PASSED" }] }),
  );
  assert.ok(otherDeployment.gaps.some((gap) => gap.code === "NO_HEALTH_CHECKS"));
});

test("inspector result must be PASS/READY style", () => {
  const base = productionInput().deployments[0];
  assert.equal(
    computeProductionVerification(productionInput({ deployments: [{ ...base, inspectorResult: "PASS" }] })).productionVerified,
    true,
  );
  assert.equal(
    computeProductionVerification(productionInput({ deployments: [{ ...base, inspectorResult: "READY" }] })).productionVerified,
    true,
  );
  const failed = computeProductionVerification(productionInput({ deployments: [{ ...base, inspectorResult: "FAILED" }] }));
  assert.ok(failed.gaps.some((gap) => gap.code === "INSPECTOR_NOT_PASS"));
  const empty = computeProductionVerification(productionInput({ deployments: [{ ...base, inspectorResult: "" }] }));
  assert.ok(empty.gaps.some((gap) => gap.code === "NO_INSPECTOR_RESULT"));
});

test("presentation NOT_READY blocks; READY_WITH_GAPS is allowed with a warning", () => {
  const base = productionInput().deployments[0];
  const blocked = computeProductionVerification(
    productionInput({ deployments: [{ ...base, presentationResult: "NOT_READY" }] }),
  );
  assert.equal(blocked.productionVerified, false);
  assert.ok(blocked.gaps.some((gap) => gap.code === "PRESENTATION_NOT_READY"));

  const withGaps = computeProductionVerification(
    productionInput({ deployments: [{ ...base, presentationResult: "READY_WITH_GAPS" }] }),
  );
  assert.equal(withGaps.productionVerified, true);
  assert.equal(withGaps.warnings.length, 1);

  const missing = computeProductionVerification(productionInput({ deployments: [{ ...base, presentationResult: "" }] }));
  assert.ok(missing.gaps.some((gap) => gap.code === "NO_PRESENTATION_RESULT"));
});

test("open decisions block both gates", () => {
  assert.ok(computeProductionVerification(productionInput({ openDecisions: 1 })).gaps.some((gap) => gap.code === "OPEN_DECISIONS"));
  assert.ok(computeDeploymentReadiness(readyInput({ openDecisions: 1 })).gaps.some((gap) => gap.code === "OPEN_DECISIONS"));
});

test("the latest SUCCEEDED deployment decides production verification; a failed retry keeps history", () => {
  const first = productionInput().deployments[0];
  const result = computeProductionVerification(
    productionInput({
      deployments: [
        { ...first, id: "d2", humanId: "DEP-002", status: "FAILED", createdAt: "2026-10-07T00:00:00Z" },
        first,
      ],
    }),
  );
  assert.equal(result.productionVerified, true);
});

function bundle(status: ReleaseStatus, overrides: Partial<ReleaseBundle> = {}): ReleaseBundle {
  const now = "2026-10-06T00:00:00Z";
  return {
    release: {
      id: "r1",
      projectId: "p1",
      verificationProgramId: "v1",
      buildExecutionId: "e1",
      buildPlanId: "b1",
      productArchitectureId: "pa1",
      systemArchitectureId: "sa1",
      environmentId: "env1",
      humanId: "REL-001",
      summary: "",
      status,
      sourceBranch: "ghost-experience",
      sourceCommitSha: SHA,
      releaseVersion: "",
      deploymentSequence: ["deploy"],
      rollbackStrategy: "Redeploy.",
      rollbackTargetReleaseId: null,
      rollbackTargetCommitSha: "",
      note: "",
      deployedAt: null,
      productionVerifiedAt: null,
      productionVerifiedBy: null,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
    },
    verificationStatus: "VERIFIED",
    environments: [
      {
        id: "env1",
        projectId: "p1",
        name: "Production",
        environmentType: "PRODUCTION",
        provider: "Render",
        applicationUrl: "https://example.test",
        healthEndpoint: "/api/health",
        serviceIdentity: "",
        isActive: true,
        note: "",
        source: "founder",
        provenance: "founder",
        createdAt: now,
        updatedAt: now,
      },
    ],
    configRequirements: [],
    migrations: [],
    deployments: [],
    evidence: [],
    healthChecks: [],
    manualActions: [],
    rollbacks: [],
    openDecisionCount: 0,
    openDecisions: [],
    ...overrides,
  };
}

test("evaluateReleaseBundle reflects a ready DRAFT and an empty production gate", () => {
  const result = evaluateReleaseBundle(bundle("DRAFT"));
  assert.equal(result.readiness.ready, true);
  assert.equal(result.production.productionVerified, false);
  assert.equal(result.latestDeployment, null);
});

test("evaluateReleaseBundle flags a missing environment", () => {
  const result = evaluateReleaseBundle(bundle("DRAFT", { environments: [] }));
  assert.ok(result.readiness.gaps.some((gap) => gap.code === "NO_ENVIRONMENT"));
});

test("next action follows the release stage and never invents completion", () => {
  const draft = bundle("DRAFT", { verificationStatus: "TESTING" });
  const draftEval = evaluateReleaseBundle(draft);
  const gapAction = suggestReleaseNextAction({
    status: "DRAFT",
    readiness: draftEval.readiness,
    production: draftEval.production,
    latestDeployment: null,
  });
  assert.equal(gapAction?.title, "Complete deployment readiness gaps");

  const readyEval = evaluateReleaseBundle(bundle("DRAFT"));
  assert.equal(
    suggestReleaseNextAction({
      status: "DRAFT",
      readiness: readyEval.readiness,
      production: readyEval.production,
      latestDeployment: null,
    })?.title,
    "Mark release DEPLOYMENT_READY",
  );

  assert.equal(
    suggestReleaseNextAction({
      status: "DEPLOYMENT_READY",
      readiness: readyEval.readiness,
      production: readyEval.production,
      latestDeployment: null,
    })?.title,
    "Start deployment",
  );

  assert.equal(
    suggestReleaseNextAction({
      status: "DEPLOYMENT_READY",
      readiness: readyEval.readiness,
      production: readyEval.production,
      latestDeployment: { humanId: "DEP-001", status: "FAILED", failureReason: "build error" },
    })?.title,
    "Resolve failed deployment",
  );

  assert.equal(
    suggestReleaseNextAction({
      status: "PRODUCTION_VERIFIED",
      readiness: readyEval.readiness,
      production: computeProductionVerification(productionInput()),
      latestDeployment: null,
    }),
    null,
  );
});
