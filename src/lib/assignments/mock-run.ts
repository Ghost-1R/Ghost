import type { GhostClient } from "@/lib/auth/session";
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
import { loadAuthorizationById } from "@/lib/approvals/queries";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import { explainMockNotice, friendlyArtifactTitle } from "@/lib/dashboard/result-labels";

export type MockAssignmentRun =
  | {
      ok: true;
      completed: boolean;
      checkpoints: number;
      notice: string;
      /** Plain-language summary stored on the AI assignment. */
      summary: string;
    }
  | { ok: false; error: string };

/**
 * MOCK-only worker pass for an AI assignment.
 *
 * Mirrors `confirmWorkerTestReview` (src/lib/dashboard/day-plan-actions.ts) without the
 * redirect: bounded deterministic mock turns, saved step snapshots, and a final saved
 * result. It never calls a paid provider and refuses outright when LIVE is enabled.
 */
export async function runMockAssignmentReview(input: {
  supabase: GhostClient;
  ownerId: string;
  projectId: string;
  taskId: string;
  assignmentId: string;
}): Promise<MockAssignmentRun> {
  if (isCodegenLiveEnabled()) {
    return { ok: false, error: "AI assignments are refused while LIVE is enabled." };
  }

  const { supabase, ownerId, projectId, taskId, assignmentId } = input;
  const loaded = await loadAgentTaskById(supabase, ownerId, taskId);
  if (loaded.status === "error") return { ok: false, error: loaded.message };
  if (!loaded.data || loaded.data.projectId !== projectId) {
    return { ok: false, error: "Task is not in this project." };
  }

  const auth = await loadAuthorizationById(supabase, ownerId, loaded.data.binding.authorizationId);
  if (auth.status === "error") return { ok: false, error: auth.message };

  let working = loaded.data;
  let lastNotice = "Test review did not advance.";
  let completed = working.status === "SUCCEEDED";
  let chargedCents = 0;

  for (
    let step = 0;
    step < 4 && working.status !== "SUCCEEDED" && working.status !== "CANCELLED";
    step += 1
  ) {
    const turn = runBoundedMockWorkerTurn({
      task: working,
      authorization: auth.data,
      ownerId,
    });
    if (!turn.ok) return { ok: false, error: turn.message };

    const persisted = await persistAgentTaskState(supabase, turn.task);
    if (persisted.status === "error") return { ok: false, error: persisted.message };
    working = turn.task;
    chargedCents = turn.chargedCents;

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
      await insertAgentTaskCheckpoint(supabase, { ownerId, taskId: turn.task.id, checkpoint });
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
        if (labeled.ok) await insertReviewArtifact(supabase, labeled.artifact);
      }
    }

    lastNotice = explainMockNotice({
      completed: turn.completed,
      checkpointSequence: turn.task.checkpointSequence,
      chargedCents: turn.chargedCents,
    });
    completed = turn.completed;
    if (turn.completed) break;
  }

  if (completed || working.status === "SUCCEEDED") {
    const result = createReviewArtifact({
      task: working,
      kind: "DIFF_SUMMARY",
      title: friendlyArtifactTitle({
        completed: true,
        checkpointSequence: working.checkpointSequence,
        actionType: working.binding.actionType,
      }),
      contentRef: [
        "mode=TEST_REVIEW",
        "mode=MOCK_GENERATION",
        `task=${working.id}`,
        `project=${working.projectId}`,
        `checkpoints=${working.checkpointSequence}`,
        `status=${working.status}`,
        "liveHttpInvoked=false",
        `chargedCents=${chargedCents}`,
        "assignmentMode=ai_assignment",
        `assignment=${assignmentId}`,
        "label=Test run completed",
      ].join("\n"),
      at: working.updatedAt,
    });
    if (result.ok) await insertReviewArtifact(supabase, result.artifact);
  }

  const isDone = completed || working.status === "SUCCEEDED";
  return {
    ok: true,
    completed: isDone,
    checkpoints: working.checkpointSequence,
    notice: lastNotice,
    summary: [
      isDone ? "Test run completed (MOCK)." : "Test run advanced (MOCK) — more steps remain.",
      `Worker task ${working.id}, ${working.checkpointSequence} step snapshot(s).`,
      "No live provider was called · $0 charged.",
    ].join(" "),
  };
}
