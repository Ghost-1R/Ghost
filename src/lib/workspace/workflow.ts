import type { AgentTask } from "@/lib/agent-runtime/types";
import { decideAgentTaskTransition } from "@/lib/agent-runtime/workflow";

export type WorkspaceControl = "PAUSE" | "RESUME" | "CANCEL";

export function planWorkspaceControl(
  task: Pick<AgentTask, "id" | "ownerId" | "status">,
  input: { ownerId: string; control: WorkspaceControl },
):
  | { ok: true; toStatus: AgentTask["status"]; detail: string }
  | { ok: false; reason: string; message: string } {
  if (task.ownerId !== input.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: "Only the owning founder can control this task." };
  }

  const target =
    input.control === "PAUSE" ? "BLOCKED" : input.control === "RESUME" ? "QUEUED" : "CANCELLED";

  if (input.control === "PAUSE" && (task.status === "QUEUED" || task.status === "SUCCEEDED")) {
    return {
      ok: false,
      reason: "NOT_PAUSABLE",
      message: `A ${task.status} task has no in-flight step to pause.`,
    };
  }

  const decision = decideAgentTaskTransition(task, {
    ownerId: input.ownerId,
    toStatus: target,
    detail:
      input.control === "PAUSE"
        ? "Paused by founder. Resume returns the task to QUEUED from the last checkpoint."
        : input.control === "RESUME"
          ? "Resumed by founder from last safe checkpoint. No external side effect is replayed."
          : "Cancelled by founder.",
  });
  if (!decision.ok) {
    return { ok: false, reason: "ILLEGAL_TRANSITION", message: decision.reason };
  }
  return { ok: true, toStatus: decision.nextStatus, detail: decision.detail };
}
