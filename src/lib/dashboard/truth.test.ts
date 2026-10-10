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
  assert.ok(page.includes("What is true"));
  assert.ok(page.includes("Needs a decision"));
  assert.ok(page.includes("What happens next"));
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

test("shell navigation keeps deep OS routes under progressive disclosure", () => {
  const shell = readFileSync(new URL("../../components/shell/app-shell.tsx", import.meta.url), "utf8");
  for (const label of [
    "Ask Ghost",
    "Home",
    "Active Project",
    "Projects",
    "Memory",
    "Idea Lab",
    "Product Architect",
    "System Architecture",
    "Build Plan",
    "Build Execution",
    "Verification",
    "Deploy",
    "Approvals",
    "Inspector",
    "Presentation",
    "Settings",
  ]) {
    assert.ok(shell.includes(`label: "${label}"`) || shell.includes(label), label);
  }
  assert.ok(!shell.includes("/agent-tasks"), "interface release must not expose Agent Tasks without schema");
  assert.ok(shell.includes("collapsible"));
  assert.ok(shell.includes("os-nav-collapse"));
  assert.ok(shell.includes('label: "Build"'));
  assert.ok(shell.includes('label: "System"'));
});
