import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOperatingMetrics,
  containsFakeProgressPercent,
  mapLifecycleToPipelineStage,
} from "./os";

test("dashboard page refuses fake analytics language", () => {
  const page = readFileSync(new URL("../../app/(workspace)/dashboard/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("loadTodayActions"));
  assert.ok(page.includes("loadOpenDecisions"));
  assert.ok(page.includes("loadProjectSummaries"));
  assert.ok(page.includes("loadRecentActivity"));
  assert.ok(page.includes("pickActiveProject"));
  assert.ok(!/78\s*%|Tasks completed|Bugs resolved|3 deployments|fake progress/i.test(page));
  assert.ok(!containsFakeProgressPercent(page));
});

test("imported BUILD projects highlight Implementation only", () => {
  assert.equal(mapLifecycleToPipelineStage("BUILD"), "IMPLEMENTATION");
  const metrics = buildOperatingMetrics({
    projectCount: 1,
    openDecisionCount: 3,
    openBlockerCount: 1,
    verifiedItemCount: 0,
    productionProjectCount: 1,
  });
  assert.equal(metrics.find((m) => m.key === "decisions")?.value, 3);
  assert.equal(metrics.find((m) => m.key === "blockers")?.value, 1);
  assert.equal(metrics.find((m) => m.key === "projects")?.value, 1);
});

test("shell navigation follows Ghost operating sequence", () => {
  const shell = readFileSync(new URL("../../components/shell/app-shell.tsx", import.meta.url), "utf8");
  const order = [
    "Dashboard",
    "Brain",
    "Idea Lab",
    "Strategy",
    "Product Architect",
    "System Architecture",
    "Build Plan",
    "Build Execution",
    "Test & Verification",
    "Deploy",
    "Memory",
    "Patterns",
    "Inspector",
    "Presentation",
    "Settings",
  ];
  let cursor = -1;
  for (const label of order) {
    const next = shell.indexOf(`label: "${label}"`);
    assert.ok(next > cursor, `missing or out of order: ${label}`);
    cursor = next;
  }
  assert.ok(shell.includes("New Project"));
  assert.ok(shell.includes("All Projects"));
});
