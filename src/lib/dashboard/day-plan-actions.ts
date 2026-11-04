"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/session";
import {
  DAY_PLAN_BUCKETS,
  type DayPlanBucket,
  type DayPlanPlacement,
} from "@/lib/dashboard/day-plan";
import { founderPlanDate, saveDayPlanPlacements } from "@/lib/dashboard/day-plan-store";
import {
  insertReviewArtifact,
  loadAgentTaskById,
  persistAgentTaskState,
  insertAgentTaskCheckpoint,
} from "@/lib/agent-runtime/queries";
import {
  createCheckpointReviewArtifact,
  createReviewArtifact,
} from "@/lib/agent-runtime/review-artifacts";
import { runBoundedMockWorkerTurn } from "@/lib/agent-runtime/mock-worker";
import { loadAuthorizationById } from "@/lib/approvals/queries";
import { isCodegenLiveEnabled } from "@/lib/codegen/provider-config";
import {
  explainMockNotice,
  friendlyArtifactTitle,
} from "@/lib/dashboard/result-labels";

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function parsePlacementsJson(raw: string): DayPlanPlacement[] | { error: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { error: "Day plan payload must be a list." };
    const out: DayPlanPlacement[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const id = "id" in entry && typeof entry.id === "string" ? entry.id.trim() : "";
      const bucket = "bucket" in entry && typeof entry.bucket === "string" ? entry.bucket : "";
      if (!id || !(DAY_PLAN_BUCKETS as readonly string[]).includes(bucket)) continue;
      out.push({ id, bucket: bucket as DayPlanBucket });
    }
    if (out.length === 0) return { error: "Add at least one item before saving today's plan." };
    return out;
  } catch {
    return { error: "Day plan could not be read. Try again." };
  }
}

export async function saveFounderDayPlan(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "Sign in required.", notice: null };
  }

  const timeZone = readField(formData, "timeZone") || "America/New_York";
  const planDate = readField(formData, "planDate") || founderPlanDate(timeZone);
  const placements = parsePlacementsJson(readField(formData, "placementsJson"));
  if ("error" in placements) return { error: placements.error, notice: null };

  const saved = await saveDayPlanPlacements(
    session.supabase,
    session.user.id,
    planDate,
    placements,
  );
  if (saved.status === "error") {
    return {
      error:
        /founder_day_plans|does not exist|schema cache/i.test(saved.message)
          ? "Day plan storage is not available on this database yet. Apply the local founder_day_plans migration."
          : saved.message,
      notice: null,
    };
  }

  revalidatePath("/dashboard");
  return {
    error: null,
    notice: `Today's plan saved · ${placements.length} item${placements.length === 1 ? "" : "s"}.`,
  };
}

/**
 * After preview confirmation: run remaining MOCK steps for a test review,
 * save the result, and record which plan items / project it covers.
 */
export async function confirmWorkerTestReview(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return { error: "Sign in required.", notice: null };
  }
  if (isCodegenLiveEnabled()) {
    return { error: "Test review is refused while LIVE is enabled.", notice: null };
  }

  const projectId = readField(formData, "projectId");
  const taskId = readField(formData, "taskId");
  const mode = readField(formData, "mode");
  const linkedItemIds = readField(formData, "linkedItemIds")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const previewConfirmed = readField(formData, "previewConfirmed");
  if (previewConfirmed !== "yes") {
    return { error: "Preview the assignment and confirm before starting.", notice: null };
  }
  if (!projectId || !taskId) {
    return {
      error: "Choose a project or plan items that already have a worker task to review.",
      notice: null,
    };
  }
  if (mode !== "project" && mode !== "plan_tasks") {
    return { error: "Pick a project or today's plan tasks to review.", notice: null };
  }

  const loaded = await loadAgentTaskById(session.supabase, session.user.id, taskId);
  if (loaded.status === "error") return { error: loaded.message, notice: null };
  if (!loaded.data || loaded.data.projectId !== projectId) {
    return { error: "Task is not in this project.", notice: null };
  }

  const auth = await loadAuthorizationById(
    session.supabase,
    session.user.id,
    loaded.data.binding.authorizationId,
  );
  if (auth.status === "error") return { error: auth.message, notice: null };

  let working = loaded.data;
  let lastNotice = "Test review did not advance.";
  let completed = working.status === "SUCCEEDED";
  let chargedCents = 0;

  for (let step = 0; step < 4 && working.status !== "SUCCEEDED" && working.status !== "CANCELLED"; step += 1) {
    const turn = runBoundedMockWorkerTurn({
      task: working,
      authorization: auth.data,
      ownerId: session.user.id,
    });
    if (!turn.ok) return { error: turn.message, notice: null };

    const persisted = await persistAgentTaskState(session.supabase, turn.task);
    if (persisted.status === "error") return { error: persisted.message, notice: null };
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

    lastNotice = explainMockNotice({
      completed: turn.completed,
      checkpointSequence: turn.task.checkpointSequence,
      chargedCents: turn.chargedCents,
    });
    completed = turn.completed;
    if (turn.completed) break;
  }

  if (completed || working.status === "SUCCEEDED") {
    const linkLines = [
      "mode=TEST_REVIEW",
      "mode=MOCK_GENERATION",
      `task=${working.id}`,
      `project=${working.projectId}`,
      `checkpoints=${working.checkpointSequence}`,
      `status=${working.status}`,
      "liveHttpInvoked=false",
      `chargedCents=${chargedCents}`,
      `assignmentMode=${mode}`,
      linkedItemIds.length > 0 ? `linkedPlanItems=${linkedItemIds.join("|")}` : null,
      "label=Test run completed",
    ].filter(Boolean) as string[];

    const result = createReviewArtifact({
      task: working,
      kind: "DIFF_SUMMARY",
      title: friendlyArtifactTitle({
        completed: true,
        checkpointSequence: working.checkpointSequence,
        actionType: working.binding.actionType,
      }),
      contentRef: linkLines.join("\n"),
      at: working.updatedAt,
    });
    if (result.ok) {
      await insertReviewArtifact(session.supabase, result.artifact);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/files");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/workspace`);

  redirect(
    `/projects/${projectId}/workspace?task=${encodeURIComponent(working.id)}&review=1`,
  );
}
