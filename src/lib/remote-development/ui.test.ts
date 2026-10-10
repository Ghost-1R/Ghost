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
  assert.ok(page.includes("runSimulatedDevelopmentWorkflow"));
  assert.ok(page.includes("reviewDevelopmentWorkflow"));
  assert.ok(page.includes("verifyDevelopmentEvidenceWorkflow"));
  assert.ok(page.includes("Independently verify SIMULATED evidence"));
  assert.ok(page.includes("SIMULATED"));
  assert.ok(page.includes("MEMORY_PERSISTENCE_MODE"));
  assert.ok(page.includes("Deployment authorized: no"));
  assert.ok(!/fake task|sample task|78\s*%|velocity/i.test(page));
  assert.ok(!page.includes("silently bypass"));
});
