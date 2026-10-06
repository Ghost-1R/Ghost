import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCoverageMatrix,
  canTransitionSystemArchitecture,
  computeSystemReadiness,
  isValidEnvVariableName,
  isValidSecretName,
  looksLikeSecretValue,
  nextHumanId,
  suggestSystemNextAction,
  summarizeCoverage,
  uncoveredCriticalRequirements,
  validateSchemaDefects,
  type SystemReadinessInput,
} from "./workflow";

const readyInput = (overrides: Partial<SystemReadinessInput> = {}): SystemReadinessInput => ({
  architecture: {
    summary: "Next.js app with Supabase",
    authSummary: "Supabase Auth, email sign-in",
    authorizationSummary: "Owner-scoped RLS",
    status: "APPROVED",
  },
  components: [{ humanId: "COMP-001", componentType: "AUTH", status: "APPROVED" }],
  entities: [
    {
      id: "e1",
      humanId: "ENT-001",
      name: "receipts",
      ownershipField: "owner_id",
      rlsExpectation: "Owner can read and write own rows",
      sensitiveClass: "FINANCIAL",
      status: "APPROVED",
    },
  ],
  fields: [{ entityId: "e1", name: "id", isPk: true, isFk: false, referencesEntityId: null, sensitiveClass: "NONE" }],
  relationships: [],
  requirements: [{ id: "r1", humanId: "REQ-001", approvalStatus: "ACCEPTED", priority: "HIGH" }],
  coverage: [{ requirementId: "r1", coverage: "COVERED" }],
  openQuestions: [],
  openDecisions: 0,
  productStatus: "BUILD_READY",
  ...overrides,
});

test("system architecture transitions stay finite", () => {
  assert.equal(canTransitionSystemArchitecture("DRAFT", "DESIGNING"), true);
  assert.equal(canTransitionSystemArchitecture("DRAFT", "ARCHITECTURE_READY"), false);
  assert.equal(canTransitionSystemArchitecture("REVIEW", "ARCHITECTURE_READY"), false);
  assert.equal(canTransitionSystemArchitecture("APPROVED", "ARCHITECTURE_READY"), true);
  assert.equal(canTransitionSystemArchitecture("ARCHITECTURE_READY", "APPROVED"), true);
  assert.equal(canTransitionSystemArchitecture("ARCHITECTURE_READY", "DRAFT"), false);
});

test("human ids increment per prefix", () => {
  assert.equal(nextHumanId("COMP", []), "COMP-001");
  assert.equal(nextHumanId("ENT", ["ENT-001", "ENT-004"]), "ENT-005");
  assert.equal(nextHumanId("DFLOW", ["DFLOW-009"]), "DFLOW-010");
  assert.equal(nextHumanId("API", ["COMP-007"]), "API-001");
  for (const prefix of ["REL", "INTG", "RISK"] as const) {
    assert.equal(nextHumanId(prefix, []), `${prefix}-001`);
  }
});

test("readiness lists concrete deterministic gaps", () => {
  const result = computeSystemReadiness(
    readyInput({
      architecture: { summary: "", authSummary: "", authorizationSummary: "", status: "DESIGNING" },
      components: [{ humanId: "COMP-001", componentType: "AUTH", status: "PROPOSED" }],
      fields: [],
      coverage: [],
      openQuestions: [{ question: "Which queue?", status: "OPEN" }],
      openDecisions: 2,
      productStatus: "APPROVED",
    }),
  );
  assert.equal(result.architectureReady, false);
  const codes = result.gaps.map((gap) => gap.code);
  for (const code of [
    "SUMMARY",
    "AUTH_SUMMARY",
    "AUTHZ_SUMMARY",
    "NO_APPROVED_COMPONENT",
    "NO_ENTITY_WITH_PK",
    "COVERAGE_REQ-001",
    "OPEN_QUESTION",
    "OPEN_DECISIONS",
    "PRODUCT_NOT_BUILD_READY",
    "NOT_APPROVED",
  ]) {
    assert.ok(codes.includes(code), `missing gap ${code}`);
  }
});

test("a complete approved design is architecture ready", () => {
  const result = computeSystemReadiness(readyInput());
  assert.equal(result.architectureReady, true);
  assert.deepEqual(result.gaps, []);
});

test("product must be BUILD_READY and architecture approved", () => {
  assert.equal(computeSystemReadiness(readyInput({ productStatus: null })).architectureReady, false);
  assert.equal(
    computeSystemReadiness(
      readyInput({ architecture: { ...readyInput().architecture, status: "REVIEW" } }),
    ).architectureReady,
    false,
  );
});

test("auth summaries are only required when AUTH or user-owned entities exist", () => {
  const noAuth = computeSystemReadiness(
    readyInput({
      architecture: { summary: "Static docs site", authSummary: "", authorizationSummary: "", status: "APPROVED" },
      components: [{ humanId: "COMP-001", componentType: "WEB_APPLICATION", status: "APPROVED" }],
      entities: [{ ...readyInput().entities[0], ownershipField: "", rlsExpectation: "Public read", sensitiveClass: "NONE" }],
    }),
  );
  assert.equal(noAuth.gaps.some((gap) => gap.code === "AUTH_SUMMARY"), false);
  const owned = computeSystemReadiness(
    readyInput({
      architecture: { summary: "Notes app", authSummary: "", authorizationSummary: "", status: "APPROVED" },
      components: [{ humanId: "COMP-001", componentType: "WEB_APPLICATION", status: "APPROVED" }],
    }),
  );
  assert.ok(owned.gaps.some((gap) => gap.code === "AUTH_SUMMARY"));
  assert.ok(owned.gaps.some((gap) => gap.code === "AUTHZ_SUMMARY"));
});

test("only critical and high accepted requirements must be covered", () => {
  const result = computeSystemReadiness(
    readyInput({
      requirements: [
        { id: "r1", humanId: "REQ-001", approvalStatus: "ACCEPTED", priority: "CRITICAL" },
        { id: "r2", humanId: "REQ-002", approvalStatus: "ACCEPTED", priority: "NORMAL" },
        { id: "r3", humanId: "REQ-003", approvalStatus: "PROPOSED", priority: "HIGH" },
        { id: "r4", humanId: "REQ-004", approvalStatus: "ACCEPTED", priority: "HIGH" },
      ],
      coverage: [
        { requirementId: "r1", coverage: "NOT_COVERED" },
        { requirementId: "r4", coverage: "NOT_APPLICABLE" },
      ],
    }),
  );
  const coverageGaps = result.gaps.filter((gap) => gap.code.startsWith("COVERAGE_")).map((gap) => gap.code);
  assert.deepEqual(coverageGaps, ["COVERAGE_REQ-001"]);
});

test("invalid relationships block readiness", () => {
  const result = computeSystemReadiness(
    readyInput({
      relationships: [
        {
          humanId: "REL-001",
          sourceEntityId: "e1",
          targetEntityId: "missing",
          cardinality: "MANY_TO_MANY",
          junctionStrategy: "",
          status: "PROPOSED",
        },
      ],
    }),
  );
  assert.equal(result.architectureReady, false);
  assert.ok(result.gaps.some((gap) => gap.code === "REL_ENTITY_REL-001"));
  assert.ok(result.gaps.some((gap) => gap.code === "REL_M2M_REL-001"));
});

test("schema defects catch keys, duplicates, foreign keys, junctions, ownership, and RLS", () => {
  const defects = validateSchemaDefects({
    entities: [
      { id: "e1", humanId: "ENT-001", name: "notes", ownershipField: "", rlsExpectation: "Owner only", sensitiveClass: "NONE", status: "PROPOSED" },
      { id: "e2", humanId: "ENT-002", name: "profiles", ownershipField: "id", rlsExpectation: "", sensitiveClass: "PII", status: "APPROVED" },
      { id: "e3", humanId: "ENT-003", name: "old", ownershipField: "", rlsExpectation: "", sensitiveClass: "PII", status: "RETIRED" },
    ],
    fields: [
      { entityId: "e1", name: "title", isPk: false, isFk: false, referencesEntityId: null, sensitiveClass: "NONE" },
      { entityId: "e1", name: "Title", isPk: false, isFk: false, referencesEntityId: null, sensitiveClass: "NONE" },
      { entityId: "e1", name: "tag_id", isPk: false, isFk: true, referencesEntityId: null, sensitiveClass: "NONE" },
      { entityId: "e2", name: "id", isPk: true, isFk: false, referencesEntityId: null, sensitiveClass: "NONE" },
    ],
    relationships: [
      { humanId: "REL-001", sourceEntityId: "e1", targetEntityId: "e2", cardinality: "MANY_TO_MANY", junctionStrategy: "", status: "PROPOSED" },
    ],
  });
  const codes = defects.map((defect) => defect.code);
  assert.ok(codes.includes("NO_PK_ENT-001"));
  assert.ok(codes.includes("DUP_FIELD_ENT-001_title"));
  assert.ok(codes.includes("FK_MISSING_ENTITY_ENT-001_tag_id"));
  assert.ok(codes.includes("NO_OWNERSHIP_ENT-001"));
  assert.ok(codes.includes("NO_RLS_ENT-002"));
  assert.ok(codes.includes("REL_M2M_REL-001"));
  assert.equal(codes.some((code) => code.includes("ENT-003")), false, "retired entities are ignored");
});

test("a sound schema has no defects", () => {
  const defects = validateSchemaDefects({
    entities: [
      { id: "e1", humanId: "ENT-001", name: "notes", ownershipField: "owner_id", rlsExpectation: "Owner only", sensitiveClass: "NONE", status: "APPROVED" },
      { id: "e2", humanId: "ENT-002", name: "tags", ownershipField: "owner_id", rlsExpectation: "Owner only", sensitiveClass: "NONE", status: "APPROVED" },
    ],
    fields: [
      { entityId: "e1", name: "id", isPk: true, isFk: false, referencesEntityId: null, sensitiveClass: "NONE" },
      { entityId: "e2", name: "id", isPk: true, isFk: false, referencesEntityId: null, sensitiveClass: "NONE" },
      { entityId: "e2", name: "note_id", isPk: false, isFk: true, referencesEntityId: "e1", sensitiveClass: "NONE" },
    ],
    relationships: [
      { humanId: "REL-001", sourceEntityId: "e1", targetEntityId: "e2", cardinality: "ONE_TO_MANY", junctionStrategy: "", status: "APPROVED" },
    ],
  });
  assert.deepEqual(defects, []);
});

test("coverage matrix defaults to NOT_COVERED and links components and interfaces", () => {
  const matrix = buildCoverageMatrix({
    requirements: [
      { id: "r1", humanId: "REQ-001", title: "Upload", priority: "CRITICAL", approvalStatus: "ACCEPTED" },
      { id: "r2", humanId: "REQ-002", title: "Export", priority: "LOW", approvalStatus: "ACCEPTED" },
      { id: "r3", humanId: "REQ-003", title: "Idea", priority: "HIGH", approvalStatus: "PROPOSED" },
    ],
    coverage: [{ requirementId: "r2", coverage: "COVERED", gapNote: "", supportingRefs: ["COMP-001"] }],
    components: [{ humanId: "COMP-001", requirementIds: ["r1"] }],
    interfaces: [{ humanId: "API-001", requirementIds: ["r1", "r2"] }],
  });
  assert.equal(matrix.length, 2, "only accepted requirements are traced");
  assert.equal(matrix[0].coverage, "NOT_COVERED");
  assert.deepEqual(matrix[0].componentRefs, ["COMP-001"]);
  assert.deepEqual(matrix[0].interfaceRefs, ["API-001"]);
  assert.equal(matrix[1].coverage, "COVERED");
  assert.deepEqual(summarizeCoverage(matrix), { COVERED: 1, PARTIALLY_COVERED: 0, NOT_COVERED: 1, NOT_APPLICABLE: 0 });
  assert.deepEqual(
    uncoveredCriticalRequirements(matrix).map((row) => row.humanId),
    ["REQ-001"],
  );
});

test("secret values are rejected; only names are accepted", () => {
  assert.equal(looksLikeSecretValue("sk-live-abc123"), true);
  assert.equal(looksLikeSecretValue("eyJhbGciOiJIUzI1NiJ9"), true);
  assert.equal(looksLikeSecretValue("STRIPE_API_KEY"), false);
  assert.equal(isValidSecretName("STRIPE_API_KEY").ok, true);
  assert.equal(isValidSecretName("sk-live-abc123").ok, false);
  assert.equal(isValidSecretName("API_KEY=abcdef").ok, false);
  assert.equal(isValidEnvVariableName("SUPABASE_URL").ok, true);
  assert.equal(isValidEnvVariableName("gsk_abcdef").ok, false);
  assert.equal(isValidEnvVariableName("DB_PASSWORD").ok, false);
  assert.equal(isValidEnvVariableName("has space").ok, false);
});

test("next action follows the first justified gap", () => {
  const empty = { readiness: { architectureReady: false, gaps: [], reasons: [] }, defects: [] };
  const first = suggestSystemNextAction({
    ...empty,
    architectureStatus: "DRAFT",
    summaryPresent: false,
    componentCount: 0,
    proposedRecordCount: 0,
  });
  assert.match(first?.title ?? "", /Define system architecture summary and components/);
  assert.equal(first?.sourceKind, "system_architecture");

  const review = suggestSystemNextAction({
    ...empty,
    architectureStatus: "DESIGNING",
    summaryPresent: true,
    componentCount: 2,
    proposedRecordCount: 3,
  });
  assert.match(review?.title ?? "", /Review proposed/);

  const ready = suggestSystemNextAction({
    readiness: { architectureReady: true, gaps: [], reasons: ["ok"] },
    defects: [],
    architectureStatus: "APPROVED",
    summaryPresent: true,
    componentCount: 2,
    proposedRecordCount: 0,
  });
  assert.match(ready?.title ?? "", /ARCHITECTURE READY/);

  const done = suggestSystemNextAction({
    readiness: { architectureReady: true, gaps: [], reasons: ["ok"] },
    defects: [],
    architectureStatus: "ARCHITECTURE_READY",
    summaryPresent: true,
    componentCount: 2,
    proposedRecordCount: 0,
  });
  assert.equal(done, null);
});
