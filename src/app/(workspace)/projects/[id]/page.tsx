import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { assembleProjectContext } from "@/lib/brain/context";
import { detectStateDrift, parseGhostMarkdown } from "@/lib/brain/drift";
import { exportProjectState } from "@/lib/brain/export-state";
import { displayVerificationState, isSupportedVerified } from "@/lib/brain/verification";
import { loadLatestConversation } from "@/lib/conversation/queries";
import type { KnowledgeKind } from "@/lib/domain/status";
import { formatTimestamp } from "@/lib/format";
import { loadFounderRules } from "@/lib/memory/queries";
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

async function repositorySnapshot() {
  try {
    const text = await readFile(path.join(process.cwd(), "GHOST.md"), "utf8");
    return parseGhostMarkdown(text);
  } catch {
    return null;
  }
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

  const [milestones, knowledge, blockers, actions, verification, rules, conversation] = await Promise.all([
    loadMilestones(session.supabase, id),
    loadKnowledge(session.supabase, id),
    loadBlockers(session.supabase, id),
    loadNextActions(session.supabase, id),
    loadVerification(session.supabase, id),
    loadFounderRules(session.supabase),
    loadLatestConversation(session.supabase, id),
  ]);

  const detail = project.data;
  const knowledgeRows = knowledge.status === "ok" ? knowledge.data : [];
  const requirements = knowledgeOf(knowledgeRows, "REQUIREMENT");
  const decisions = knowledgeOf(knowledgeRows, "DECISION");
  const constraints = knowledgeOf(knowledgeRows, "CONSTRAINT");
  const milestoneRows = milestones.status === "ok" ? milestones.data : [];
  const current =
    milestoneRows.find((milestone) => milestone.title === detail.currentMilestone) ?? milestoneRows[0] ?? null;
  const blockerRows = blockers.status === "ok" ? blockers.data : [];
  const openBlockers = blockerRows.filter((blocker) => blocker.status === "OPEN");
  const actionRows = actions.status === "ok" ? actions.data : [];
  const openActions = actionRows.filter((action) => action.status === "OPEN");
  const verificationRows = verification.status === "ok" ? verification.data : [];
  const comparesRepository = detail.slug === "ghost" || detail.name.toLocaleLowerCase() === "ghost";
  const repositoryState = comparesRepository ? await repositorySnapshot() : null;
  const drift =
    repositoryState == null
      ? null
      : detectStateDrift(
          { milestone: repositoryState.milestone, status: repositoryState.status, production: null },
          {
            milestone: detail.currentMilestone || null,
            status: detail.status,
            production: null,
          },
        );

  const exportPreview =
    milestones.status === "ok" &&
    knowledge.status === "ok" &&
    blockers.status === "ok" &&
    actions.status === "ok" &&
    verification.status === "ok" &&
    rules.status === "ok"
      ? exportProjectState(
          assembleProjectContext({
            project: {
              id: detail.id,
              name: detail.name,
              description: detail.description,
              status: detail.status,
              currentMilestone: detail.currentMilestone,
              repositoryProvider: detail.repositoryProvider,
              repositoryUrl: detail.repositoryUrl,
              repositoryBranch: detail.repositoryBranch,
              repositoryCommit: detail.repositoryCommit,
            },
            milestones: milestoneRows.map((milestone) => ({ title: milestone.title, status: milestone.status })),
            knowledge: knowledgeRows.map((item) => ({ kind: item.kind, title: item.title, content: item.content })),
            blockers: blockerRows.map((blocker) => ({
              title: blocker.title,
              description: blocker.description,
              status: blocker.status,
            })),
            nextActions: actionRows.map((action) => ({
              title: action.title,
              description: action.description,
              status: action.status,
              position: action.position,
            })),
            verification: verificationRows.map((record) => ({
              category: record.category,
              target: record.target,
              state: record.state,
              evidence: record.evidence,
              checkedAt: record.checkedAt,
            })),
            founderRules: rules.data.map((rule) => ({
              id: rule.id,
              title: rule.title,
              content: rule.content,
              status: rule.status,
            })),
          }),
        )
      : null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Project</p>
          <h1>{detail.name}</h1>
        </div>
        <StatusBadge status={detail.status} />
      </div>

      <Panel title="What we are building">
        <p>{detail.description || "No description recorded."}</p>
        <ul className="meta">
          <li>Status: {detail.status.replaceAll("_", " ")}</li>
          <li>Record updated: {formatTimestamp(detail.updatedAt)}</li>
        </ul>
      </Panel>

      <Panel title="Current milestone">
        {milestones.status === "error" ? <ErrorState message={milestones.message} /> : null}
        {!current ? <EmptyState>No milestone recorded.</EmptyState> : null}
        {current ? (
          <article className="list-item">
            <h3>{current.title}</h3>
            <p className="quiet">{current.description || "No description recorded."}</p>
            <StatusBadge status={current.status} />
          </article>
        ) : null}
      </Panel>

      <Panel title="Repository">
        <ul className="meta">
          <li>Provider: {detail.repositoryProvider ?? "Not recorded"}</li>
          <li>URL: {detail.repositoryUrl ?? "Not recorded"}</li>
          <li>Branch: {detail.repositoryBranch ?? "Not recorded"}</li>
          <li>Last known commit: {detail.repositoryCommit ?? "Not recorded"}</li>
        </ul>
        <p className="quiet">A missing URL or commit means remote repository state is not recorded.</p>
        {constraints.map((item) => (
          <article className="list-item" key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.content}</p>
          </article>
        ))}
      </Panel>

      <Panel title="Ask Ghost about this project">
        {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
        <GhostConversation
          projectId={detail.id}
          projectName={detail.name}
          conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
          messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
          providerConfigured={isModelConfigured()}
        />
      </Panel>

      <Panel title="Open blockers">
        {blockers.status === "error" ? <ErrorState message={blockers.message} /> : null}
        {blockers.status === "ok" && openBlockers.length === 0 ? (
          <EmptyState>No open blockers recorded.</EmptyState>
        ) : null}
        {openBlockers.map((blocker) => (
          <article className="list-item" key={blocker.id}>
            <h3>{blocker.title}</h3>
            <p className="quiet">{blocker.description || "No description recorded."}</p>
            <StatusBadge status={blocker.status} />
          </article>
        ))}
        {blockerRows.length > openBlockers.length ? (
          <p className="quiet">{blockerRows.length - openBlockers.length} resolved blockers are not shown.</p>
        ) : null}
      </Panel>

      <Panel title="Next actions">
        {actions.status === "error" ? <ErrorState message={actions.message} /> : null}
        {actions.status === "ok" && openActions.length === 0 ? (
          <EmptyState>No open next action recorded.</EmptyState>
        ) : null}
        {openActions.map((action) => (
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
        ))}
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
          </article>
        ))}
      </Panel>

      <Panel title="Verification">
        <p className="quiet">
          VERIFIED is shown only when the record has checked time and non-empty evidence. Claimed, observed,
          failed, and not verified stay distinct.
        </p>
        {verification.status === "error" ? <ErrorState message={verification.message} /> : null}
        {verification.status === "ok" && verificationRows.length === 0 ? (
          <EmptyState>No verification records.</EmptyState>
        ) : null}
        {verificationRows.map((record) => {
          const shown = displayVerificationState(record);
          const unsupported = record.state === "VERIFIED" && !isSupportedVerified(record);
          return (
            <article className="list-item" key={record.id}>
              <h3>{record.target}</h3>
              <ul className="meta">
                <li>
                  <StatusBadge status={record.category} />
                </li>
                <li>
                  <StatusBadge status={shown} />
                </li>
                <li>Checked {formatTimestamp(record.checkedAt)}</li>
              </ul>
              {unsupported ? (
                <p className="notice">This row says VERIFIED, but the evidence is incomplete, so Ghost does not treat it as verified.</p>
              ) : null}
              <pre className="prose">{JSON.stringify(record.evidence, null, 2)}</pre>
            </article>
          );
        })}
      </Panel>

      {drift ? (
        <Panel title="State drift">
          {drift.drifted ? (
            <div className="stack">
              <p>STATE DRIFT. The repository file and this database record disagree. Neither was overwritten.</p>
              <ul className="meta">
                {drift.fields.map((field) => (
                  <li key={field.field}>
                    {field.field}: file {field.repository ?? "empty"}, database {field.database ?? "empty"}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="quiet">GHOST.md and this project record agree on milestone and status.</p>
          )}
        </Panel>
      ) : null}

      {exportPreview ? (
        <Panel title="State export preview">
          <p className="quiet">Generated from this Project Brain. Repository files were not changed.</p>
          <pre className="prose">{exportPreview.markdown}</pre>
        </Panel>
      ) : null}

      <p className="quiet">
        <Link href="/projects">Back to projects</Link>
      </p>
    </div>
  );
}
