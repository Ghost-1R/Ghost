"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { loadAuthorizationById } from "@/lib/approvals/queries";
import {
  insertAgentTaskCheckpoint,
  insertReviewArtifact,
  loadAgentTaskById,
  persistAgentTaskState,
} from "@/lib/agent-runtime/queries";
import { runBoundedMockWorkerTurn } from "@/lib/agent-runtime/mock-worker";
import {
  createCheckpointReviewArtifact,
  createReviewArtifact,
} from "@/lib/agent-runtime/review-artifacts";
import { applyBlockToTask } from "@/lib/agent-runtime/workflow";
import { getSession } from "@/lib/auth/session";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import {
  explainMockNotice,
  friendlyArtifactTitle,
} from "@/lib/dashboard/result-labels";
import { isTestSessionExpired } from "@/lib/dashboard/today-board";
import { planWorkspaceControl, type WorkspaceControl } from "./workflow";

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function refresh(projectId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/approvals");
  revalidatePath("/files");
  revalidatePath("/decisions");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/workspace`);
}

export async function controlWorkspaceTask(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "Sign in required.", notice: null };
  }
  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const control = readField(formData, "control") as WorkspaceControl;
  if (!projectId || !taskId || !["PAUSE", "RESUME", "CANCEL"].includes(control)) {
    return { error: "Task control is incomplete.", notice: null };
  }

  const loaded = await loadAgentTaskById(session.supabase, session.user.id, taskId);
  if (loaded.status === "error") return { error: loaded.message, notice: null };
  if (!loaded.data || loaded.data.projectId !== projectId) {
    return { error: "Task is not in this project.", notice: null };
  }

  const plan = planWorkspaceControl(loaded.data, { ownerId: session.user.id, control });
  if (!plan.ok) return { error: plan.message, notice: null };

  const next =
    control === "PAUSE"
      ? applyBlockToTask(loaded.data, plan.detail, new Date().toISOString())
      : {
          ...loaded.data,
          status: plan.toStatus,
          updatedAt: new Date().toISOString(),
          blockReason: control === "RESUME" ? "" : loaded.data.blockReason,
          lease: control === "CANCEL" || control === "RESUME" ? null : loaded.data.lease,
          completedAt:
            control === "CANCEL" ? new Date().toISOString() : loaded.data.completedAt,
        };

  const persisted = await persistAgentTaskState(session.supabase, next);
  if (persisted.status === "error") return { error: persisted.message, notice: null };
  refresh(projectId);
  return { error: null, notice: plan.detail };
}

export async function runWorkspaceMockTurn(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "Sign in required.", notice: null };
  }
  if (isCodegenLiveEnabled()) {
    return { error: "Mock worker is refused while LIVE is enabled.", notice: null };
  }

  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  if (!projectId || !taskId) return { error: "Select a queued task first.", notice: null };

  const loaded = await loadAgentTaskById(session.supabase, session.user.id, taskId);
  if (loaded.status === "error") return { error: loaded.message, notice: null };
  if (!loaded.data || loaded.data.projectId !== projectId) {
    return { error: "Task is not in this project.", notice: null };
  }

  if (
    isTestSessionExpired({
      status: loaded.data.status,
      leaseExpiresAt: loaded.data.lease?.expiresAt ?? null,
    })
  ) {
    return {
      error:
        "This test session expired. View the saved step on Worker, or start a new review from Today.",
      notice: null,
    };
  }

  const auth = await loadAuthorizationById(
    session.supabase,
    session.user.id,
    loaded.data.binding.authorizationId,
  );
  if (auth.status === "error") return { error: auth.message, notice: null };

  const turn = runBoundedMockWorkerTurn({
    task: loaded.data,
    authorization: auth.data,
    ownerId: session.user.id,
  });
  if (!turn.ok) return { error: turn.message, notice: null };

  const persisted = await persistAgentTaskState(session.supabase, turn.task);
  if (persisted.status === "error") return { error: persisted.message, notice: null };
  if (turn.task.lastCheckpointId) {
    const checkpoint = {
      id: turn.task.lastCheckpointId,
      sequence: turn.task.checkpointSequence,
      label: turn.stepLabel,
      progressRef: `checkpoint:${turn.task.id}:${turn.task.checkpointSequence}`,
      createdAt: turn.task.updatedAt,
      authorizationId: turn.task.binding.authorizationId,
      scopeFingerprint: turn.task.binding.scopeFingerprint,
    };
    await insertAgentTaskCheckpoint(session.supabase, {
      ownerId: session.user.id,
      taskId: turn.task.id,
      checkpoint,
    });
    const snapshot = createCheckpointReviewArtifact(turn.task, checkpoint, turn.task.updatedAt);
    if (snapshot.ok) {
      const labeled = createReviewArtifact({
        task: turn.task,
        kind: snapshot.artifact.kind,
        title: friendlyArtifactTitle({
          completed: false,
          checkpointSequence: turn.task.checkpointSequence,
        }),
        contentRef: [
          snapshot.artifact.contentRef,
          "mode=MOCK_GENERATION",
          "chargedCents=0",
          `checkpoints=${turn.task.checkpointSequence}`,
        ].join("\n"),
        at: turn.task.updatedAt,
      });
      if (labeled.ok) await insertReviewArtifact(session.supabase, labeled.artifact);
    }
  }
  if (turn.completed) {
    const result = createReviewArtifact({
      task: turn.task,
      kind: "DIFF_SUMMARY",
      title: friendlyArtifactTitle({
        completed: true,
        checkpointSequence: turn.task.checkpointSequence,
        actionType: turn.task.binding.actionType,
      }),
      contentRef: [
        "mode=MOCK_GENERATION",
        `task=${turn.task.id}`,
        `project=${turn.task.projectId}`,
        `checkpoints=${turn.task.checkpointSequence}`,
        `status=${turn.task.status}`,
        "liveHttpInvoked=false",
        "chargedCents=0",
        "label=Test run completed",
      ].join("\n"),
      at: turn.task.updatedAt,
    });
    if (result.ok) {
      await insertReviewArtifact(session.supabase, result.artifact);
    }
  }
  refresh(projectId);
  return {
    error: null,
    notice: explainMockNotice({
      completed: turn.completed,
      checkpointSequence: turn.task.checkpointSequence,
      chargedCents: turn.chargedCents,
    }),
  };
}

export async function saveWorkspacePlanNote(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "Sign in required.", notice: null };
  }
  const projectId = readField(formData, "projectId");
  const summary = readField(formData, "summary");
  if (!projectId) return { error: "Project is required.", notice: null };
  if (summary.length < 8) return { error: "Plan needs at least a short proposed summary.", notice: null };

  const existing = await session.supabase
    .from("build_plans")
    .select("id, status")
    .eq("project_id", projectId)
    .maybeSingle();
  if (existing.error && !/does not exist|schema cache/i.test(existing.error.message)) {
    return { error: existing.error.message, notice: null };
  }
  if (!existing.data) {
    refresh(projectId);
    return {
      error: null,
      notice: "No Build Plan row yet. Open Build Plan to initialize architecture-backed planning.",
    };
  }
  if (existing.data.status !== "DRAFT" && existing.data.status !== "REVIEW" && existing.data.status !== "PLANNING") {
    return {
      error: `Plan status ${existing.data.status} is not editable here. Change it on the Build Plan page.`,
      notice: null,
    };
  }
  const updated = await session.supabase
    .from("build_plans")
    .update({ summary, updated_at: new Date().toISOString() })
    .eq("id", existing.data.id)
    .eq("project_id", projectId);
  if (updated.error) return { error: updated.error.message, notice: null };
  refresh(projectId);
  return { error: null, notice: "Proposed plan updated. Execution still requires approval." };
}
