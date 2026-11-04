"use client";

import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/panel";
import { CheckpointPulse, SoftNavLink } from "@/components/today/motion";
import { formatTimestamp } from "@/lib/format";
import { controlWorkspaceTask, runWorkspaceMockTurn } from "@/lib/workspace/actions";
import { explainWorkerActionLabel } from "@/lib/dashboard/result-labels";
import {
  isTestSessionExpired,
  primaryWorkerAction,
  workerControlsFor,
} from "@/lib/dashboard/today-board";
import type { AgentTaskSurfaceRow } from "@/lib/operations/agent-task-surface";

export function WorkerPanel({ task }: { task: AgentTaskSurfaceRow | null }) {
  if (!task) {
    return (
      <EmptyState>
        No active worker task. Start a test review from Today or a project workspace when you are ready.
      </EmptyState>
    );
  }

  const controlOptions = {
    leaseExpiresAt: task.leaseExpiresAt,
    checkpointSequence: task.checkpointSequence,
  };
  const sessionExpired = isTestSessionExpired({
    status: task.status,
    leaseExpiresAt: task.leaseExpiresAt,
  });
  const controls = workerControlsFor(task.status, controlOptions);
  const href = `/projects/${task.projectId}/workspace?task=${encodeURIComponent(task.id)}`;
  const plainLabel = explainWorkerActionLabel({
    status: task.status,
    checkpointSequence: task.checkpointSequence,
  });

  return (
    <article className="today-worker" data-status={task.status} data-checkpoint={task.checkpointSequence}>
      <div className="today-worker-head">
        <p className="ceo-project-label">{task.projectName}</p>
        <p className="today-worker-status">
          <strong>{plainLabel}</strong>
        </p>
        <p className="quiet">{task.actionScope.slice(0, 220)}</p>
        {sessionExpired ? (
          <p className="worker-session-notice" role="status">
            <strong>This test session expired.</strong>
          </p>
        ) : (
          <p className="worker-lead-next">
            Now: <strong>{primaryWorkerAction(task.status, controlOptions)}</strong>
          </p>
        )}
        <details className="today-tech-details">
          <summary>View technical details</summary>
          <pre>
            {`status=${task.status}
actionType=${task.actionType}
checkpointSequence=${task.checkpointSequence}
taskId=${task.id}
leaseExpiresAt=${task.leaseExpiresAt ?? "null"}`}
          </pre>
        </details>
      </div>
      <div className="today-worker-meta">
        <CheckpointPulse
          projectId={task.projectId}
          taskId={task.id}
          checkpointSequence={task.checkpointSequence}
          updatedAt={task.updatedAt}
        />
        <span className="quiet">Updated {formatTimestamp(task.updatedAt)}</span>
        {task.blockReason && !sessionExpired ? (
          <span className="notice">{task.blockReason}</span>
        ) : null}
      </div>
      <div className="today-worker-controls">
        {sessionExpired && task.checkpointSequence > 0 ? (
          <SoftNavLink className="button-secondary" href={`${href}#worker-timeline`}>
            View saved step
          </SoftNavLink>
        ) : null}
        {controls.map((control) => (
          <div key={control} className="worker-control-wrap" data-control={control}>
            {control === "MOCK" ? (
              <ActionForm
                action={runWorkspaceMockTurn}
                submitLabel={
                  task.status === "QUEUED" ? "Start test run" : "Continue test run"
                }
              >
                <input type="hidden" name="projectId" value={task.projectId} />
                <input type="hidden" name="taskId" value={task.id} />
              </ActionForm>
            ) : (
              <ActionForm
                action={controlWorkspaceTask}
                submitLabel={control === "PAUSE" ? "Pause" : control === "RESUME" ? "Resume" : "Cancel"}
              >
                <input type="hidden" name="projectId" value={task.projectId} />
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="control" value={control} />
              </ActionForm>
            )}
          </div>
        ))}
        <SoftNavLink className="button-secondary" href={href}>
          Open Worker
        </SoftNavLink>
        {task.status === "SUCCEEDED" ? (
          <Link className="button-secondary" href="/files">
            Open saved result
          </Link>
        ) : null}
      </div>
    </article>
  );
}
