import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState } from "@/components/ui/panel";
import { WorkspaceProgress } from "@/components/workspace/workspace-progress";
import { getSession } from "@/lib/auth/session";
import { formatTimestamp } from "@/lib/format";
import { loadProjectDetail } from "@/lib/projects/queries";
import {
  controlWorkspaceTask,
  runWorkspaceMockTurn,
  saveWorkspacePlanNote,
} from "@/lib/workspace/actions";
import { loadWorkspaceSnapshot } from "@/lib/workspace/queries";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  await params;
  return { title: "Worker workspace" };
}

export default async function WorkerWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ goal?: string }>;
}) {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const { id } = await params;
  const query = await searchParams;
  if (!UUID_PATTERN.test(id)) notFound();

  const project = await loadProjectDetail(session.supabase, id);
  if (project.status === "error") {
    return <ErrorState message="This project could not be loaded." />;
  }
  if (!project.data) notFound();

  const snapshot = await loadWorkspaceSnapshot(session.supabase, {
    ownerId: session.user.id,
    projectId: project.data.id,
    projectName: project.data.name,
    goalId: query.goal,
  });
  if (snapshot.status === "error") {
    return <ErrorState message={snapshot.message} />;
  }

  const data = snapshot.data;
  const current = data.tasks.find((task) => task.id === data.currentTaskId) ?? data.tasks[0] ?? null;

  return (
    <div className="worker-workspace">
      <header className="worker-workspace-hero">
        <p className="eyebrow">Worker workspace</p>
        <h1>{data.projectName}</h1>
        <p className="quiet">
          Phase <strong>{data.phase}</strong>
          {data.liveEnabled ? " · LIVE flag is on — mock worker is refused" : " · MOCK_ONLY"}
          {data.executionMode === "MOCK_ONLY" ? " · no paid provider call from this page" : ""}
        </p>
        <WorkspaceProgress projectId={data.projectId} initialUpdatedAt={data.lastActivityAt} />
        <p className="worker-workspace-links">
          <Link href={`/projects/${data.projectId}`}>Project Brain</Link>
          {" · "}
          <Link href="/approvals">Approval Center</Link>
          {" · "}
          <Link href={`/projects/${data.projectId}/build-plan`}>Build Plan</Link>
        </p>
      </header>

      <section className="worker-board" aria-label="Work board">
        {(
          [
            ["queued", data.counts.queued],
            ["running", data.counts.running],
            ["blocked", data.counts.blocked],
            ["failed", data.counts.failed],
            ["completed", data.counts.completed],
            ["awaiting approval", data.counts.awaitingApproval],
          ] as const
        ).map(([label, count]) => (
          <article key={label}>
            <p className="eyebrow">{label}</p>
            <p className="worker-count">{count}</p>
          </article>
        ))}
      </section>

      <div className="worker-grid">
        <section aria-labelledby="goal-heading">
          <h2 id="goal-heading">Goal and constraints</h2>
          {data.goalOptions.length > 1 ? (
            <ul className="worker-goal-switch">
              {data.goalOptions.slice(0, 6).map((idea) => (
                <li key={idea.id}>
                  <Link href={`/projects/${data.projectId}/workspace?goal=${idea.id}`}>{idea.title}</Link>
                </li>
              ))}
            </ul>
          ) : null}
          {data.goal ? (
            <dl className="worker-dl">
              <dt>Goal</dt>
              <dd>{data.goal.title}</dd>
              <dt>Problem</dt>
              <dd>{data.goal.problem || "Not recorded."}</dd>
              <dt>Acceptance</dt>
              <dd>{data.goal.proposedSolution || data.goal.summary || "Not recorded."}</dd>
              <dt>Constraints</dt>
              <dd>{data.goal.constraints.join("; ") || "None recorded."}</dd>
            </dl>
          ) : (
            <EmptyState>
              No idea is linked as a goal yet.{" "}
              <Link href="/ideas">Capture one in Idea Lab</Link> and promote it to this project.
            </EmptyState>
          )}
        </section>

        <section aria-labelledby="plan-heading">
          <h2 id="plan-heading">Proposed plan</h2>
          {data.plan ? (
            <>
              <p>
                Status <strong>{data.plan.status}</strong> — proposal until a founder-approved
                execution is queued.
              </p>
              <p>{data.plan.summary || "No summary recorded."}</p>
              {data.plan.status === "DRAFT" || data.plan.status === "PLANNING" || data.plan.status === "REVIEW" ? (
                <ActionForm action={saveWorkspacePlanNote} submitLabel="Save proposed summary">
                  <input type="hidden" name="projectId" value={data.projectId} />
                  <label className="field">
                    <span>Proposed plan</span>
                    <textarea name="summary" rows={4} defaultValue={data.plan.summary} maxLength={4000} />
                  </label>
                </ActionForm>
              ) : (
                <p className="quiet">This plan is no longer a draft. Edit it on the Build Plan page.</p>
              )}
            </>
          ) : (
            <EmptyState>
              No Build Plan exists yet.{" "}
              <Link href={`/projects/${data.projectId}/build-plan`}>Open Build Plan</Link> after
              architecture is ready.
            </EmptyState>
          )}
        </section>
      </div>

      <section aria-labelledby="chat-heading">
        <h2 id="chat-heading">Founder / worker conversation</h2>
        <GhostConversation
          projectId={data.projectId}
          projectName={data.projectName}
          ideaId={data.goal?.id ?? null}
          conversationId={data.conversationId}
          messages={data.messages}
          providerConfigured={data.providerConfigured}
          variant="thread"
        />
        {!data.providerConfigured ? (
          <p className="notice" role="status">
            Model credentials are not configured. Questions persist; Ghost will not invent a live
            answer.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading">Tasks</h2>
        {data.tasks.length === 0 ? (
          <EmptyState>
            No agent tasks for this project. Approve and queue work from{" "}
            <Link href="/development-tasks">Remote Dev</Link> or Approvals. Ghost does not invent
            queued work.
          </EmptyState>
        ) : (
          <ul className="worker-task-list">
            {data.tasks.map((task) => (
              <li key={task.id} data-status={task.status}>
                <p>
                  <strong>{task.status}</strong> · {task.binding.actionType}
                </p>
                <p className="quiet">{task.binding.actionScope.slice(0, 280)}</p>
                <p className="quiet">
                  Checkpoint {task.checkpointSequence}
                  {task.blockReason ? ` · ${task.blockReason}` : ""}
                  {` · ${formatTimestamp(task.updatedAt)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        {current ? (
          <div className="worker-controls">
            <ActionForm action={runWorkspaceMockTurn} submitLabel="Start MOCK step">
              <input type="hidden" name="projectId" value={data.projectId} />
              <input type="hidden" name="taskId" value={current.id} />
            </ActionForm>
            <ActionForm action={controlWorkspaceTask} submitLabel="Pause">
              <input type="hidden" name="projectId" value={data.projectId} />
              <input type="hidden" name="taskId" value={current.id} />
              <input type="hidden" name="control" value="PAUSE" />
            </ActionForm>
            <ActionForm action={controlWorkspaceTask} submitLabel="Resume">
              <input type="hidden" name="projectId" value={data.projectId} />
              <input type="hidden" name="taskId" value={current.id} />
              <input type="hidden" name="control" value="RESUME" />
            </ActionForm>
            <ActionForm action={controlWorkspaceTask} submitLabel="Cancel">
              <input type="hidden" name="projectId" value={data.projectId} />
              <input type="hidden" name="taskId" value={current.id} />
              <input type="hidden" name="control" value="CANCEL" />
            </ActionForm>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading">Execution history</h2>
        {data.events.length === 0 ? (
          <EmptyState>No execution events recorded for the latest task.</EmptyState>
        ) : (
          <ol className="worker-history">
            {data.events.map((event) => (
              <li key={event.id}>
                <p>
                  <strong>{event.eventType}</strong> · {formatTimestamp(event.createdAt)}
                </p>
                <p className="quiet">{event.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="artifacts-heading">
        <h2 id="artifacts-heading">Artifacts</h2>
        {data.artifacts.length === 0 ? (
          <EmptyState>No founder-private review artifacts for this project.</EmptyState>
        ) : (
          <ul className="worker-artifacts">
            {data.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <h3>{artifact.title}</h3>
                <p className="quiet">
                  SHA-256 {artifact.contentSha256.slice(0, 12)} · {formatTimestamp(artifact.createdAt)}
                </p>
                {artifact.previewable ? (
                  <pre className="worker-preview">{artifact.content.slice(0, 4000)}</pre>
                ) : (
                  <p className="quiet">Preview not available for this artifact type.</p>
                )}
                <a
                  className="button"
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(artifact.content)}`}
                  download={artifact.title || "artifact.txt"}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="approval-heading">
        <h2 id="approval-heading">Approval requests</h2>
        {data.approvals.length === 0 ? (
          <EmptyState>No authorizations recorded for this project.</EmptyState>
        ) : (
          <ul className="worker-approvals">
            {data.approvals.slice(0, 8).map((auth) => (
              <li key={auth.id}>
                <p>
                  <strong>{auth.effectiveStatus}</strong> · {auth.actionType}
                </p>
                <p className="quiet">Scope fingerprint {auth.scopeFingerprint.slice(0, 16)}…</p>
                <p>{auth.actionScope}</p>
                <p className="quiet">
                  Spend {auth.estimatedCost || "not specified"} · expires {formatTimestamp(auth.expiresAt)}
                </p>
                <Link href="/approvals">Open in Approval Center</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
