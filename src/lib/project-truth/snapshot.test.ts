import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleProjectTruthSnapshot, deriveOverallOperationalState } from "./snapshot";
import type { FacetTruth } from "./types";

test("SUCCEEDED alone is DEPLOYED, not VERIFIED_IN_PRODUCTION", () => {
  const snapshot = assembleProjectTruthSnapshot({
    projectId: "p1",
    projectName: "Ghost",
    attempts: [
      {
        id: "d1",
        projectId: "p1",
        status: "SUCCEEDED",
        createdAt: "2026-03-10T12:00:00.000Z",
        humanId: "DEP-1",
      },
    ],
  });
  assert.equal(snapshot.deployment.state, "DEPLOYED");
  assert.notEqual(snapshot.deployment.state, "VERIFIED_IN_PRODUCTION");
  assert.equal(snapshot.overallState, "DEPLOYED");
});

test("historical failures remain accessible after supersession", () => {
  const snapshot = assembleProjectTruthSnapshot({
    projectId: "p1",
    projectName: "Ghost",
    attempts: [
      {
        id: "fail",
        projectId: "p1",
        status: "FAILED",
        createdAt: "2026-03-01T10:00:00.000Z",
        environmentId: "env-1",
      },
      {
        id: "ok",
        projectId: "p1",
        status: "SUCCEEDED",
        createdAt: "2026-03-10T12:00:00.000Z",
        environmentId: "env-1",
      },
    ],
  });
  assert.equal(snapshot.currentFailures.length, 0);
  assert.equal(snapshot.historicalFailures.length, 1);
  assert.equal(snapshot.historicalFailures[0]?.id, "fail");
  assert.equal(snapshot.deployment.state, "DEPLOYED");
});

test("open blockers elevate overall state and next action", () => {
  const snapshot = assembleProjectTruthSnapshot({
    projectId: "p1",
    projectName: "Ghost",
    attempts: [],
    blockers: [{ id: "b1", title: "DNS", at: "2026-03-01T00:00:00.000Z", href: "/projects/p1" }],
  });
  assert.equal(snapshot.overallState, "BLOCKED");
  assert.match(snapshot.nextAction.nextAction ?? "", /blockers/i);
});

test("founder decisions prioritize next action without inventing production status", () => {
  const snapshot = assembleProjectTruthSnapshot({
    projectId: "p1",
    projectName: "Ghost",
    attempts: [
      {
        id: "ok",
        projectId: "p1",
        status: "SUCCEEDED",
        createdAt: "2026-03-10T12:00:00.000Z",
      },
    ],
    openDecisions: [
      { id: "dec1", title: "Approve DNS cutover", at: null, href: "/projects/p1" },
    ],
  });
  assert.equal(snapshot.deployment.state, "DEPLOYED");
  assert.match(snapshot.nextAction.nextAction ?? "", /founder decision/i);
});

test("local and production facets stay distinct", () => {
  const snapshot = assembleProjectTruthSnapshot({
    projectId: "p1",
    projectName: "Ghost",
    attempts: [
      {
        id: "ok",
        projectId: "p1",
        status: "SUCCEEDED",
        createdAt: "2026-03-10T12:00:00.000Z",
      },
    ],
    productionVerified: true,
    hasFreshInspectorPass: false,
  });
  assert.equal(snapshot.deployment.state, "VERIFIED_IN_PRODUCTION");
  assert.equal(snapshot.verification.state, "UNKNOWN");
});

test("deriveOverallOperationalState prefers BLOCKED/FAILED over quieter states", () => {
  const facets: FacetTruth[] = [
    {
      facet: "deployment",
      state: "DEPLOYED",
      summary: "ok",
      evidence: [],
      nextAction: null,
    },
    {
      facet: "verification",
      state: "FAILED",
      summary: "bad",
      evidence: [],
      nextAction: "fix",
    },
  ];
  assert.equal(deriveOverallOperationalState(facets), "FAILED");
});

test("operations surfaces wire Project Truth without agent-runtime", () => {
  const files = [
    new URL("../../app/(workspace)/dashboard/page.tsx", import.meta.url),
    new URL("../../app/(workspace)/projects/[id]/page.tsx", import.meta.url),
    new URL("../../app/(workspace)/projects/[id]/deploy/page.tsx", import.meta.url),
    new URL("../../app/(workspace)/inspector/page.tsx", import.meta.url),
    new URL("../../components/operations/project-truth-panel.tsx", import.meta.url),
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes("ProjectTruth"), file.pathname);
    assert.ok(!source.includes("@/lib/agent-runtime"), file.pathname);
    assert.ok(!/Tasks completed|78\s*%|fake progress/i.test(source), file.pathname);
  }
});
