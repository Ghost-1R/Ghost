import assert from "node:assert/strict";
import { test } from "node:test";
import { buildControlCenterStatus } from "./status";
import { DEFAULT_FOUNDER_PREFERENCES } from "./types";

test("control center status never claims agents are deployed on Settings V1", () => {
  const previous = process.env.GHOST_AGENT_EXECUTION_ENABLED;
  delete process.env.GHOST_AGENT_EXECUTION_ENABLED;
  try {
    const status = buildControlCenterStatus(DEFAULT_FOUNDER_PREFERENCES);
    assert.equal(status.agentExecution, "NOT_DEPLOYED");
    assert.equal(status.hostedAgentAllowed, false);
    assert.match(status.emergencyStop, /not enabled|No Settings control/i);
    assert.match(status.consequentialPolicy, /CONSEQUENTIAL|Soft gate/i);
    assert.ok(!/credential|api[_-]?key|gsk_|sk-/i.test(JSON.stringify(status)));
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENT_EXECUTION_ENABLED;
    else process.env.GHOST_AGENT_EXECUTION_ENABLED = previous;
  }
});
