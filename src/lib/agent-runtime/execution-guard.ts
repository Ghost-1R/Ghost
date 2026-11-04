/**
 * Builds 09.6–09.8 ship approval-bound contract, workspace/Docker specs, and queue foundations.
 * Agent workers remain disabled — no activation, no live model calls, no Docker invoke.
 */

export type AgentExecutionGuardResult = {
  enabled: boolean;
  status: "DISABLED";
  detail: string;
};

/**
 * Hard-disable agent worker activation.
 * Even if GHOST_AGENT_EXECUTION_ENABLED=1, workers must not start from this layer.
 */
export function getAgentExecutionGuard(): AgentExecutionGuardResult {
  const flagSet = process.env.GHOST_AGENT_EXECUTION_ENABLED?.trim() === "1";
  return {
    enabled: false,
    status: "DISABLED",
    detail: flagSet
      ? "GHOST_AGENT_EXECUTION_ENABLED is set, but workers stay disabled — contract/queue only until founder activation."
      : "Agent workers are disabled. Approval-bound contract, workspace safeguards, and queue foundations are available without activation.",
  };
}

export function assertAgentExecutionDisabled(): true {
  const guard = getAgentExecutionGuard();
  if (guard.enabled) {
    throw new Error("Agent execution must remain disabled until founder-gated activation.");
  }
  return true;
}

/** Refuse to start workers — always. */
export function activateAgentWorker(_taskId: string): never {
  void _taskId;
  assertAgentExecutionDisabled();
  throw new Error("AGENT_EXECUTION_DISABLED: workers are not activated.");
}
