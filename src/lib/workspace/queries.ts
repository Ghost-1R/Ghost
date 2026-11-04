import type { GhostClient } from "@/lib/auth/session";
import { listAgentTasksForProject, loadAgentTaskEvents } from "@/lib/agent-runtime/queries";
import { loadFounderAuthorizations } from "@/lib/approvals/queries";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { loadLatestConversation } from "@/lib/conversation/queries";
import { isModelConfigured } from "@/lib/ai/provider";
import { loadBuildPlan } from "@/lib/build-plan/queries";
import { listIdeas, loadIdea } from "@/lib/ideas/queries";
import { fromError, type QueryResult } from "@/lib/result";
import {
  countTaskStatuses,
  deriveWorkspacePhase,
  type WorkspaceArtifact,
  type WorkspaceSnapshot,
} from "./types";

function isMissing(message: string, table: string): boolean {
  return new RegExp(`${table}|does not exist|schema cache`, "i").test(message);
}

export async function loadWorkspaceArtifacts(
  supabase: GhostClient,
  ownerId: string,
  projectId: string,
): Promise<QueryResult<WorkspaceArtifact[]>> {
  const { data, error } = await supabase
    .from("agent_review_artifacts")
    .select("id, task_id, title, content_ref, content_sha256, created_at")
    .eq("owner_id", ownerId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(24);

  if (error) {
    if (isMissing(error.message, "agent_review_artifacts")) return { status: "ok", data: [] };
    return fromError(error);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    task_id: string;
    title: string;
    content_ref: string;
    content_sha256: string;
    created_at: string;
  }>;

  return {
    status: "ok",
    data: rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      title: row.title,
      content: row.content_ref,
      contentSha256: row.content_sha256,
      createdAt: row.created_at,
      previewable: true,
    })),
  };
}

export async function loadWorkspaceSnapshot(
  supabase: GhostClient,
  input: { ownerId: string; projectId: string; projectName: string; goalId?: string | null },
): Promise<QueryResult<WorkspaceSnapshot>> {
  const [ideas, conversation, plan, tasks, approvals, artifacts] = await Promise.all([
    listIdeas(supabase),
    loadLatestConversation(supabase, input.projectId),
    loadBuildPlan(supabase, input.projectId),
    listAgentTasksForProject(supabase, input.ownerId, input.projectId),
    loadFounderAuthorizations(supabase, input.ownerId),
    loadWorkspaceArtifacts(supabase, input.ownerId, input.projectId),
  ]);

  const softMissing = (message: string) =>
    /does not exist|schema cache|not available/i.test(message);

  if (ideas.status === "error" && !softMissing(ideas.message)) return ideas;
  if (conversation.status === "error" && !softMissing(conversation.message)) return conversation;
  if (plan.status === "error" && !softMissing(plan.message)) return plan;
  if (tasks.status === "error") return tasks;
  if (approvals.status === "error") return approvals;
  if (artifacts.status === "error") return artifacts;

  const ideaRows = ideas.status === "ok" ? ideas.data : [];
  const conversationThread = conversation.status === "ok" ? conversation.data : null;
  const planRow = plan.status === "ok" ? plan.data : null;

  const goalOptions = ideaRows.filter(
    (idea) => idea.promotedProjectId === input.projectId || idea.promotedProjectId == null,
  );
  const selectedGoalId =
    input.goalId && goalOptions.some((idea) => idea.id === input.goalId)
      ? input.goalId
      : goalOptions.find((idea) => idea.promotedProjectId === input.projectId)?.id ??
        goalOptions[0]?.id ??
        null;

  const goal =
    selectedGoalId != null
      ? await loadIdea(supabase, selectedGoalId)
      : { status: "ok" as const, data: null };
  if (goal.status === "error") return goal;

  const projectApprovals = approvals.data.filter((auth) => auth.projectId === input.projectId);
  const pendingApprovals = projectApprovals.filter(
    (auth) => auth.effectiveStatus === "PENDING" || auth.status === "PENDING",
  );
  const events =
    tasks.data[0] != null
      ? await loadAgentTaskEvents(supabase, input.ownerId, tasks.data[0].id)
      : { status: "ok" as const, data: [] };
  if (events.status === "error") {
    // Missing events table is not fatal for the workspace shell.
    if (!/not available|does not exist|schema cache/i.test(events.message)) return events;
  }

  const counts = {
    ...countTaskStatuses(tasks.data),
    awaitingApproval: pendingApprovals.length,
  };
  const derived = deriveWorkspacePhase({
    tasks: tasks.data,
    pendingApprovals: pendingApprovals.length,
    hasPlan: Boolean(planRow),
  });

  return {
    status: "ok",
    data: {
      projectId: input.projectId,
      projectName: input.projectName,
      goal: goal.status === "ok" ? goal.data : null,
      goalOptions,
      conversationId: conversationThread?.id ?? null,
      messages: conversationThread?.messages ?? [],
      plan: planRow,
      tasks: tasks.data,
      events: events.status === "ok" ? events.data : [],
      artifacts: artifacts.data,
      approvals: projectApprovals,
      counts,
      phase: derived.phase,
      currentTaskId: derived.currentTaskId,
      lastActivityAt:
        tasks.data[0]?.updatedAt ?? conversationThread?.messages.at(-1)?.createdAt ?? null,
      providerConfigured: isModelConfigured(),
      liveEnabled: isCodegenLiveEnabled(),
      executionMode: "MOCK_ONLY",
    },
  };
}

export async function loadWorkspaceStatus(
  supabase: GhostClient,
  input: { ownerId: string; projectId: string },
): Promise<QueryResult<{ counts: ReturnType<typeof countTaskStatuses>; phase: string; updatedAt: string }>> {
  const tasks = await listAgentTasksForProject(supabase, input.ownerId, input.projectId, { limit: 40 });
  if (tasks.status === "error") return tasks;
  const derived = deriveWorkspacePhase({ tasks: tasks.data, pendingApprovals: 0, hasPlan: false });
  return {
    status: "ok",
    data: {
      counts: countTaskStatuses(tasks.data),
      phase: derived.phase,
      updatedAt: tasks.data[0]?.updatedAt ?? new Date().toISOString(),
    },
  };
}
