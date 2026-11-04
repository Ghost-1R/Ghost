import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOperatingMetrics,
  containsFakeProgressPercent,
  mapLifecycleToPipelineStage,
} from "./os";

test("CEO home refuses fake analytics and hardcoding", () => {
  const page = readFileSync(new URL("../../app/(workspace)/dashboard/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("rankTop3Actions"));
  assert.ok(page.includes("loadOpenDecisions"));
  assert.ok(page.includes("loadProjectSummaries"));
  assert.ok(page.includes("moneyStatusPhase1"));
  assert.ok(page.includes("whoMightCallSection"));
  assert.ok(page.includes("buildRedLights"));
  assert.ok(page.includes("Ask Ghost"));
  assert.ok(page.includes("id=\"ask-ghost\""));
  assert.ok(page.includes("Blockers"));
  assert.ok(page.includes("Priorities"));
  assert.ok(page.includes("Next useful action"));
  assert.ok(page.includes("TODAY") || page.includes("Today"));
  assert.ok(!/Cleaning Business/.test(page));
  assert.ok(!/78\s*%|Tasks completed|Bugs resolved|\$0 MRR|fake progress/i.test(page));
  assert.ok(!containsFakeProgressPercent(page));
  assert.ok(page.includes("loadRecentActivity"));
  assert.ok(page.includes("loadProjectTruthSnapshot"));
  assert.ok(page.includes("ProjectTruthPanel"));
  assert.ok(!page.includes("OS_PIPELINE_STAGES"));
  assert.ok(!/Continue →/.test(page));
  assert.ok(!page.includes("@/lib/agent-runtime"));
});

test("imported BUILD projects still map pipeline for deeper OS views", () => {
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
});

test("shell navigation is the founder-facing six destinations", () => {
  const shell = readFileSync(new URL("../../components/shell/app-shell.tsx", import.meta.url), "utf8");
  for (const label of ["Today", "Projects", "Worker", "Files", "Decisions", "Settings"]) {
    assert.ok(shell.includes(`label: "${label}"`), label);
  }
  assert.ok(shell.includes("/files"));
  assert.ok(shell.includes("/decisions"));
  assert.ok(shell.includes("/workspace"));
  assert.ok(!shell.includes("/agent-tasks"), "must not expose Agent Tasks without schema");
  assert.ok(!shell.includes('label: "Build"'));
  assert.ok(!shell.includes('label: "System"'));
});
