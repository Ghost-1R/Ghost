import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { loadLatestConversation } from "@/lib/conversation/queries";
import { resolveFounderDecision } from "@/lib/decisions/actions";
import { loadIdeaDecisions } from "@/lib/decisions/queries";
import { formatTimestamp } from "@/lib/format";
import {
  addEvidenceAction,
  addValidationAction,
  applyChallengeDraftAction,
  createStrategyDecisionAction,
  promoteIdeaAction,
  saveIdeaStructureAction,
  saveStrategyAction,
  transitionIdeaAction,
  updateValidationAction,
} from "@/lib/ideas/actions";
import {
  loadIdea,
  loadIdeaEvidence,
  loadIdeaHistory,
  loadIdeaStrategy,
  loadIdeaValidations,
} from "@/lib/ideas/queries";
import { computeIdeaReadiness } from "@/lib/ideas/workflow";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Idea ${id.slice(0, 8)}` };
}

function listField(values: string[]): string {
  return values.join("\n");
}

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const [idea, validations, evidence, strategy, history, conversation, decisions] = await Promise.all([
    loadIdea(session.supabase, id),
    loadIdeaValidations(session.supabase, id),
    loadIdeaEvidence(session.supabase, id),
    loadIdeaStrategy(session.supabase, id),
    loadIdeaHistory(session.supabase, id),
    loadLatestConversation(session.supabase, null),
    loadIdeaDecisions(session.supabase, id),
  ]);

  if (idea.status === "error") {
    return (
      <div className="stack">
        <h1>Idea</h1>
        <ErrorState message={idea.message} />
      </div>
    );
  }
  if (!idea.data) notFound();

  const record = idea.data;
  const validationRows = validations.status === "ok" ? validations.data : [];
  const evidenceRows = evidence.status === "ok" ? evidence.data : [];
  const strategyRow = strategy.status === "ok" ? strategy.data : null;
  const historyRows = history.status === "ok" ? history.data : [];
  const decisionRows = decisions.status === "ok" ? decisions.data : [];
  const openIdeaDecisions = decisionRows.filter((row) => row.status === "OPEN");
  const readiness = computeIdeaReadiness({
    problem: record.problem,
    targetUser: record.targetUser,
    proposedSolution: record.proposedSolution,
    evidenceCount: evidenceRows.length,
    openValidationCount: validationRows.filter((row) => row.status === "OPEN" || row.status === "IN_PROGRESS").length,
    supportedValidationCount: validationRows.filter((row) => row.status === "SUPPORTED").length,
    assumptionCount: record.assumptions.length,
    riskCount: record.risks.length,
  });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Idea Lab</p>
          <h1>{record.title}</h1>
        </div>
        <ul className="meta">
          <li>
            <StatusBadge status={record.status} />
          </li>
          <li>{record.readiness}</li>
        </ul>
      </div>

      <Panel title="Readiness">
        <p>
          Ghost considers this idea <strong>{readiness.readiness.replaceAll("_", " ").toLowerCase()}</strong>
          — not a success probability.
        </p>
        <ul className="meta">
          {readiness.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </Panel>

      <Panel title="Ask Ghost about this idea">
        <p className="quiet">
          Ask Ghost to explore, challenge, or clarify. Ghost may recommend. Ghost cannot approve or promote.
        </p>
        {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
        <GhostConversation
          projectId={null}
          projectName={null}
          ideaId={record.id}
          conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
          messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
          providerConfigured={isModelConfigured()}
        />
      </Panel>

      <Panel title="Idea">
        <p className="quiet">Raw founder input</p>
        <p>{record.rawIdea}</p>
        <ActionForm action={saveIdeaStructureAction} submitLabel="Save structure">
          <input type="hidden" name="ideaId" value={record.id} />
          <label className="field">
            <span>Title</span>
            <input name="title" required defaultValue={record.title} maxLength={200} />
          </label>
          <label className="field">
            <span>Summary</span>
            <textarea name="summary" defaultValue={record.summary} />
          </label>
          <label className="field">
            <span>Problem</span>
            <textarea name="problem" defaultValue={record.problem} />
          </label>
          <label className="field">
            <span>Who it is for</span>
            <textarea name="targetUser" defaultValue={record.targetUser} />
          </label>
          <label className="field">
            <span>Proposed solution</span>
            <textarea name="proposedSolution" defaultValue={record.proposedSolution} />
          </label>
          <label className="field">
            <span>Value proposition</span>
            <textarea name="valueProposition" defaultValue={record.valueProposition} />
          </label>
          <label className="field">
            <span>Assumptions (one per line — not facts)</span>
            <textarea name="assumptions" defaultValue={listField(record.assumptions)} />
          </label>
          <label className="field">
            <span>Risks (one per line)</span>
            <textarea name="risks" defaultValue={listField(record.risks)} />
          </label>
          <label className="field">
            <span>Opportunities (one per line)</span>
            <textarea name="opportunities" defaultValue={listField(record.opportunities)} />
          </label>
          <label className="field">
            <span>Constraints (one per line)</span>
            <textarea name="constraints" defaultValue={listField(record.constraints)} />
          </label>
          <label className="field">
            <span>Open questions (one per line)</span>
            <textarea name="openQuestions" defaultValue={listField(record.openQuestions)} />
          </label>
          <label className="field">
            <span>Ghost recommendation (optional, not a decision)</span>
            <textarea name="recommendation" defaultValue={record.recommendation ?? ""} />
          </label>
          <label className="field">
            <span>Note</span>
            <textarea name="note" defaultValue={record.note} />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Challenge outcomes">
        <p className="quiet">
          Paste assumptions, risks, and questions Ghost surfaced. Saving marks them as founder-accepted drafts — not verified truth.
        </p>
        <ActionForm action={applyChallengeDraftAction} submitLabel="Store challenge outcomes">
          <input type="hidden" name="ideaId" value={record.id} />
          <label className="field">
            <span>Assumptions to add</span>
            <textarea name="assumptions" placeholder="Freelancers hate receipt sorting&#10;Existing tools are too complex" />
          </label>
          <label className="field">
            <span>Risks to add</span>
            <textarea name="risks" />
          </label>
          <label className="field">
            <span>Open questions to add</span>
            <textarea name="openQuestions" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Validation">
        <ActionForm action={addValidationAction} submitLabel="Add validation question">
          <input type="hidden" name="ideaId" value={record.id} />
          <label className="field">
            <span>Question</span>
            <textarea name="question" required />
          </label>
          <label className="field">
            <span>Why it matters</span>
            <textarea name="reason" />
          </label>
          <label className="field">
            <span>Evidence needed</span>
            <textarea name="evidenceNeeded" />
          </label>
        </ActionForm>
        {validationRows.length === 0 ? <EmptyState>No validation questions yet.</EmptyState> : null}
        {validationRows.map((item) => (
          <article className="list-item" key={item.id}>
            <h3>{item.question}</h3>
            <p className="quiet">
              {item.status} · {item.reason || "No reason recorded"}
            </p>
            <ActionForm action={updateValidationAction} submitLabel="Update validation">
              <input type="hidden" name="ideaId" value={record.id} />
              <input type="hidden" name="validationId" value={item.id} />
              <label className="field">
                <span>Status</span>
                <select name="status" defaultValue={item.status}>
                  <option value="OPEN">OPEN</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="SUPPORTED">SUPPORTED</option>
                  <option value="REFUTED">REFUTED</option>
                  <option value="INCONCLUSIVE">INCONCLUSIVE</option>
                </select>
              </label>
              <label className="field">
                <span>Result</span>
                <textarea name="result" defaultValue={item.result} />
              </label>
            </ActionForm>
          </article>
        ))}
      </Panel>

      <Panel title="Evidence">
        <p className="quiet">Founder-entered evidence only. AI opinion is not evidence.</p>
        <ActionForm action={addEvidenceAction} submitLabel="Add evidence">
          <input type="hidden" name="ideaId" value={record.id} />
          <label className="field">
            <span>Type</span>
            <select name="evidenceType" defaultValue="OBSERVATION">
              <option value="OBSERVATION">OBSERVATION</option>
              <option value="CUSTOMER_FEEDBACK">CUSTOMER_FEEDBACK</option>
              <option value="TEST_RESULT">TEST_RESULT</option>
              <option value="METRIC">METRIC</option>
              <option value="DOCUMENT">DOCUMENT</option>
              <option value="LINK">LINK</option>
              <option value="TECHNICAL_RESULT">TECHNICAL_RESULT</option>
              <option value="FOUNDER_DECISION">FOUNDER_DECISION</option>
            </select>
          </label>
          <label className="field">
            <span>Statement</span>
            <textarea name="statement" required />
          </label>
          <label className="field">
            <span>Source</span>
            <input name="source" />
          </label>
          <label className="field">
            <span>Confidence (optional)</span>
            <input name="confidence" maxLength={80} />
          </label>
        </ActionForm>
        {evidenceRows.length === 0 ? <EmptyState>No evidence recorded.</EmptyState> : null}
        {evidenceRows.map((item) => (
          <article className="list-item" key={item.id}>
            <h3>{item.evidenceType}</h3>
            <p>{item.statement}</p>
            <p className="quiet">
              {item.source || "No source"} · {item.provenance} · {formatTimestamp(item.createdAt)}
            </p>
          </article>
        ))}
      </Panel>

      <Panel title="Decision">
        <p className="quiet">Only you approve, reject, archive, or keep exploring.</p>
        <div className="stack">
          {(
            [
              ["NEEDS_DECISION", "Mark needs decision"],
              ["APPROVED", "Approve idea"],
              ["REJECTED", "Reject idea"],
              ["EXPLORING", "Keep exploring"],
              ["ARCHIVED", "Archive"],
              ["VALIDATING", "Move to validating"],
            ] as const
          ).map(([status, label]) => (
            <ActionForm key={status} action={transitionIdeaAction} submitLabel={label}>
              <input type="hidden" name="ideaId" value={record.id} />
              <input type="hidden" name="toStatus" value={status} />
              <input type="hidden" name="reason" value={`Founder chose ${status} on Idea Lab.`} />
            </ActionForm>
          ))}
        </div>
      </Panel>

      <Panel title="Strategy">
        <p className="quiet">
          Draft freely. Approve explicitly. Empty fields stay unknown — Ghost will not invent them.
        </p>
        <ActionForm action={saveStrategyAction} submitLabel="Save strategy draft">
          <input type="hidden" name="ideaId" value={record.id} />
          <label className="field">
            <span>Vision</span>
            <textarea name="vision" defaultValue={strategyRow?.vision ?? ""} />
          </label>
          <label className="field">
            <span>Problem</span>
            <textarea name="problem" defaultValue={strategyRow?.problem ?? record.problem} />
          </label>
          <label className="field">
            <span>Target customer / user</span>
            <textarea name="targetCustomer" defaultValue={strategyRow?.targetCustomer ?? record.targetUser} />
          </label>
          <label className="field">
            <span>Positioning</span>
            <textarea name="positioning" defaultValue={strategyRow?.positioning ?? ""} />
          </label>
          <label className="field">
            <span>Value proposition</span>
            <textarea name="valueProposition" defaultValue={strategyRow?.valueProposition ?? record.valueProposition} />
          </label>
          <label className="field">
            <span>Core offer</span>
            <textarea name="coreOffer" defaultValue={strategyRow?.coreOffer ?? ""} />
          </label>
          <label className="field">
            <span>Differentiation</span>
            <textarea name="differentiation" defaultValue={strategyRow?.differentiation ?? ""} />
          </label>
          <label className="field">
            <span>Business / value model</span>
            <textarea name="valueModel" defaultValue={strategyRow?.valueModel ?? ""} />
          </label>
          <label className="field">
            <span>Distribution</span>
            <textarea name="distribution" defaultValue={strategyRow?.distribution ?? ""} />
          </label>
          <label className="field">
            <span>Key capabilities (one per line)</span>
            <textarea name="keyCapabilities" defaultValue={listField(strategyRow?.keyCapabilities ?? [])} />
          </label>
          <label className="field">
            <span>Constraints (one per line)</span>
            <textarea name="constraints" defaultValue={listField(strategyRow?.constraints ?? [])} />
          </label>
          <label className="field">
            <span>Risks (one per line)</span>
            <textarea name="risks" defaultValue={listField(strategyRow?.risks ?? [])} />
          </label>
          <label className="field">
            <span>Assumptions (one per line)</span>
            <textarea name="assumptions" defaultValue={listField(strategyRow?.assumptions ?? [])} />
          </label>
          <label className="field">
            <span>Success measures (one per line)</span>
            <textarea name="successMeasures" defaultValue={listField(strategyRow?.successMeasures ?? [])} />
          </label>
          <label className="field">
            <span>Non-goals (one per line)</span>
            <textarea name="nonGoals" defaultValue={listField(strategyRow?.nonGoals ?? [])} />
          </label>
          <label className="field">
            <span>Initial scope</span>
            <textarea name="initialScope" defaultValue={strategyRow?.initialScope ?? ""} />
          </label>
          <label className="field">
            <span>MVP</span>
            <textarea name="mvp" defaultValue={strategyRow?.mvp ?? ""} />
          </label>
          <label className="field">
            <span>What we are not building</span>
            <textarea name="notBuilding" defaultValue={strategyRow?.notBuilding ?? ""} />
          </label>
          <label className="field">
            <span>Open strategic decisions (one per line)</span>
            <textarea name="openDecisions" defaultValue={listField(strategyRow?.openDecisions ?? [])} />
          </label>
        </ActionForm>
        {record.status === "APPROVED" || strategyRow ? (
          <ActionForm action={saveStrategyAction} submitLabel="Approve strategy">
            <input type="hidden" name="ideaId" value={record.id} />
            <input type="hidden" name="approve" value="yes" />
            <input type="hidden" name="vision" value={strategyRow?.vision ?? ""} />
            <input type="hidden" name="problem" value={strategyRow?.problem ?? record.problem} />
            <input type="hidden" name="targetCustomer" value={strategyRow?.targetCustomer ?? record.targetUser} />
            <input type="hidden" name="positioning" value={strategyRow?.positioning ?? ""} />
            <input type="hidden" name="valueProposition" value={strategyRow?.valueProposition ?? record.valueProposition} />
            <input type="hidden" name="coreOffer" value={strategyRow?.coreOffer ?? ""} />
            <input type="hidden" name="differentiation" value={strategyRow?.differentiation ?? ""} />
            <input type="hidden" name="valueModel" value={strategyRow?.valueModel ?? ""} />
            <input type="hidden" name="distribution" value={strategyRow?.distribution ?? ""} />
            <input type="hidden" name="keyCapabilities" value={listField(strategyRow?.keyCapabilities ?? [])} />
            <input type="hidden" name="constraints" value={listField(strategyRow?.constraints ?? [])} />
            <input type="hidden" name="risks" value={listField(strategyRow?.risks ?? [])} />
            <input type="hidden" name="assumptions" value={listField(strategyRow?.assumptions ?? [])} />
            <input type="hidden" name="successMeasures" value={listField(strategyRow?.successMeasures ?? [])} />
            <input type="hidden" name="nonGoals" value={listField(strategyRow?.nonGoals ?? [])} />
            <input type="hidden" name="initialScope" value={strategyRow?.initialScope ?? ""} />
            <input type="hidden" name="mvp" value={strategyRow?.mvp ?? ""} />
            <input type="hidden" name="notBuilding" value={strategyRow?.notBuilding ?? ""} />
            <input type="hidden" name="openDecisions" value={listField(strategyRow?.openDecisions ?? [])} />
          </ActionForm>
        ) : null}
        {strategyRow?.approvedAt ? (
          <p className="notice">Strategy approved {formatTimestamp(strategyRow.approvedAt)}.</p>
        ) : (
          <p className="quiet">Strategy is a draft until you approve it.</p>
        )}
      </Panel>

      <Panel title="Needs your decision">
        {decisions.status === "error" ? <ErrorState message={decisions.message} /> : null}
        {openIdeaDecisions.length === 0 ? (
          <EmptyState>No open strategic decisions for this idea.</EmptyState>
        ) : null}
        {openIdeaDecisions.map((decision) => (
          <article className="list-item" key={decision.id}>
            <h3>{decision.title}</h3>
            <p>{decision.question}</p>
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
              <input type="hidden" name="projectId" value={decision.projectId ?? ""} />
              <input type="hidden" name="status" value="RESOLVED" />
              <label className="field">
                <span>Your choice</span>
                <input name="selectedOption" required maxLength={200} />
              </label>
              <label className="field">
                <span>Rationale (optional)</span>
                <textarea name="rationale" />
              </label>
            </ActionForm>
          </article>
        ))}
      </Panel>

      <Panel title="Strategic decision → Needs Your Decision">
        <p className="quiet">Creates a real V4 decision inbox item linked to this idea.</p>
        <ActionForm action={createStrategyDecisionAction} submitLabel="Send to Decision Inbox">
          <input type="hidden" name="ideaId" value={record.id} />
          <input type="hidden" name="strategyId" value={strategyRow?.id ?? ""} />
          <input type="hidden" name="projectId" value={record.promotedProjectId ?? ""} />
          <label className="field">
            <span>Title</span>
            <input name="title" required maxLength={200} placeholder="Web first vs mobile first" />
          </label>
          <label className="field">
            <span>Question</span>
            <textarea name="question" required />
          </label>
          <label className="field">
            <span>Option A</span>
            <input name="optionA" />
          </label>
          <label className="field">
            <span>Option B</span>
            <input name="optionB" />
          </label>
          <label className="field">
            <span>Ghost recommendation (optional)</span>
            <input name="recommendation" />
          </label>
        </ActionForm>
      </Panel>

      {record.status === "APPROVED" && !record.promotedProjectId ? (
        <Panel title="Create project">
          <p className="quiet">
            Explicit promotion only. Creates a V4 project with provenance back to this idea and a first next action.
          </p>
          <ActionForm action={promoteIdeaAction} submitLabel="Create Project">
            <input type="hidden" name="ideaId" value={record.id} />
          </ActionForm>
        </Panel>
      ) : null}

      {record.promotedProjectId ? (
        <Panel title="Promoted project">
          <p>
            This idea is linked to{" "}
            <Link href={`/projects/${record.promotedProjectId}`}>its project</Link>. Promotion is not
            implementation or deployment.
          </p>
        </Panel>
      ) : null}

      <Panel title="History">
        {historyRows.length === 0 ? <EmptyState>No transitions yet.</EmptyState> : null}
        {historyRows.map((row) => (
          <article className="list-item" key={row.id}>
            <h3>
              {row.fromStatus ?? "none"} → {row.toStatus}
            </h3>
            <p className="quiet">
              {row.reason} · {formatTimestamp(row.changedAt)}
            </p>
          </article>
        ))}
      </Panel>
    </div>
  );
}
