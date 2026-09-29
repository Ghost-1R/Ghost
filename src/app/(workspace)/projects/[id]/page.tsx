import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/lib/auth/session";
import type { KnowledgeKind } from "@/lib/domain/status";
import { formatTimestamp } from "@/lib/format";
import {
  loadBlockers,
  loadKnowledge,
  loadMilestones,
  loadNextActions,
  loadProjectDetail,
  loadVerification,
  type KnowledgeRecord,
} from "@/lib/projects/queries";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Project ${id.slice(0, 8)}` };
}

function knowledgeOf(records: KnowledgeRecord[], kind: KnowledgeKind) {
  return records.filter((record) => record.kind === kind);
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const project = await loadProjectDetail(session.supabase, id);
  if (project.status === "error") {
    return (
      <div className="stack">
        <h1>Project</h1>
        <ErrorState message={project.message} />
      </div>
    );
  }

  if (!project.data) {
    notFound();
  }

  const [milestones, knowledge, blockers, actions, verification] = await Promise.all([
    loadMilestones(session.supabase, id),
    loadKnowledge(session.supabase, id),
    loadBlockers(session.supabase, id),
    loadNextActions(session.supabase, id),
    loadVerification(session.supabase, id),
  ]);

  const detail = project.data;
  const knowledgeRows = knowledge.status === "ok" ? knowledge.data : [];
  const requirements = knowledgeOf(knowledgeRows, "REQUIREMENT");
  const decisions = knowledgeOf(knowledgeRows, "DECISION");
  const otherKnowledge = knowledgeRows.filter((row) => row.kind !== "REQUIREMENT" && row.kind !== "DECISION");

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Project brain</p>
          <h1>{detail.name}</h1>
        </div>
        <StatusBadge status={detail.status} />
      </div>

      <Panel title="Overview">
        <p>{detail.description || "No description recorded."}</p>
        <ul className="meta">
          <li>Milestone: {detail.currentMilestone || "Not recorded"}</li>
          <li>Repository: {detail.repositoryUrl ?? "No repository URL recorded."}</li>
          <li>Record updated: {formatTimestamp(detail.updatedAt)}</li>
        </ul>
      </Panel>

      <Panel title="Current milestone">
        {milestones.status === "error" ? <ErrorState message={milestones.message} /> : null}
        {milestones.status === "ok" && milestones.data.length === 0 ? (
          <EmptyState>No milestones recorded.</EmptyState>
        ) : null}
        {milestones.status === "ok" && milestones.data.length > 0 ? (
          <div className="stack">
            {milestones.data.map((milestone) => (
              <article className="list-item" key={milestone.id}>
                <h3>{milestone.title}</h3>
                <p className="quiet">{milestone.description || "No description recorded."}</p>
                <ul className="meta">
                  <li>
                    <StatusBadge status={milestone.status} />
                  </li>
                  <li>Position {milestone.position}</li>
                </ul>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel title="Requirements">
        {knowledge.status === "error" ? <ErrorState message={knowledge.message} /> : null}
        {knowledge.status === "ok" && requirements.length === 0 ? (
          <EmptyState>No requirements recorded.</EmptyState>
        ) : null}
        {requirements.map((item) => (
          <article className="list-item" key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.content}</p>
            <p className="quiet">Source: {item.source || "Not recorded"}</p>
          </article>
        ))}
      </Panel>

      <Panel title="Decisions">
        {knowledge.status === "ok" && decisions.length === 0 ? (
          <EmptyState>No decisions recorded.</EmptyState>
        ) : null}
        {decisions.map((item) => (
          <article className="list-item" key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.content}</p>
            <p className="quiet">Source: {item.source || "Not recorded"}</p>
          </article>
        ))}
      </Panel>

      <Panel title="Other project knowledge">
        {knowledge.status === "ok" && otherKnowledge.length === 0 ? (
          <EmptyState>No other facts, constraints, or lessons recorded.</EmptyState>
        ) : null}
        {otherKnowledge.map((item) => (
          <article className="list-item" key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.content}</p>
            <ul className="meta">
              <li>
                <StatusBadge status={item.kind} />
              </li>
              <li>Source: {item.source || "Not recorded"}</li>
            </ul>
          </article>
        ))}
      </Panel>

      <Panel title="Blockers">
        {blockers.status === "error" ? <ErrorState message={blockers.message} /> : null}
        {blockers.status === "ok" && blockers.data.length === 0 ? (
          <EmptyState>No blockers recorded.</EmptyState>
        ) : null}
        {blockers.status === "ok"
          ? blockers.data.map((blocker) => (
              <article className="list-item" key={blocker.id}>
                <h3>{blocker.title}</h3>
                <p className="quiet">{blocker.description || "No description recorded."}</p>
                <ul className="meta">
                  <li>
                    <StatusBadge status={blocker.status} />
                  </li>
                  <li>Opened {formatTimestamp(blocker.createdAt)}</li>
                  <li>Resolved {formatTimestamp(blocker.resolvedAt)}</li>
                </ul>
              </article>
            ))
          : null}
      </Panel>

      <Panel title="Next actions">
        {actions.status === "error" ? <ErrorState message={actions.message} /> : null}
        {actions.status === "ok" && actions.data.length === 0 ? (
          <EmptyState>No next action recorded.</EmptyState>
        ) : null}
        {actions.status === "ok"
          ? actions.data.map((action) => (
              <article className="list-item" key={action.id}>
                <h3>{action.title}</h3>
                <p className="quiet">{action.description || "No description recorded."}</p>
                <ul className="meta">
                  <li>
                    <StatusBadge status={action.status} />
                  </li>
                  <li>Position {action.position}</li>
                </ul>
              </article>
            ))
          : null}
      </Panel>

      <Panel title="Verification">
        <p className="quiet">
          A record is not verified because it exists. VERIFIED requires checked time and non-empty
          evidence. Ghost does not offer a button that marks work verified without that evidence.
        </p>
        {verification.status === "error" ? <ErrorState message={verification.message} /> : null}
        {verification.status === "ok" && verification.data.length === 0 ? (
          <EmptyState>Nothing has been verified for this project.</EmptyState>
        ) : null}
        {verification.status === "ok"
          ? verification.data.map((record) => (
              <article className="list-item" key={record.id}>
                <h3>{record.target}</h3>
                <ul className="meta">
                  <li>
                    <StatusBadge status={record.category} />
                  </li>
                  <li>
                    <StatusBadge status={record.state} />
                  </li>
                  <li>Checked {formatTimestamp(record.checkedAt)}</li>
                </ul>
                <pre className="prose">{JSON.stringify(record.evidence, null, 2)}</pre>
              </article>
            ))
          : null}
      </Panel>

      <p className="quiet">
        <Link href="/projects">Back to projects</Link>
      </p>
    </div>
  );
}
