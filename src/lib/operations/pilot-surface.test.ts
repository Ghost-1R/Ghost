import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPilotEvidencePack } from "@/lib/agent-runtime/pilot-evidence";
import { runIsolatedPilot } from "@/lib/agent-runtime/pilot-executor";
import { PILOT_ENV_FLAG } from "@/lib/agent-runtime/pilot-config";
import { pilotEvidenceToActivity, summarizePilotEvidenceForOps } from "./pilot-surface";

test("pilot surface summarizes evidence without inventing PASS", () => {
  const previous = process.env[PILOT_ENV_FLAG];
  delete process.env[PILOT_ENV_FLAG];
  try {
    const report = runIsolatedPilot({ forceDryRun: true });
    const pack = buildPilotEvidencePack(report);
    const summary = summarizePilotEvidenceForOps(pack);
    assert.equal(summary.build, "09.9");
    assert.equal(summary.classification, "BLOCKED");
    assert.equal(summary.realContainerExecution, false);
    const activity = pilotEvidenceToActivity(pack, { id: "p1", name: "Ghost" });
    assert.match(activity.title, /BLOCKED|NOT_RUN|FAIL|PARTIAL|PASS/);
    assert.ok(!/%|velocity/i.test(activity.detail));
  } finally {
    if (previous === undefined) delete process.env[PILOT_ENV_FLAG];
    else process.env[PILOT_ENV_FLAG] = previous;
  }
});

test("settings page remains free of pilot activation controls", () => {
  const settings = readFileSync(new URL("../../app/(workspace)/settings/page.tsx", import.meta.url), "utf8");
  assert.ok(!settings.includes("GHOST_ISOLATED_PILOT_ENABLED"));
  assert.ok(!settings.includes("runIsolatedPilot"));
  assert.ok(!settings.includes("@/lib/agent-runtime"));
});
