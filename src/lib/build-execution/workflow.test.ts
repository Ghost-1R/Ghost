import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionBuildExecution,
  canTransitionPackageExecution,
  computeExecutionCompletion,
  computeExecutionWavesFromPackages,
  computeImplementationCoverage,
  computePackageReadiness,
  refreshDerivedPackageStatuses,
  rejectSecretEvidenceReference,
  suggestExecutionNextAction,
  type ExecutionCompletionInput,
} from "./workflow";

test("build execution transitions match RPC", () => {
  assert.equal(canTransitionBuildExecution("NOT_STARTED", "EXECUTING"), true);
  assert.equal(canTransitionBuildExecution("NOT_STARTED", "IMPLEMENTED"), false);
  assert.equal(canTransitionBuildExecution("EXECUTING", "IMPLEMENTATION_REVIEW"), true);
  assert.equal(canTransitionBuildExecution("EXECUTING", "NOT_STARTED"), true);
  assert.equal(canTransitionBuildExecution("IMPLEMENTATION_REVIEW", "IMPLEMENTED"), true);
  assert.equal(canTransitionBuildExecution("IMPLEMENTED", "IMPLEMENTATION_REVIEW"), true);
  assert.equal(canTransitionBuildExecution("IMPLEMENTED", "NOT_STARTED"), false);
});

test("package execution transitions stay finite", () => {
  assert.equal(canTransitionPackageExecution("QUEUED", "READY"), true);
  assert.equal(canTransitionPackageExecution("QUEUED", "IN_PROGRESS"), false);
  assert.equal(canTransitionPackageExecution("READY", "IN_PROGRESS"), true);
  assert.equal(canTransitionPackageExecution("IN_PROGRESS", "IMPLEMENTED"), true);
  assert.equal(canTransitionPackageExecution("BLOCKED", "READY"), true);
  assert.equal(canTransitionPackageExecution("IMPLEMENTED", "IN_PROGRESS"), true);
  assert.equal(canTransitionPackageExecution("IMPLEMENTED", "READY"), false);
});

test("secret-looking evidence references are rejected", () => {
  assert.equal(rejectSecretEvidenceReference("abc123def").ok, true);
  assert.equal(rejectSecretEvidenceReference("sk-abcdefghijklmnopqrstuvwxyz").ok, false);
  assert.equal(rejectSecretEvidenceReference("").ok, false);
});

test("init-adjacent readiness: no deps means READY, unmet dep stays QUEUED", () => {
  const packages = [
    { id: "e1", workPackageId: "p1", status: "QUEUED" as const },
    { id: "e2", workPackageId: "p2", status: "QUEUED" as const },
  ];
  const deps = [{ fromPackageId: "p2", toPackageId: "p1", edgeKind: "DEPENDS_ON" as const }];

  const suggested = refreshDerivedPackageStatuses(packages, deps, [], []);
  assert.equal(suggested.get("e1"), "READY");
  assert.equal(suggested.has("e2"), false);

  const afterFirst = [
    { id: "e1", workPackageId: "p1", status: "IMPLEMENTED" as const },
    { id: "e2", workPackageId: "p2", status: "QUEUED" as const },
  ];
  const suggested2 = refreshDerivedPackageStatuses(afterFirst, deps, [], []);
  assert.equal(suggested2.get("e2"), "READY");
});

test("open blockers and upstream changes prevent READY", () => {
  const packages = [{ id: "e1", workPackageId: "p1", status: "QUEUED" as const }];
  const readiness = computePackageReadiness({
    packages,
    dependencies: [],
    openBlockers: [{ packageExecutionId: "e1", status: "OPEN" }],
    openUpstreamChanges: [],
  });
  assert.equal(readiness.get("e1")?.ready, false);

  const readiness2 = computePackageReadiness({
    packages,
    dependencies: [],
    openBlockers: [],
    openUpstreamChanges: [{ packageExecutionId: "e1", status: "OPEN" }],
  });
  assert.equal(readiness2.get("e1")?.ready, false);
});

test("refreshDerivedPackageStatuses never invents IMPLEMENTED", () => {
  const packages = [
    { id: "e1", workPackageId: "p1", status: "IN_PROGRESS" as const },
    { id: "e2", workPackageId: "p2", status: "BLOCKED" as const },
  ];
  const suggested = refreshDerivedPackageStatuses(packages, [], [], []);
  assert.equal(suggested.size, 0);
});

test("execution waves skip IMPLEMENTED packages", () => {
  const packages = [
    { id: "e1", workPackageId: "p1", humanId: "WP-001", status: "IMPLEMENTED" as const },
    { id: "e2", workPackageId: "p2", humanId: "WP-002", status: "QUEUED" as const },
    { id: "e3", workPackageId: "p3", humanId: "WP-003", status: "READY" as const },
  ];
  const deps = [
    { fromPackageId: "p2", toPackageId: "p1", edgeKind: "DEPENDS_ON" as const },
    { fromPackageId: "p3", toPackageId: "p1", edgeKind: "DEPENDS_ON" as const },
  ];
  const waves = computeExecutionWavesFromPackages(packages, deps);
  assert.equal(waves.length, 1);
  assert.deepEqual(waves[0], ["WP-002", "WP-003"]);
});

test("implementation coverage follows linked package execution status", () => {
  const coverage = computeImplementationCoverage({
    requirements: [{ id: "r1", humanId: "REQ-001", title: "Auth" }],
    features: [{ id: "f1", humanId: "FEAT-001", name: "Notes" }],
    requirementLinks: [{ workPackageId: "p1", requirementId: "r1" }],
    featureLinks: [{ workPackageId: "p2", featureId: "f1" }],
    packageExecutions: [
      { workPackageId: "p1", status: "IMPLEMENTED" },
      { workPackageId: "p2", status: "READY" },
    ],
  });
  assert.equal(coverage.requirements[0].implemented, true);
  assert.equal(coverage.features[0].implemented, false);
});

const completeInput = (overrides: Partial<ExecutionCompletionInput> = {}): ExecutionCompletionInput => ({
  executionStatus: "IMPLEMENTATION_REVIEW",
  planStatus: "BUILD_PLAN_READY",
  packageExecutions: [
    { id: "e1", workPackageId: "p1", status: "IMPLEMENTED" },
    { id: "e2", workPackageId: "p2", status: "IMPLEMENTED" },
  ],
  evidence: [{ packageExecutionId: "e1" }, { packageExecutionId: "e2" }],
  openBlockers: [],
  openUpstreamChanges: [],
  openDecisions: 0,
  ...overrides,
});

test("completion gate passes only when all criteria hold", () => {
  const ok = computeExecutionCompletion(completeInput());
  assert.equal(ok.implementationComplete, true);

  assert.equal(computeExecutionCompletion(completeInput({ planStatus: "APPROVED" })).implementationComplete, false);
  assert.equal(
    computeExecutionCompletion(
      completeInput({
        packageExecutions: [
          { id: "e1", workPackageId: "p1", status: "IMPLEMENTED" },
          { id: "e2", workPackageId: "p2", status: "READY" },
        ],
      }),
    ).implementationComplete,
    false,
  );
  assert.equal(
    computeExecutionCompletion(completeInput({ evidence: [{ packageExecutionId: "e1" }] })).implementationComplete,
    false,
  );
  assert.equal(
    computeExecutionCompletion(completeInput({ openBlockers: [{ status: "OPEN" }] })).implementationComplete,
    false,
  );
  assert.equal(
    computeExecutionCompletion(completeInput({ openUpstreamChanges: [{ status: "OPEN" }] })).implementationComplete,
    false,
  );
  assert.equal(computeExecutionCompletion(completeInput({ openDecisions: 1 })).implementationComplete, false);
  assert.equal(
    computeExecutionCompletion(completeInput({ executionStatus: "EXECUTING" })).implementationComplete,
    false,
  );
});

test("suggestExecutionNextAction prefers blockers then ready packages", () => {
  const blocked = suggestExecutionNextAction({
    completion: computeExecutionCompletion(completeInput({ openBlockers: [{ status: "OPEN" }] })),
    executionStatus: "EXECUTING",
    packageExecutions: [{ status: "BLOCKED" }, { status: "READY" }],
  });
  assert.equal(blocked?.title, "Resolve execution blocker");

  const ready = suggestExecutionNextAction({
    completion: computeExecutionCompletion(
      completeInput({
        executionStatus: "EXECUTING",
        packageExecutions: [
          { id: "e1", workPackageId: "p1", status: "READY" },
          { id: "e2", workPackageId: "p2", status: "QUEUED" },
        ],
        evidence: [],
      }),
    ),
    executionStatus: "EXECUTING",
    packageExecutions: [{ status: "READY" }, { status: "QUEUED" }],
  });
  assert.equal(ready?.title, "Begin next ready work package");
});
