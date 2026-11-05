"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/panel";
import { ResultExplainCard } from "@/components/today/result-explain";
import { formatTimestamp } from "@/lib/format";
import { explainWorkerActionLabel } from "@/lib/dashboard/result-labels";
import {
  isTestSessionExpired,
  primaryWorkerAction,
  workerControlsFor,
  type WorkerControlAction,
} from "@/lib/dashboard/today-board";
import { controlWorkspaceTask, runWorkspaceMockTurn } from "@/lib/workspace/actions";
import type { AgentTask, AgentTaskAuditEvent } from "@/lib/agent-runtime/types";
import type { WorkspaceArtifact } from "@/lib/workspace/types";

function controlLabel(action: WorkerControlAction, status: AgentTask["status"]): string {
  if (action === "MOCK") {
    return status === "QUEUED" ? "Start test run" : "Continue test run";
  }
  if (action === "PAUSE") return "Pause";
  if (action === "RESUME") return "Resume";
  return "Cancel";
}

function controlClass(action: WorkerControlAction): string {
  if (action === "MOCK" || action === "RESUME") return "button worker-control-primary";
  if (action === "PAUSE") return "button-secondary worker-control-pause";
  return "button-secondary worker-control-cancel";
}

export function WorkerLiveShell({
  projectId,
  task,
  goalTitle,
  events,
  artifacts,
  askGhost,
  history,
}: {
  projectId: string;
  task: AgentTask | null;
  goalTitle: string | null;
  events: AgentTaskAuditEvent[];
  artifacts: WorkspaceArtifact[];
  askGhost: ReactNode;
  history: ReactNode;
}) {
  const router = useRouter();
  const lastCheckpoint = useRef(task?.checkpointSequence ?? 0);
  const lastArtifactCount = useRef(artifacts.length);
  const [timelineFlash, setTimelineFlash] = useState(false);
  const [resultsReveal, setResultsReveal] = useState(false);

  useEffect(() => {
    if (!task) return;
    if (task.checkpointSequence !== lastCheckpoint.current) {
      lastCheckpoint.current = task.checkpointSequence;
      setTimelineFlash(true);
      const id = window.setTimeout(() => setTimelineFlash(false), 900);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [task]);

  useEffect(() => {
    if (artifacts.length > lastArtifactCount.current) {
      lastArtifactCount.current = artifacts.length;
      setResultsReveal(true);
      const id = window.setTimeout(() => setResultsReveal(false), 1200);
      return () => window.clearTimeout(id);
    }
    lastArtifactCount.current = artifacts.length;
    return undefined;
  }, [artifacts.length]);

  useEffect(() => {
    let cancelled = false;
    let last = task?.updatedAt ?? "";
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/workspace/${projectId}/status`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { updatedAt?: string };
        if (body.updatedAt && body.updatedAt !== last) {
          last = body.updatedAt;
          router.refresh();
        }
      } catch {
        /* keep last known */
      }
    };
    const id = window.setInterval(tick, 3500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [projectId, task?.updatedAt, router]);

  const controlOptions = task
    ? {
        leaseExpiresAt: task.lease?.expiresAt ?? null,
        checkpointSequence: task.checkpointSequence,
      }
    : undefined;
  const sessionExpired = task
    ? isTestSessionExpired({
        status: task.status,
        leaseExpiresAt: task.lease?.expiresAt ?? null,
      })
    : false;
  const controls = task ? workerControlsFor(task.status, controlOptions) : [];
  const nextAction = task ? primaryWorkerAction(task.status, controlOptions) : null;
  const taskArtifacts = task
    ? artifacts.filter((artifact) => artifact.taskId === task.id)
    : [];
  const steps = Array.from({ length: Math.max(task?.checkpointSequence ?? 0, 1) }, (_, index) => {
    const sequence = index + 1;
    const done = (task?.checkpointSequence ?? 0) >= sequence;
    const current = (task?.checkpointSequence ?? 0) === sequence;
    const event = events.find(
      (item) =>
        item.detail.includes(`checkpoint ${sequence}`) ||
        item.detail.includes(`checkpoint:${task?.id}:${sequence}`),
    );
    return {
      sequence,
      done,
      current,
      label: event?.detail?.slice(0, 120) || (done ? `Checkpoint ${sequence}` : `Step ${sequence}`),
      at: event?.createdAt ?? (current ? task?.updatedAt ?? null : null),
    };
  });

  return (
    <div className="worker-live">
      <div className="worker-live-main">
        <section className="worker-card worker-lead" data-tone="indigo" aria-labelledby="worker-lead-heading">
          <header className="worker-card-head">
            <span className="worker-card-icon" aria-hidden="true">
              ⌬
            </span>
            <div>
              <p className="eyebrow">Selected task</p>
              <h2 id="worker-lead-heading" className="worker-lead-title">
                {task
                  ? explainWorkerActionLabel({
                      status: task.status,
                      checkpointSequence: task.checkpointSequence,
                    })
                  : "No active task"}
              </h2>
            </div>
          </header>

          {task ? (
            <div className="worker-card-body">
              <p className="worker-lead-goal">
                <span className="quiet">Goal</span>
                <strong>{goalTitle ?? "No linked goal recorded."}</strong>
              </p>
              <p className="worker-lead-scope">{task.binding.actionScope.slice(0, 360)}</p>
              <div className="worker-lead-meta">
                <span
                  className="today-checkpoint"
                  data-flash={timelineFlash ? "true" : "false"}
                  data-checkpoint={task.checkpointSequence}
                >
                  {task.checkpointSequence > 0
                    ? `Saved after step ${task.checkpointSequence}`
                    : "No steps saved yet"}
                </span>
                <span className="quiet">Updated {formatTimestamp(task.updatedAt)}</span>
              </div>

              {sessionExpired ? (
                <p className="worker-session-notice" role="status">
                  <strong>This test session expired.</strong>{" "}
                  {task.checkpointSequence > 0
                    ? "Review the saved step below, or open History for raw details."
                    : "Open Worker history for past runs, or start a new review from Today."}
                </p>
              ) : null}

              {task.blockReason && !sessionExpired ? (
                <p className="worker-session-notice" role="status">
                  {task.blockReason}
                </p>
              ) : null}

              {!sessionExpired && nextAction ? (
                <p className="worker-lead-next">
                  <span aria-hidden="true">⚡</span> Action available now:{" "}
                  <strong>{nextAction}</strong>
                </p>
              ) : null}

              <details className="today-tech-details">
                <summary>View technical details</summary>
                <pre>
                  {`status=${task.status}
actionType=${task.binding.actionType}
taskId=${task.id}
checkpointSequence=${task.checkpointSequence}
leaseExpiresAt=${task.lease?.expiresAt ?? "null"}`}
                </pre>
              </details>

              <div className="worker-controls worker-controls-live">
                {sessionExpired && task.checkpointSequence > 0 ? (
                  <a className="button-secondary worker-view-step" href="#worker-timeline">
                    View saved step
                  </a>
                ) : null}
                {controls.map((control) => (
                  <div
                    key={control}
                    className={`worker-control-wrap ${controlClass(control)}`}
                    data-control={control}
                  >
                    {control === "MOCK" ? (
                      <ActionForm
                        action={runWorkspaceMockTurn}
                        submitLabel={controlLabel(control, task.status)}
                      >
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="taskId" value={task.id} />
                      </ActionForm>
                    ) : (
                      <ActionForm
                        action={controlWorkspaceTask}
                        submitLabel={controlLabel(control, task.status)}
                      >
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="taskId" value={task.id} />
                        <input type="hidden" name="control" value={control} />
                      </ActionForm>
                    )}
                  </div>
                ))}
                {task.status === "SUCCEEDED" ? (
                  <Link className="button-secondary" href="/files">
                    Open saved result
                  </Link>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="worker-card-body">
              <EmptyState>
                Queue work from Today → Assign worker, then return here. Ghost does not invent tasks.
              </EmptyState>
            </div>
          )}
        </section>

        <aside className="worker-side" aria-label="Progress and results">
          <section
            id="worker-timeline"
            className="worker-card worker-timeline"
            data-tone="sky"
            aria-labelledby="timeline-heading"
            data-flash={timelineFlash ? "true" : "false"}
          >
            <header className="worker-card-head">
              <span className="worker-card-icon" aria-hidden="true">
                ◎
              </span>
              <h3 id="timeline-heading">Step timeline</h3>
            </header>
            <div className="worker-card-body">
              {!task ? (
                <EmptyState>No timeline until a task is selected.</EmptyState>
              ) : (
                <ol className="worker-timeline-list">
                  {steps.map((step) => (
                    <li
                      key={step.sequence}
                      data-done={step.done ? "true" : "false"}
                      data-current={step.current ? "true" : "false"}
                    >
                      <span className="worker-timeline-mark" aria-hidden="true">
                        {step.sequence}
                      </span>
                      <div>
                        <p>
                          <strong>
                            {step.done ? `Checkpoint ${step.sequence}` : `Step ${step.sequence}`}
                          </strong>
                        </p>
                        {step.at ? <p className="quiet">{formatTimestamp(step.at)}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          <section
            className="worker-card worker-results"
            data-tone="emerald"
            aria-labelledby="results-heading"
            data-reveal={resultsReveal ? "true" : "false"}
          >
            <header className="worker-card-head">
              <span className="worker-card-icon" aria-hidden="true">
                ▤
              </span>
              <h3 id="results-heading">Saved results</h3>
            </header>
            <div className="worker-card-body">
              {taskArtifacts.length === 0 ? (
                <div className="worker-results-empty">
                  <span aria-hidden="true">⛁</span>
                  <p>No saved results yet.</p>
                </div>
              ) : (
                <ul className="worker-results-list">
                  {taskArtifacts.map((artifact) => (
                    <li key={artifact.id}>
                      <ResultExplainCard
                        title={artifact.title}
                        content={artifact.content}
                        contentSha256={artifact.contentSha256}
                        href="/files"
                      />
                      <div className="today-inline-actions">
                        <a
                          href={`data:text/plain;charset=utf-8,${encodeURIComponent(artifact.content)}`}
                          download={artifact.title || "artifact.txt"}
                        >
                          Download
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </div>

      <section className="worker-card worker-chat-panel" data-tone="violet" aria-labelledby="chat-heading">
        <header className="worker-card-head">
          <span className="worker-card-icon" aria-hidden="true">
            ✦
          </span>
          <h2 id="chat-heading">Ask about this project</h2>
        </header>
        <div className="worker-card-body">{askGhost}</div>
      </section>

      <details className="worker-card worker-history-panel" data-tone="slate">
        <summary>
          <span className="worker-card-icon" aria-hidden="true">
            ◷
          </span>
          <span>History — past runs and raw execution details</span>
        </summary>
        <div className="worker-history-body">{history}</div>
      </details>
    </div>
  );
}
