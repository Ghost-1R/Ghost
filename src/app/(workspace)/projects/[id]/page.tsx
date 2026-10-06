import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { assembleProjectContext } from "@/lib/brain/context";
import { detectStateDrift, parseGhostMarkdown } from "@/lib/brain/drift";
import { exportProjectState } from "@/lib/brain/export-state";
import { displayVerificationState, isSupportedVerified } from "@/lib/brain/verification";
import { loadLatestConversation } from "@/lib/conversation/queries";
import { resolveFounderDecision, submitProjectDecision } from "@/lib/decisions/actions";
import { loadOpenDecisions, loadProjectDecisions } from "@/lib/decisions/queries";
import type { KnowledgeKind } from "@/lib/domain/status";
import { formatTimestamp } from "@/lib/format";
import { loadLifecycleHistory } from "@/lib/lifecycle/queries";
import { createMemoryProposal } from "@/lib/memory/actions";
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
import { loadPrimaryRepository } from "@/lib/repository/association";

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

  const [
    project,
    milestones,
    knowledge,
    blockers,
    actions,
    verification,
    rules,
    conversation,
    repositoryFile,
    lifecycle,
    projectDecisions,
    openDecisions,
    primaryRepo,
  ] = await Promise.all([
    loadProjectDetail(session.supabase, id),
    loadMilestones(session.supabase, id),
    loadKnowledge(session.supabase, id),
    loadBlockers(session.supabase, id),
    loadNextActions(session.supabase, id),
    loadVerification(session.supabase, id),
    loadFounderRules(session.supabase),
    loadLatestConversation(session.supabase, id),
    repositorySnapshot(),
    loadLifecycleHistory(session.supabase, id),
    loadProjectDecisions(session.supabase, id),
    loadOpenDecisions(session.supabase, id),
    loadPrimaryRepository(session.supabase, id),
  ]);
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

  const detail = project.data;
  const knowledgeRows = knowledge.status === "ok" ? knowledge.data : [];
  const requirements = knowledgeOf(knowledgeRows, "REQUIREMENT");
  const decisions = knowledgeOf(knowledgeRows, "DECISION");
  const constraints = knowledgeOf(knowledgeRows, "CONSTRAINT");
  const otherKnowledge = knowledgeRows.filter((record) => record.kind === "FACT" || record.kind === "LESSON");
  const milestoneRows = milestones.status === "ok" ? milestones.data : [];
  const current =
    milestoneRows.find((milestone) => milestone.title === detail.currentMilestone) ?? milestoneRows[0] ?? null;
  const blockerRows = blockers.status === "ok" ? blockers.data : [];
  const openBlockers = blockerRows.filter((blocker) => blocker.status === "OPEN");
  const actionRows = actions.status === "ok" ? actions.data : [];
  const openActions = actionRows.filter((action) => action.status === "OPEN" || action.status === "IN_PROGRESS" || action.status === "BLOCKED");
  const nextAction = openActions[0] ?? null;
  const verificationRows = verification.status === "ok" ? verification.data : [];
  const lifecycleRows = lifecycle.status === "ok" ? lifecycle.data : [];
  const decisionRows = projectDecisions.status === "ok" ? projectDecisions.data : [];
  const pendingDecisions = openDecisions.status === "ok" ? openDecisions.data : [];
  const associatedRepo = primaryRepo.status === "ok" ? primaryRepo.data : null;
  const comparesRepository = detail.slug === "ghost" || detail.name.toLocaleLowerCase() === "ghost";
  const repositoryState = comparesRepository ? repositoryFile : null;
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
        <div className="meta">
          <StatusBadge status={detail.status} />
          <Link className="button" href={`/projects/${detail.id}/architect`}>
            Product Architect
          </Link>
          <Link className="button" href={`/projects/${detail.id}/architecture`}>
            System Architecture
          </Link>
          <Link className="button" href={`/projects/${detail.id}/build-plan`}>
            Build Plan
          </Link>
          <Link className="button" href={`/projects/${detail.id}/execution`}>
            Build Execution
          </Link>
          <Link className="button" href={`/projects/${detail.id}/verification`}>
            Verification
          </Link>
          <Link className="button" href={`/projects/${detail.id}/deploy`}>
            Deploy
          </Link>
        </div>
      </div>

      <Panel title="What we are building">
        <p>{detail.description || "No description recorded."}</p>
        <ul className="meta">
          <li>Lifecycle: {detail.lifecycleStage}</li>
          <li>Status: {detail.status.replaceAll("_", " ")}</li>
          <li>Record updated: {formatTimestamp(detail.updatedAt)}</li>
          <li>
            <Link href={`/projects/${detail.id}/architect`}>Open Product Architect</Link>
          </li>
          <li>
            <Link href={`/projects/${detail.id}/architecture`}>Open System Architecture</Link>
          </li>
          <li>
            <Link href={`/projects/${detail.id}/build-plan`}>Open Build Plan</Link>
          </li>
          <li>
            <Link href={`/projects/${detail.id}/execution`}>Open Build Execution</Link>
          </li>
          <li>
            <Link href={`/projects/${detail.id}/verification`}>Open Verification</Link>
          </li>
          <li>
            <Link href={`/projects/${detail.id}/deploy`}>Open Deploy</Link>
          </li>
        </ul>
      </Panel>

      <Panel title="Operating state">
        <ul className="meta">
          <li>Lifecycle stage: {detail.lifecycleStage}</li>
          <li>Current milestone: {detail.currentMilestone || "None recorded"}</li>
          <li>Next action: {nextAction?.title ?? "No open next action recorded."}</li>
          <li>
            Blockers:{" "}
            {openBlockers.length === 0 ? "None open" : `${openBlockers.length} open`}
          </li>
          <li>
            Pending decisions:{" "}
            {pendingDecisions.length === 0 ? "None" : pendingDecisions.length}
          </li>
        </ul>
        {lifecycleRows[0] ? (
          <p className="quiet">
            Last lifecycle change: {lifecycleRows[0].fromStage ?? "none"} → {lifecycleRows[0].toStage}.{" "}
            {lifecycleRows[0].reason}
          </p>
        ) : (
          <p className="quiet">No lifecycle history beyond the current stage.</p>
        )}
      </Panel>

      <Panel title="Needs your decision">
        {openDecisions.status === "error" ? <ErrorState message={openDecisions.message} /> : null}
        {pendingDecisions.length === 0 ? <EmptyState>No open decisions for this project.</EmptyState> : null}
        {pendingDecisions.map((decision) => (
          <article className="list-item" key={decision.id}>
            <h3>{decision.title}</h3>
            <p>{decision.question}</p>
            {decision.context ? <p className="quiet">{decision.context}</p> : null}
            {decision.recommendation ? <p className="quiet">Ghost recommends: {decision.recommendation}</p> : null}
            {decision.options.length > 0 ? (
              <ul className="meta">
                {decision.options.map((option) => (
                  <li key={option.id}>{option.label}</li>
                ))}
              </ul>
            ) : null}
            <ActionForm action={resolveFounderDecision} submitLabel="Resolve decision">
              <input type="hidden" name="decisionId" value={decision.id} />
              <input type="hidden" name="projectId" value={detail.id} />
              <input type="hidden" name="status" value="RESOLVED" />
              <label className="field">
                <span>Your choice</span>
                <input name="selectedOption" required maxLength={200} placeholder="Selected option or answer" />
              </label>
              <label className="field">
                <span>Rationale (optional)</span>
                <textarea name="rationale" />
              </label>
              <label className="field">
                <span>Follow-up next action title (optional)</span>
                <input name="followUpTitle" maxLength={200} />
              </label>
              <label className="field">
                <span>Follow-up description (optional)</span>
                <textarea name="followUpDescription" />
              </label>
            </ActionForm>
            <ActionForm action={resolveFounderDecision} submitLabel="Cancel decision">
              <input type="hidden" name="decisionId" value={decision.id} />
              <input type="hidden" name="projectId" value={detail.id} />
              <input type="hidden" name="status" value="CANCELLED" />
              <input type="hidden" name="founderResponse" value="Cancelled by founder" />
            </ActionForm>
          </article>
        ))}
      </Panel>

      <Panel title="Record a decision">
        <p className="quiet">Ghost can recommend. Only you resolve.</p>
        <ActionForm action={submitProjectDecision} submitLabel="Save decision">
          <input type="hidden" name="projectId" value={detail.id} />
          <label className="field">
            <span>Title</span>
            <input name="title" required maxLength={200} />
          </label>
          <label className="field">
            <span>Question</span>
            <textarea name="question" required />
          </label>
          <label className="field">
            <span>Context</span>
            <textarea name="context" />
          </label>
          <label className="field">
            <span>Option A (optional)</span>
            <input name="optionA" maxLength={200} />
          </label>
          <label className="field">
            <span>Option B (optional)</span>
            <input name="optionB" maxLength={200} />
          </label>
          <label className="field">
            <span>Ghost recommendation (optional)</span>
            <input name="recommendation" maxLength={500} />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Current milestone">
        {milestones.status === "error" ? <ErrorState message={milestones.message} /> : null}
        {!current && !detail.currentMilestone ? <EmptyState>No milestone recorded.</EmptyState> : null}
        {detail.currentMilestone && !current ? (
          <article className="list-item">
            <h3>{detail.currentMilestone}</h3>
            <p className="quiet">Recorded on the project. No matching milestone row yet.</p>
          </article>
        ) : null}
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
          <li>Provider: {associatedRepo?.provider ?? detail.repositoryProvider ?? "Not recorded"}</li>
          <li>URL: {associatedRepo?.htmlUrl ?? detail.repositoryUrl ?? "Not recorded"}</li>
          <li>Branch: {associatedRepo?.defaultBranch ?? detail.repositoryBranch ?? "Not recorded"}</li>
          <li>Last known commit: {detail.repositoryCommit ?? "Not recorded"}</li>
          <li>
            Association:{" "}
            {associatedRepo
              ? `${associatedRepo.fullName} (explicit)`
              : "No explicit repository association"}
          </li>
        </ul>
        <p className="quiet">
          GitHub observations are evidence only. A commit does not mean tested, deployed, or production ready.
          {process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT
            ? ""
            : " GitHub read-only integration is NOT CONFIGURED."}
        </p>
      </Panel>

      <Panel title="Decision history">
        {projectDecisions.status === "error" ? <ErrorState message={projectDecisions.message} /> : null}
        {decisionRows.length === 0 ? <EmptyState>No decisions recorded yet.</EmptyState> : null}
        {decisionRows.slice(0, 8).map((decision) => (
          <article className="list-item" key={`hist-${decision.id}`}>
            <h3>
              {decision.title} · {decision.status}
            </h3>
            <p className="quiet">{decision.question}</p>
            {decision.selectedOption ? <p className="quiet">Selected: {decision.selectedOption}</p> : null}
            {decision.resolvedAt ? <p className="quiet">Resolved {formatTimestamp(decision.resolvedAt)}</p> : null}
          </article>
        ))}
      </Panel>

      <Panel title="Remember something about this project">
        <p className="quiet">This saves a pending project proposal. It does not become an active founder rule.</p>
        <ActionForm action={createMemoryProposal} submitLabel="Save project proposal">
          <input type="hidden" name="scope" value="PROJECT_KNOWLEDGE" />
          <input type="hidden" name="projectId" value={detail.id} />
          <label className="field">
            <span>Title</span>
            <input name="title" required maxLength={200} />
          </label>
          <label className="field">
            <span>What to remember</span>
            <textarea name="content" required />
          </label>
        </ActionForm>
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

      <Panel title="Constraints">
        {constraints.length === 0 ? <EmptyState>No constraints recorded.</EmptyState> : null}
        {constraints.map((item) => (
          <article className="list-item" key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.content}</p>
            <p className="quiet">Source: {item.source || "Not recorded"}</p>
          </article>
        ))}
      </Panel>

      <Panel title="Other knowledge">
        {otherKnowledge.length === 0 ? <EmptyState>No other project knowledge recorded.</EmptyState> : null}
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
