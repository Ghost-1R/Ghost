import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { EmptyState, ErrorState } from "@/components/ui/panel";
import { WorkerLiveShell } from "@/components/workspace/worker-shell";
import { loadAgentTaskEvents } from "@/lib/agent-runtime/queries";
import { getSession } from "@/lib/auth/session";
import { formatTimestamp } from "@/lib/format";
import { loadProjectDetail } from "@/lib/projects/queries";
import { loadWorkspaceSnapshot } from "@/lib/workspace/queries";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  await params;
  return { title: "Worker" };
}

export default async function WorkerWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ goal?: string; task?: string }>;
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
  const requestedTask =
    query.task && UUID_PATTERN.test(query.task)
      ? data.tasks.find((task) => task.id === query.task)
      : undefined;
  const current =
    requestedTask ?? data.tasks.find((task) => task.id === data.currentTaskId) ?? data.tasks[0] ?? null;

  const selectedEvents =
    current != null
      ? await loadAgentTaskEvents(session.supabase, session.user.id, current.id)
      : null;
  const currentEvents =
    selectedEvents?.status === "ok"
      ? selectedEvents.data
      : current != null
        ? data.events.filter((event) => event.taskId === current.id)
        : data.events;

  const history = (
    <>
      <section aria-labelledby="past-runs-heading">
        <h3 id="past-runs-heading">Past runs</h3>
        {data.tasks.length === 0 ? (
          <EmptyState>No agent tasks for this project.</EmptyState>
        ) : (
          <ul className="worker-task-list">
            {data.tasks.map((task) => (
              <li key={task.id} data-status={task.status}>
                <p>
                  <Link href={`/projects/${data.projectId}/workspace?task=${encodeURIComponent(task.id)}`}>
                    <strong>{task.status}</strong> · {task.binding.actionType}
                  </Link>
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
      </section>

      <section aria-labelledby="raw-history-heading">
        <h3 id="raw-history-heading">Raw execution details</h3>
        {currentEvents.length === 0 ? (
          <EmptyState>No execution events recorded for the selected task.</EmptyState>
        ) : (
          <ol className="worker-history">
            {currentEvents.map((event) => (
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

      <section aria-labelledby="approval-heading">
        <h3 id="approval-heading">Approval requests</h3>
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
    </>
  );

  const askGhost = (
    <>
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
    </>
  );

  return (
    <div className="worker-workspace worker-workspace-cohesive">
      <header className="worker-workspace-hero">
        <div className="worker-workspace-hero-row">
          <p className="eyebrow">Worker</p>
          <p className="today-design-chip">Design preview</p>
        </div>
        <div className="worker-project-title-row">
          <span className="worker-project-mark" aria-hidden="true">
            ▣
          </span>
          <div>
            <h1 className="worker-title">{data.projectName}</h1>
            <p className="quiet worker-phase-line">
              Phase <strong>{data.phase}</strong>
              {data.liveEnabled ? " · LIVE flag is on — mock worker is refused" : " · MOCK_ONLY"}
              {data.executionMode === "MOCK_ONLY" ? " · no paid provider call from this page" : ""}
            </p>
          </div>
        </div>
        <p className="worker-workspace-links">
          <Link href={`/projects/${data.projectId}`}>Project Brain</Link>
          {" · "}
          <Link href="/approvals">Approval Center</Link>
          {" · "}
          <Link href="/files">Files</Link>
          {" · "}
          <Link href="/dashboard">Today</Link>
        </p>
      </header>

      <WorkerLiveShell
        projectId={data.projectId}
        task={current}
        goalTitle={data.goal?.title ?? null}
        events={currentEvents}
        artifacts={data.artifacts}
        askGhost={askGhost}
        history={history}
      />
    </div>
  );
}
