/**
 * Build 09.6 ships the approval-bound task *contract* only.
 * Agent workers remain disabled — no activation, no live model calls, no Docker workloads.
 */

export type AgentExecutionGuardResult = {
  enabled: boolean;
  status: "DISABLED";
  detail: string;
};

/**
 * Hard-disable agent worker activation for this build.
 * Even if GHOST_AGENT_EXECUTION_ENABLED=1, workers must not start from this contract layer.
 */
export function getAgentExecutionGuard(): AgentExecutionGuardResult {
  const flagSet = process.env.GHOST_AGENT_EXECUTION_ENABLED?.trim() === "1";
  return {
    enabled: false,
    status: "DISABLED",
    detail: flagSet
      ? "GHOST_AGENT_EXECUTION_ENABLED is set, but Build 09.6 keeps agent workers disabled — approval-bound contract only."
      : "Agent workers are disabled. Approval-bound task contract is available for authorization binding and revalidation only.",
  };
}

export function assertAgentExecutionDisabled(): true {
  const guard = getAgentExecutionGuard();
  if (guard.enabled) {
    throw new Error("Agent execution must remain disabled in Build 09.6.");
  }
  return true;
}

/** Refuse to start workers — always. */
export function activateAgentWorker(_taskId: string): never {
  void _taskId;
  assertAgentExecutionDisabled();
  throw new Error("AGENT_EXECUTION_DISABLED: workers are not activated in Build 09.6.");
}
