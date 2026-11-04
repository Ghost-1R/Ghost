import assert from "node:assert/strict";
import test from "node:test";
import {
  answerDeploymentTruthQuestion,
  doesDeployedMeanProductionVerified,
  doesVerifiedMeanDeployed,
  isProductionVerified,
  isReleaseDeployed,
  isVerifiedButNotDeployed,
  type DeploymentTruthInput,
} from "./truth";
import { RELEASE_STATUSES } from "./types";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";

test("VERIFIED is not DEPLOYED", () => {
  assert.equal(doesVerifiedMeanDeployed().answer, "NO");
  assert.equal(isVerifiedButNotDeployed("VERIFIED", null).answer, "YES");
  assert.equal(isVerifiedButNotDeployed("VERIFIED", "DRAFT").answer, "YES");
  assert.equal(isVerifiedButNotDeployed("VERIFIED", "DEPLOYMENT_READY").answer, "YES");
  assert.equal(isVerifiedButNotDeployed("VERIFIED", "DEPLOYING").answer, "YES");
  assert.equal(isVerifiedButNotDeployed("VERIFIED", "DEPLOYED").answer, "NO");
  assert.equal(isVerifiedButNotDeployed("TESTING", null).answer, "NO");
});

test("DEPLOYED is not PRODUCTION_VERIFIED", () => {
  assert.equal(doesDeployedMeanProductionVerified().answer, "NO");
  assert.equal(isReleaseDeployed("DEPLOYED").answer, "YES");
  assert.equal(isProductionVerified("DEPLOYED").answer, "NO");
  assert.equal(isProductionVerified("PRODUCTION_VERIFICATION").answer, "NO");
  assert.equal(isProductionVerified("PRODUCTION_VERIFIED").answer, "YES");
});

test("isReleaseDeployed is YES only for deployed-or-later statuses", () => {
  const yes = RELEASE_STATUSES.filter((status) => isReleaseDeployed(status).answer === "YES");
  assert.deepEqual(yes, ["DEPLOYED", "PRODUCTION_VERIFICATION", "PRODUCTION_VERIFIED"]);
  assert.equal(isReleaseDeployed("DRAFT").kind, "NOT_DEPLOYED");
  assert.equal(isReleaseDeployed("DEPLOYING").answer, "NO");
  assert.equal(isReleaseDeployed(null).answer, "NO");
  assert.equal(isProductionVerified(null).answer, "NO");
});

function input(overrides: Partial<DeploymentTruthInput> = {}): DeploymentTruthInput {
  return {
    release: { status: "DEPLOYED", humanId: "REL-001", sourceCommitSha: SHA, rollbackStrategy: "Redeploy." },
    verificationStatus: "VERIFIED",
    deployments: [
      {
        id: "d1",
        humanId: "DEP-001",
        status: "SUCCEEDED",
        expectedCommitSha: SHA,
        liveCommitSha: SHA,
        failureReason: "",
        createdAt: "2026-10-06T00:00:00Z",
      },
    ],
    migrations: [{ migrationPath: "a.sql", isRequired: true, status: "APPLIED" }],
    healthChecks: [{ deploymentId: "d1", checkName: "api", status: "PASSED" }],
    rollbacks: [],
    readinessGaps: [],
    productionGaps: [],
    ...overrides,
  };
}

test("is it deployed / live follows release status", () => {
  assert.equal(answerDeploymentTruthQuestion("Is it deployed?", input())?.answer, "YES");
  assert.equal(answerDeploymentTruthQuestion("Is it live in production?", input())?.answer, "YES");
  assert.equal(
    answerDeploymentTruthQuestion(
      "Is it deployed?",
      input({ release: { status: "DEPLOYMENT_READY", humanId: "REL-001", sourceCommitSha: SHA, rollbackStrategy: "" } }),
    )?.answer,
    "NO",
  );
});

test("does VERIFIED mean deployed answers NO", () => {
  const answer = answerDeploymentTruthQuestion("Does verified mean it is deployed?", input());
  assert.equal(answer?.answer, "NO");
  assert.equal(answer?.kind, "NOT_DEPLOYED");
  assert.equal(
    answerDeploymentTruthQuestion("Does deployed mean production verified?", input())?.kind,
    "NOT_PRODUCTION_VERIFIED",
  );
});

test("production verified question separates DEPLOYED from PRODUCTION_VERIFIED", () => {
  assert.equal(answerDeploymentTruthQuestion("Is it production verified?", input())?.answer, "NO");
  assert.equal(
    answerDeploymentTruthQuestion(
      "Is it production verified?",
      input({ release: { status: "PRODUCTION_VERIFIED", humanId: "REL-001", sourceCommitSha: SHA, rollbackStrategy: "" } }),
    )?.answer,
    "YES",
  );
});

test("live version answers come from the recorded live SHA only", () => {
  const answer = answerDeploymentTruthQuestion("What commit is live in production?", input());
  assert.equal(answer?.answer, "YES");
  assert.ok(answer?.reason.includes(SHA));

  const mismatch = answerDeploymentTruthQuestion(
    "Which commit is live?",
    input({ deployments: [{ ...input().deployments![0], liveCommitSha: OTHER }] }),
  );
  assert.ok(mismatch?.reason.includes("NOT matching"));

  const unrecorded = answerDeploymentTruthQuestion(
    "What version is live?",
    input({ deployments: [{ ...input().deployments![0], liveCommitSha: "" }] }),
  );
  assert.equal(unrecorded?.answer, "UNKNOWN");

  const notDeployed = answerDeploymentTruthQuestion(
    "What commit is live?",
    input({ release: { status: "DEPLOYMENT_READY", humanId: "REL-001", sourceCommitSha: SHA, rollbackStrategy: "" } }),
  );
  assert.equal(notDeployed?.answer, "NO");
  assert.ok(notDeployed?.reason.includes("not a live claim"));
});

test("migration questions never treat committed as applied", () => {
  assert.equal(answerDeploymentTruthQuestion("Were the migrations applied?", input())?.answer, "YES");
  const pending = answerDeploymentTruthQuestion(
    "Is the migration applied?",
    input({ migrations: [{ migrationPath: "a.sql", isRequired: true, status: "PENDING" }] }),
  );
  assert.equal(pending?.answer, "NO");
  assert.equal(answerDeploymentTruthQuestion("Is the migration applied?", input({ migrations: [] }))?.answer, "UNKNOWN");
});

test("production health comes from recorded checks", () => {
  assert.equal(answerDeploymentTruthQuestion("Is production healthy?", input())?.answer, "YES");
  assert.equal(
    answerDeploymentTruthQuestion(
      "Is production healthy?",
      input({ healthChecks: [{ deploymentId: "d1", checkName: "api", status: "FAILED" }] }),
    )?.answer,
    "NO",
  );
  assert.equal(answerDeploymentTruthQuestion("Is production healthy?", input({ healthChecks: [] }))?.answer, "UNKNOWN");
  assert.equal(answerDeploymentTruthQuestion("Is production healthy?", input({ deployments: [] }))?.answer, "UNKNOWN");
});

test("blocking questions list the gaps for the current stage", () => {
  const draft = answerDeploymentTruthQuestion(
    "What is blocking deployment?",
    input({
      release: { status: "DRAFT", humanId: "REL-001", sourceCommitSha: SHA, rollbackStrategy: "" },
      readinessGaps: ["Required configuration GROQ_API_KEY is UNKNOWN; it must be PRESENT."],
    }),
  );
  assert.equal(draft?.answer, "YES");
  assert.ok(draft?.reason.includes("GROQ_API_KEY"));

  const prod = answerDeploymentTruthQuestion(
    "Why isn't it production verified?",
    input({ productionGaps: ["Presentation gate is NOT_READY; it blocks production verification."] }),
  );
  assert.ok(prod?.reason.includes("NOT_READY"));

  const done = answerDeploymentTruthQuestion(
    "What is blocking?",
    input({ release: { status: "PRODUCTION_VERIFIED", humanId: "REL-001", sourceCommitSha: SHA, rollbackStrategy: "" } }),
  );
  assert.equal(done?.answer, "NO");
});

test("rollback questions never claim a rollback happened without a record", () => {
  assert.equal(answerDeploymentTruthQuestion("Can we roll back?", input())?.answer, "UNKNOWN");
  assert.equal(
    answerDeploymentTruthQuestion(
      "Can we roll back?",
      input({ rollbacks: [{ status: "AVAILABLE", targetCommitSha: OTHER, reason: "" }] }),
    )?.answer,
    "YES",
  );
  const completed = answerDeploymentTruthQuestion(
    "Did we roll back?",
    input({ rollbacks: [{ status: "COMPLETED", targetCommitSha: OTHER, reason: "" }] }),
  );
  assert.ok(completed?.reason.includes("COMPLETED"));
});

test("last deployment reports the latest attempt including failures", () => {
  const answer = answerDeploymentTruthQuestion(
    "What was the last deployment?",
    input({
      deployments: [
        { ...input().deployments![0], id: "d2", humanId: "DEP-002", status: "FAILED", failureReason: "build failed", createdAt: "2026-10-07T00:00:00Z" },
        input().deployments![0],
      ],
    }),
  );
  assert.equal(answer?.answer, "YES");
  assert.ok(answer?.reason.includes("DEP-002"));
  assert.ok(answer?.reason.includes("FAILED"));
  assert.equal(answerDeploymentTruthQuestion("What was the last deployment?", input({ deployments: [] }))?.answer, "NO");
});

test("with no release Ghost records the absence and never invents", () => {
  assert.equal(answerDeploymentTruthQuestion("Is it deployed?", { release: null })?.answer, "NO");
  assert.equal(answerDeploymentTruthQuestion("Is it production verified?", { release: null })?.answer, "NO");
  assert.equal(answerDeploymentTruthQuestion("What is blocking deployment?", { release: null })?.answer, "UNKNOWN");
  assert.equal(answerDeploymentTruthQuestion("What commit is live?", { release: null })?.answer, "NO");
  assert.equal(answerDeploymentTruthQuestion("Can we roll back?", { release: null })?.answer, "UNKNOWN");
  assert.equal(answerDeploymentTruthQuestion("Is production healthy?", { release: null })?.answer, "UNKNOWN");
});

test("past Ghost answers are not evidence and unrelated questions pass through", () => {
  assert.equal(answerDeploymentTruthQuestion("Ghost said it was deployed earlier", input())?.kind, "MODEL_SUGGESTION");
  assert.equal(answerDeploymentTruthQuestion("What color is the logo?", input()), null);
});
