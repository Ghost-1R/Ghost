import assert from "node:assert/strict";
import test from "node:test";
import { nextHighestPriorityAction } from "./next-action";
import {
  classifyDeploymentAttemptStatuses,
  isCurrentFailedDeployment,
  reconcileDeploymentFacet,
  reconcileLocalVerificationFacet,
} from "./reconcile";
import type { DeploymentAttemptInput } from "./types";

const projectId = "proj-1";

function attempt(
  partial: Omit<DeploymentAttemptInput, "projectId"> & { projectId?: string },
): DeploymentAttemptInput {
  return { projectId, ...partial };
}

test("older FAILED is SUPERSEDED when a newer SUCCEEDED exists", () => {
  const attempts = [
    attempt({
      id: "fail-old",
      status: "FAILED",
      createdAt: "2026-03-01T10:00:00.000Z",
      humanId: "D-1",
      failureReason: "Render build failed",
    }),
    attempt({
      id: "ok-new",
      status: "SUCCEEDED",
      createdAt: "2026-03-10T12:00:00.000Z",
      humanId: "D-2",
    }),
  ];

  const classified = classifyDeploymentAttemptStatuses(attempts);
  const failed = classified.find((row) => row.id === "fail-old");
  const succeeded = classified.find((row) => row.id === "ok-new");

  assert.equal(failed?.operationalState, "SUPERSEDED");
  assert.equal(failed?.supersededById, "ok-new");
  assert.equal(succeeded?.operationalState, "DEPLOYED");
  assert.equal(isCurrentFailedDeployment(attempts[0]!, attempts), false);
});

test("FAILED stays current when no later success exists", () => {
  const attempts = [
    attempt({
      id: "fail-current",
      status: "FAILED",
      createdAt: "2026-03-12T08:00:00.000Z",
      humanId: "D-9",
    }),
    attempt({
      id: "ok-old",
      status: "SUCCEEDED",
      createdAt: "2026-03-01T08:00:00.000Z",
      humanId: "D-8",
    }),
  ];

  assert.equal(isCurrentFailedDeployment(attempts[0]!, attempts), true);
  const classified = classifyDeploymentAttemptStatuses(attempts);
  assert.equal(classified.find((row) => row.id === "fail-current")?.operationalState, "FAILED");
  assert.equal(classified.find((row) => row.id === "ok-old")?.operationalState, "DEPLOYED");
});

test("empty deployment evidence yields UNKNOWN — never invents success", () => {
  assert.deepEqual(classifyDeploymentAttemptStatuses([]), []);
  const facet = reconcileDeploymentFacet({ projectId, attempts: [] });
  assert.equal(facet.state, "UNKNOWN");
  assert.match(facet.nextAction ?? "", /Record a deployment/i);
});

test("VERIFIED_IN_PRODUCTION requires explicit verification evidence", () => {
  const attempts = [
    attempt({
      id: "ok",
      status: "SUCCEEDED",
      createdAt: "2026-03-10T12:00:00.000Z",
    }),
  ];

  assert.equal(
    reconcileDeploymentFacet({ projectId, attempts, productionVerified: true }).state,
    "VERIFIED_IN_PRODUCTION",
  );
  assert.equal(reconcileDeploymentFacet({ projectId, attempts }).state, "DEPLOYED");
});

test("latest non-superseded FAILED surfaces as FAILED facet", () => {
  const attempts = [
    attempt({
      id: "fail",
      status: "FAILED",
      createdAt: "2026-03-11T12:00:00.000Z",
      failureReason: "health probe timeout",
    }),
  ];
  const facet = reconcileDeploymentFacet({ projectId, attempts });
  assert.equal(facet.state, "FAILED");
  assert.match(facet.summary, /health probe timeout/);
});

test("legacy verified records are not current local verification", () => {
  const facet = reconcileLocalVerificationFacet({
    projectId,
    hasFreshInspectorPass: null,
    legacyVerifiedRecord: true,
    openBlockingDefects: 0,
  });
  assert.equal(facet.state, "UNKNOWN");
  assert.match(facet.nextAction ?? "", /Inspector/i);
});

test("VERIFIED_LOCALLY only for fresh inspector pass", () => {
  assert.equal(
    reconcileLocalVerificationFacet({
      projectId,
      hasFreshInspectorPass: true,
      legacyVerifiedRecord: false,
      openBlockingDefects: 0,
    }).state,
    "VERIFIED_LOCALLY",
  );
});

test("BLOCKED when open blocking defects exist", () => {
  assert.equal(
    reconcileLocalVerificationFacet({
      projectId,
      hasFreshInspectorPass: true,
      legacyVerifiedRecord: true,
      openBlockingDefects: 2,
    }).state,
    "BLOCKED",
  );
});

test("nextHighestPriorityAction prefers BLOCKED over quieter deploy next steps", () => {
  const deploy = reconcileDeploymentFacet({
    projectId,
    attempts: [
      attempt({
        id: "ok",
        status: "SUCCEEDED",
        createdAt: "2026-03-10T12:00:00.000Z",
      }),
    ],
  });
  const verify = reconcileLocalVerificationFacet({
    projectId,
    hasFreshInspectorPass: null,
    legacyVerifiedRecord: false,
    openBlockingDefects: 1,
  });
  const next = nextHighestPriorityAction([deploy, verify]);
  assert.equal(next.state, "BLOCKED");
  assert.match(next.nextAction ?? "", /blocking/i);
});
