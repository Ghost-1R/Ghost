import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("development-tasks page wires real workflow handlers and forbids fake metrics", () => {
  const page = readFileSync(
    new URL("../../app/(workspace)/development-tasks/page.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(page.includes("loadRemoteDevTasks"));
  assert.ok(page.includes("toFounderInboxCard"));
  assert.ok(page.includes("submitDevelopmentRequest"));
  assert.ok(page.includes("approveDevelopmentWorkflow"));
  assert.ok(page.includes("queueDevelopmentWorkflow"));
  assert.ok(page.includes("executeDurableCodegenWorkflow"));
  assert.ok(page.includes("executeDurableCodegenLiveWorkflow"));
  assert.ok(page.includes("Run MOCK codegen + Docker validate"));
  assert.ok(page.includes("LIVE entrypoint disabled"));
  assert.ok(page.includes("runSimulatedDevelopmentWorkflow"));
  assert.ok(page.includes("reviewDevelopmentWorkflow"));
  assert.ok(page.includes("reviewDurableDevelopmentWorkflow"));
  assert.ok(page.includes("verifyDevelopmentEvidenceWorkflow"));
  assert.ok(page.includes("Independently verify SIMULATED evidence"));
  assert.ok(page.includes("Confirm documented ACCEPT (durable)"));
  assert.ok(page.includes("Request changes"));
  assert.ok(page.includes("previously documented founder decision") || page.includes("Previously documented founder decision"));
  assert.ok(page.includes("Nothing is auto-submitted") || page.includes("nothing is auto-submitted"));
  assert.ok(page.includes("Pilot03RequestFields"));
  assert.ok(page.includes("listVerifiedCodingOptions"));
  assert.ok(page.includes("loadProjectAllowanceSnapshot"));
  assert.ok(page.includes("founderStatusLabel"));
  assert.ok(page.includes("evidenceAttributionLabel"));
  assert.ok(page.includes("projectDevelopmentState"));
  assert.ok(page.includes("agent_tasks"));
  assert.ok(page.includes("SIMULATED"));
  assert.ok(page.includes("MOCK_GENERATION"));
  assert.ok(page.includes("LIVE_PROVIDER"));
  assert.ok(page.includes("MEMORY_PERSISTENCE_MODE"));
  assert.ok(page.includes("Deployment authorized: no"));
  assert.ok(page.includes("fail closed"));
  assert.ok(page.includes('data-live-entrypoint="disabled"'));
  assert.ok(!/fake task|sample task|78\s*%|velocity/i.test(page));
  assert.ok(!page.includes("silently bypass"));
});
