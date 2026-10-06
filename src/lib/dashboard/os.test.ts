import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOperatingMetrics,
  containsFakeProgressPercent,
  countOpenDecisionsForProject,
  mapLifecycleToPipelineStage,
  pickActiveProject,
} from "./os";

test("pipeline mapping highlights only the current lifecycle stage", () => {
  assert.equal(mapLifecycleToPipelineStage("BUILD"), "IMPLEMENTATION");
  assert.equal(mapLifecycleToPipelineStage("DESIGN"), "PRODUCT_DEFINITION");
  assert.equal(mapLifecycleToPipelineStage("TEST"), "VERIFICATION");
  assert.equal(mapLifecycleToPipelineStage("DEPLOY"), "DEPLOYMENT");
  assert.equal(mapLifecycleToPipelineStage("unknown"), null);
});

test("operating metrics never invent unverifiable series", () => {
  const withAll = buildOperatingMetrics({
    projectCount: 2,
    openDecisionCount: 3,
    openBlockerCount: 1,
    verifiedItemCount: 4,
    productionProjectCount: 1,
  });
  assert.deepEqual(
    withAll.map((m) => m.key),
    ["projects", "verified", "decisions", "blockers", "production"],
  );

  const withoutOptional = buildOperatingMetrics({
    projectCount: 1,
    openDecisionCount: 0,
    openBlockerCount: 0,
    verifiedItemCount: null,
    productionProjectCount: null,
  });
  assert.deepEqual(
    withoutOptional.map((m) => m.key),
    ["projects", "decisions", "blockers"],
  );
  assert.ok(!withoutOptional.some((m) => /%|complete/i.test(m.label)));
});

test("fake progress percentages are rejected", () => {
  assert.equal(containsFakeProgressPercent("78% complete"), true);
  assert.equal(containsFakeProgressPercent("BUILD · 3 decisions open"), false);
  assert.equal(containsFakeProgressPercent("Requirements: 12"), false);
});

test("active project and decision counts are data-driven", () => {
  assert.equal(pickActiveProject([{ id: "a" }, { id: "b" }])?.id, "a");
  assert.equal(pickActiveProject([]), null);
  assert.equal(
    countOpenDecisionsForProject(
      [
        { projectId: "a" },
        { projectId: "a" },
        { projectId: "b" },
        { projectId: null },
      ],
      "a",
    ),
    2,
  );
});
