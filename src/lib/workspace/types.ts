import type { AgentTask, AgentTaskAuditEvent, AgentTaskStatus } from "@/lib/agent-runtime/types";
import type { FounderActionAuthorization } from "@/lib/approvals/types";
import type { ConversationMessage } from "@/lib/conversation/queries";
import type { IdeaListItem, IdeaRecord } from "@/lib/ideas/types";
import type { BuildPlan } from "@/lib/build-plan/types";

export const WORKSPACE_PHASES = [
  "PROPOSAL",
  "QUEUED",
  "ACTIVE",
  "PAUSED",
  "AWAITING_APPROVAL",
  "VERIFIED",
  "FAILED",
  "IDLE",
] as const;

export type WorkspacePhase = (typeof WORKSPACE_PHASES)[number];

export type WorkspaceArtifact = {
  id: string;
  taskId: string;
  title: string;
  content: string;
  contentSha256: string;
  createdAt: string;
  previewable: boolean;
};

export type WorkspaceCounts = {
  queued: number;
  running: number;
  blocked: number;
  failed: number;
  completed: number;
  awaitingApproval: number;
};

export type WorkspaceSnapshot = {
  projectId: string;
  projectName: string;
  goal: IdeaRecord | null;
  goalOptions: IdeaListItem[];
  conversationId: string | null;
  messages: ConversationMessage[];
  plan: BuildPlan | null;
  tasks: AgentTask[];
  events: AgentTaskAuditEvent[];
  artifacts: WorkspaceArtifact[];
  approvals: FounderActionAuthorization[];
  counts: WorkspaceCounts;
  phase: WorkspacePhase;
  currentTaskId: string | null;
  lastActivityAt: string | null;
  providerConfigured: boolean;
  liveEnabled: boolean;
  executionMode: "MOCK_ONLY" | "DISABLED";
};

export function countTaskStatuses(tasks: readonly Pick<AgentTask, "status">[]): Omit<
  WorkspaceCounts,
  "awaitingApproval"
> {
  const counts = { queued: 0, running: 0, blocked: 0, failed: 0, completed: 0 };
  for (const task of tasks) {
    if (task.status === "QUEUED") counts.queued += 1;
    else if (task.status === "CLAIMED" || task.status === "RUNNING" || task.status === "CHECKPOINT") {
      counts.running += 1;
    } else if (task.status === "BLOCKED") counts.blocked += 1;
    else if (task.status === "FAILED") counts.failed += 1;
    else if (task.status === "SUCCEEDED") counts.completed += 1;
  }
  return counts;
}

export function deriveWorkspacePhase(input: {
  tasks: readonly Pick<AgentTask, "id" | "status">[];
  pendingApprovals: number;
  hasPlan: boolean;
}): { phase: WorkspacePhase; currentTaskId: string | null } {
  const running = input.tasks.find(
    (task) => task.status === "RUNNING" || task.status === "CLAIMED" || task.status === "CHECKPOINT",
  );
  if (running) return { phase: "ACTIVE", currentTaskId: running.id };
  const blocked = input.tasks.find((task) => task.status === "BLOCKED");
  if (blocked) return { phase: "PAUSED", currentTaskId: blocked.id };
  const failed = input.tasks.find((task) => task.status === "FAILED");
  if (failed) return { phase: "FAILED", currentTaskId: failed.id };
  if (input.pendingApprovals > 0) return { phase: "AWAITING_APPROVAL", currentTaskId: null };
  const queued = input.tasks.find((task) => task.status === "QUEUED");
  if (queued) return { phase: "QUEUED", currentTaskId: queued.id };
  const succeeded = input.tasks.find((task) => task.status === "SUCCEEDED");
  if (succeeded) return { phase: "VERIFIED", currentTaskId: succeeded.id };
  if (input.hasPlan) return { phase: "PROPOSAL", currentTaskId: null };
  return { phase: "IDLE", currentTaskId: null };
}

export function workspaceTaskHref(projectId: string, goalId?: string | null): string {
  const base = `/projects/${projectId}/workspace`;
  return goalId ? `${base}?goal=${encodeURIComponent(goalId)}` : base;
}

export function isActiveWorkspaceStatus(status: AgentTaskStatus): boolean {
  return status === "QUEUED" || status === "CLAIMED" || status === "RUNNING" || status === "CHECKPOINT";
}
