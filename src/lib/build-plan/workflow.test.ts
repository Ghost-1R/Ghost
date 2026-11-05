import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionBuildPlan,
  computeBuildPlanReadiness,
  computeCriticalPath,
  computeExecutionWaves,
  detectDependencyCycles,
  nextHumanId,
  suggestBuildNextAction,
  type BuildReadinessInput,
} from "./workflow";

const readyInput = (overrides: Partial<BuildReadinessInput> = {}): BuildReadinessInput => ({
  plan: {
    summary: "Ship auth and notes MVP",
    deploymentSequence: ["migrate", "deploy api", "smoke"],
    status: "APPROVED",
  },
  phases: [{ id: "ph1" }],
  packages: [
    {
      id: "p1",
      humanId: "WP-001",
      title: "Auth foundation",
      objective: "Sign-in",
      description: "",
      databaseImpact: "",
    },
    {
      id: "p2",
      humanId: "WP-002",
      title: "Notes CRUD",
      objective: "CRUD",
      description: "",
      databaseImpact: "migration for notes",
    },
  ],
  dependencies: [{ fromPackageId: "p2", toPackageId: "p1", edgeKind: "DEPENDS_ON" }],
  verifications: [
    { workPackageId: "p1" },
    { workPackageId: "p2" },
  ],
  requirementLinks: [{ requirementId: "r1" }],
  featureLinks: [{ featureId: "f1" }],
  architectureLinks: [
    { linkKind: "COMPONENT", recordRef: "COMP-001" },
    { linkKind: "ENTITY", recordRef: "ENT-001" },
    { linkKind: "INTERFACE", recordRef: "API-001" },
  ],
  requirements: [{ id: "r1", humanId: "REQ-001", title: "Auth", approvalStatus: "ACCEPTED", priority: "HIGH" }],
  features: [{ id: "f1", humanId: "FEAT-001", name: "Notes", status: "APPROVED" }],
  architectureRecords: [
    { humanId: "COMP-001", name: "Web", kind: "COMPONENT", status: "APPROVED" },
    { humanId: "ENT-001", name: "notes", kind: "ENTITY", status: "APPROVED" },
    { humanId: "API-001", name: "Notes API", kind: "INTERFACE", status: "APPROVED" },
  ],
  openDecisions: 0,
  systemStatus: "ARCHITECTURE_READY",
  productStatus: "BUILD_READY",
  ...overrides,
});

test("build plan transitions stay finite", () => {
  assert.equal(canTransitionBuildPlan("DRAFT", "PLANNING"), true);
  assert.equal(canTransitionBuildPlan("DRAFT", "BUILD_PLAN_READY"), false);
  assert.equal(canTransitionBuildPlan("REVIEW", "BUILD_PLAN_READY"), false);
  assert.equal(canTransitionBuildPlan("APPROVED", "BUILD_PLAN_READY"), true);
  assert.equal(canTransitionBuildPlan("BUILD_PLAN_READY", "APPROVED"), true);
  assert.equal(canTransitionBuildPlan("BUILD_PLAN_READY", "DRAFT"), false);
});

test("human ids increment per prefix", () => {
  assert.equal(nextHumanId("WP", []), "WP-001");
  assert.equal(nextHumanId("PHASE", ["PHASE-001", "PHASE-004"]), "PHASE-005");
  assert.equal(nextHumanId("MAN", ["MAN-009"]), "MAN-010");
  assert.equal(nextHumanId("BRISK", ["WP-007"]), "BRISK-001");
});

test("dependency cycles are detected for DEPENDS_ON and BLOCKS", () => {
  const packages = [
    { id: "a", humanId: "WP-001" },
    { id: "b", humanId: "WP-002" },
    { id: "c", humanId: "WP-003" },
  ];
  assert.equal(detectDependencyCycles(packages, [{ fromPackageId: "a", toPackageId: "b", edgeKind: "DEPENDS_ON" }]), null);

  const cycle = detectDependencyCycles(packages, [
    { fromPackageId: "a", toPackageId: "b", edgeKind: "DEPENDS_ON" },
    { fromPackageId: "b", toPackageId: "c", edgeKind: "DEPENDS_ON" },
    { fromPackageId: "c", toPackageId: "a", edgeKind: "DEPENDS_ON" },
  ]);
  assert.ok(cycle);
  assert.ok(cycle!.join(" ").includes("WP-001"));
  assert.ok(cycle!.length >= 3);

  const blocksCycle = detectDependencyCycles(packages, [
    { fromPackageId: "a", toPackageId: "b", edgeKind: "BLOCKS" },
    { fromPackageId: "b", toPackageId: "a", edgeKind: "BLOCKS" },
  ]);
  assert.ok(blocksCycle);

  assert.equal(
    detectDependencyCycles(packages, [
      { fromPackageId: "a", toPackageId: "b", edgeKind: "CAN_RUN_WITH" },
      { fromPackageId: "b", toPackageId: "a", edgeKind: "CAN_RUN_WITH" },
    ]),
    null,
  );
});

test("execution waves ignore CAN_RUN_WITH and respect DEPENDS_ON/BLOCKS", () => {
  const packages = [
    { id: "a", humanId: "WP-001" },
    { id: "b", humanId: "WP-002" },
    { id: "c", humanId: "WP-003" },
  ];
  const waves = computeExecutionWaves(packages, [
    { fromPackageId: "b", toPackageId: "a", edgeKind: "DEPENDS_ON" },
    { fromPackageId: "c", toPackageId: "b", edgeKind: "DEPENDS_ON" },
    { fromPackageId: "a", toPackageId: "c", edgeKind: "CAN_RUN_WITH" },
  ]);
  assert.deepEqual(waves, [["WP-001"], ["WP-002"], ["WP-003"]]);

  const blocked = computeExecutionWaves(packages, [
    { fromPackageId: "a", toPackageId: "b", edgeKind: "BLOCKS" },
  ]);
  assert.deepEqual(blocked[0], ["WP-001", "WP-003"]);
  assert.deepEqual(blocked[1], ["WP-002"]);
});

test("critical path is the longest dependency chain by package count", () => {
  const packages = [
    { id: "a", humanId: "WP-001" },
    { id: "b", humanId: "WP-002" },
    { id: "c", humanId: "WP-003" },
    { id: "d", humanId: "WP-004" },
  ];
  const path = computeCriticalPath(packages, [
    { fromPackageId: "b", toPackageId: "a", edgeKind: "DEPENDS_ON" },
    { fromPackageId: "c", toPackageId: "b", edgeKind: "DEPENDS_ON" },
    { fromPackageId: "d", toPackageId: "a", edgeKind: "DEPENDS_ON" },
  ]);
  assert.deepEqual(path, ["WP-001", "WP-002", "WP-003"]);
});

test("readiness lists concrete deterministic gaps", () => {
  const result = computeBuildPlanReadiness(
    readyInput({
      plan: { summary: "", deploymentSequence: [], status: "PLANNING" },
      phases: [],
      packages: [
        {
          id: "p1",
          humanId: "WP-001",
          title: "Deploy notes",
          objective: "production deploy",
          description: "migration",
          databaseImpact: "migration",
        },
      ],
      dependencies: [
        { fromPackageId: "p1", toPackageId: "p1", edgeKind: "DEPENDS_ON" },
      ],
      verifications: [],
      requirementLinks: [],
      featureLinks: [],
      architectureLinks: [],
      openDecisions: 2,
      systemStatus: "APPROVED",
    }),
  );
  assert.equal(result.buildPlanReady, false);
  const codes = result.gaps.map((gap) => gap.code);
  for (const code of [
    "SUMMARY",
    "NO_PHASES",
    "VERIFY_WP-001",
    "REQ_REQ-001",
    "FEAT_FEAT-001",
    "ARCH_COMP-001",
    "DEPLOYMENT_SEQUENCE",
    "OPEN_DECISIONS",
    "SYSTEM_NOT_READY",
    "NOT_APPROVED",
  ]) {
    assert.ok(codes.includes(code), `missing gap ${code}`);
  }
});

test("a complete approved plan is build plan ready", () => {
  const result = computeBuildPlanReadiness(readyInput());
  assert.equal(result.buildPlanReady, true);
  assert.deepEqual(result.gaps, []);
});

test("self-dependency creates a cycle gap on readiness", () => {
  const packages = [
    { id: "a", humanId: "WP-001" },
    { id: "b", humanId: "WP-002" },
  ];
  const cycle = detectDependencyCycles(packages, [
    { fromPackageId: "a", toPackageId: "b", edgeKind: "DEPENDS_ON" },
    { fromPackageId: "b", toPackageId: "a", edgeKind: "DEPENDS_ON" },
  ]);
  assert.ok(cycle);
  const result = computeBuildPlanReadiness(
    readyInput({
      packages: [
        { id: "a", humanId: "WP-001", title: "A", objective: "", description: "", databaseImpact: "" },
        { id: "b", humanId: "WP-002", title: "B", objective: "", description: "", databaseImpact: "migration" },
      ],
      dependencies: [
        { fromPackageId: "a", toPackageId: "b", edgeKind: "DEPENDS_ON" },
        { fromPackageId: "b", toPackageId: "a", edgeKind: "DEPENDS_ON" },
      ],
      verifications: [{ workPackageId: "a" }, { workPackageId: "b" }],
    }),
  );
  assert.ok(result.gaps.some((gap) => gap.code === "DEPENDENCY_CYCLE"));
});

test("next action follows the first justified gap", () => {
  const empty = { readiness: { buildPlanReady: false, gaps: [], reasons: [] } };
  const first = suggestBuildNextAction({
    ...empty,
    planStatus: "DRAFT",
    summaryPresent: false,
    phaseCount: 0,
    packageCount: 0,
  });
  assert.match(first?.title ?? "", /Define build plan phases and work packages/);
  assert.equal(first?.sourceKind, "build_plan");

  const ready = suggestBuildNextAction({
    readiness: { buildPlanReady: true, gaps: [], reasons: ["ok"] },
    planStatus: "APPROVED",
    summaryPresent: true,
    phaseCount: 1,
    packageCount: 2,
  });
  assert.match(ready?.title ?? "", /BUILD_PLAN_READY/);

  const done = suggestBuildNextAction({
    readiness: { buildPlanReady: true, gaps: [], reasons: ["ok"] },
    planStatus: "BUILD_PLAN_READY",
    summaryPresent: true,
    phaseCount: 1,
    packageCount: 2,
  });
  assert.equal(done, null);
});
