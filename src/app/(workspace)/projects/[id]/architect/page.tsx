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
import { formatTimestamp } from "@/lib/format";
import {
  createDependencyAction,
  createFeatureAction,
  createFlowAction,
  createQuestionAction,
  createRequirementAction,
  escalateQuestionToDecisionAction,
  initializeProductArchitectAction,
  resolveQuestionAction,
  saveProductDefinitionAction,
  syncProductNextActionAction,
  transitionProductArchitectureAction,
  updateFeatureAction,
  updateRequirementAction,
} from "@/lib/product-architect/actions";
import {
  loadProductArchitecture,
  loadProductArchitectureHistory,
  loadProductDependencies,
  loadProductFeatures,
  loadProductFlows,
  loadProductQuestions,
  loadProductRequirements,
} from "@/lib/product-architect/queries";
import { computeProductReadiness } from "@/lib/product-architect/workflow";
import { loadProjectDetail } from "@/lib/projects/queries";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Product Architect ${id.slice(0, 8)}` };
}

export default async function ProductArchitectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (!UUID_PATTERN.test(projectId)) notFound();

  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status === "error") {
    return (
      <div className="stack">
        <h1>Product Architect</h1>
        <ErrorState message={project.message} />
      </div>
    );
  }
  if (!project.data) notFound();

  const architecture = await loadProductArchitecture(session.supabase, projectId);
  if (architecture.status === "error") {
    return (
      <div className="stack">
        <h1>Product Architect</h1>
        <ErrorState message={architecture.message} />
      </div>
    );
  }

  if (!architecture.data) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <p className="eyebrow">Product Architect</p>
            <h1>{project.data.name}</h1>
          </div>
          <Link className="button-secondary" href={`/projects/${projectId}`}>
            Back to project
          </Link>
        </div>
        <Panel title="Initialize Product Architect">
          <p className="quiet">
            Turns approved strategy and project context into a buildable product specification. Does not invent
            requirements as truth.
          </p>
          <ActionForm action={initializeProductArchitectAction} submitLabel="Initialize Product Architect">
            <input type="hidden" name="projectId" value={projectId} />
          </ActionForm>
        </Panel>
      </div>
    );
  }

  const arch = architecture.data;
  const [requirements, features, flows, questions, dependencies, history, conversation, openDecisions] =
    await Promise.all([
      loadProductRequirements(session.supabase, arch.id),
      loadProductFeatures(session.supabase, arch.id),
      loadProductFlows(session.supabase, arch.id),
      loadProductQuestions(session.supabase, arch.id),
      loadProductDependencies(session.supabase, arch.id),
      loadProductArchitectureHistory(session.supabase, arch.id),
      loadLatestConversation(session.supabase, projectId),
      session.supabase.from("project_decisions").select("id").eq("project_id", projectId).eq("status", "OPEN"),
    ]);

  const requirementRows = requirements.status === "ok" ? requirements.data : [];
  const featureRows = features.status === "ok" ? features.data : [];
  const flowRows = flows.status === "ok" ? flows.data : [];
  const questionRows = questions.status === "ok" ? questions.data : [];
  const dependencyRows = dependencies.status === "ok" ? dependencies.data : [];
  const historyRows = history.status === "ok" ? history.data : [];
  const readiness = computeProductReadiness({
    architecture: arch,
    requirements: requirementRows,
    features: featureRows,
    openQuestions: questionRows,
    openCriticalDecisions: openDecisions.data?.length ?? 0,
  });
  const acceptedCount = requirementRows.filter((row) => row.approvalStatus === "ACCEPTED").length;
  const proposedCount = requirementRows.filter((row) => row.approvalStatus === "PROPOSED").length;
  const approvedFeatures = featureRows.filter((row) => row.status !== "PROPOSED").length;
  const openQuestions = questionRows.filter((row) => row.status === "OPEN" || row.status === "ESCALATED");

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Product Architect</p>
          <h1>{project.data.name}</h1>
        </div>
        <ul className="meta">
          <li>
            <StatusBadge status={arch.status} />
          </li>
          <li>
            <Link className="button-secondary" href={`/projects/${projectId}`}>
              Project
            </Link>
          </li>
        </ul>
      </div>

      <Panel title="Overview">
        <p>
          Status <strong>{arch.status}</strong>
          {arch.ideaId ? ` · Idea ${arch.ideaId.slice(0, 8)}` : ""}
          {arch.strategyId ? ` · Strategy ${arch.strategyId.slice(0, 8)}` : ""}
        </p>
        <ul className="meta">
          <li>Requirements: {acceptedCount} accepted / {proposedCount} proposed / {requirementRows.length} total</li>
          <li>Features: {approvedFeatures} approved-or-later / {featureRows.length} total</li>
          <li>Flows: {flowRows.length}</li>
          <li>Open questions: {openQuestions.length}</li>
          <li>Open decisions: {openDecisions.data?.length ?? 0}</li>
          <li>Dependencies: {dependencyRows.length}</li>
        </ul>
        <p className="quiet">Ghost does not invent completion percentages.</p>
      </Panel>

      <Panel title="Readiness">
        {readiness.buildReady ? (
          <>
            <p>
              <strong>BUILD READY</strong>
            </p>
            <ul className="meta">
              {readiness.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p>
              <strong>NOT BUILD READY</strong> · {readiness.gaps.length} item
              {readiness.gaps.length === 1 ? "" : "s"} remaining
            </p>
            <ul className="meta">
              {readiness.gaps.map((gap) => (
                <li key={gap.code}>{gap.message}</li>
              ))}
            </ul>
          </>
        )}
        <ActionForm action={syncProductNextActionAction} submitLabel="Record justified next action">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="architectureId" value={arch.id} />
        </ActionForm>
        <div className="meta">
          {(["DEFINING", "REVIEW", "APPROVED", "BUILD_READY"] as const).map((status) => (
            <ActionForm key={status} action={transitionProductArchitectureAction} submitLabel={`Move to ${status}`}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="architectureId" value={arch.id} />
              <input type="hidden" name="toStatus" value={status} />
              <input type="hidden" name="reason" value={`Founder moved Product Architect to ${status}.`} />
            </ActionForm>
          ))}
        </div>
      </Panel>

      <Panel title="Ask Ghost about this product">
        <p className="quiet">Answers must use Product Architect records. Proposals are not approvals.</p>
        {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
        <GhostConversation
          projectId={projectId}
          projectName={project.data.name}
          conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
          messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
          providerConfigured={isModelConfigured()}
        />
      </Panel>

      <Panel title="Product definition">
        <ActionForm action={saveProductDefinitionAction} submitLabel="Save definition">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="architectureId" value={arch.id} />
          <label className="field">
            <span>What are we building?</span>
            <textarea name="what" defaultValue={arch.what} />
          </label>
          <label className="field">
            <span>Why?</span>
            <textarea name="why" defaultValue={arch.why} />
          </label>
          <label className="field">
            <span>Who is it for?</span>
            <textarea name="who" defaultValue={arch.who} />
          </label>
          <label className="field">
            <span>Desired outcome</span>
            <textarea name="outcome" defaultValue={arch.outcome} />
          </label>
          <label className="field">
            <span>Non-goals (one per line)</span>
            <textarea name="nonGoals" defaultValue={arch.nonGoals.join("\n")} />
          </label>
          <label className="field">
            <span>Assumptions (not facts)</span>
            <textarea name="assumptions" defaultValue={arch.assumptions.join("\n")} />
          </label>
          <label className="field">
            <span>Risks</span>
            <textarea name="risks" defaultValue={arch.risks.join("\n")} />
          </label>
          <label className="field">
            <span>Constraints</span>
            <textarea name="constraints" defaultValue={arch.constraints.join("\n")} />
          </label>
          <label className="field">
            <span>Note</span>
            <textarea name="note" defaultValue={arch.note} />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Requirements">
        {requirements.status === "error" ? <ErrorState message={requirements.message} /> : null}
        {requirementRows.length === 0 ? <EmptyState>No requirements yet.</EmptyState> : null}
        {requirementRows.map((requirement) => (
          <article className="list-item" key={requirement.id}>
            <h3>
              {requirement.humanId}: {requirement.title}
            </h3>
            <p className="quiet">
              {requirement.approvalStatus} · {requirement.reqType} · {requirement.priority} · {requirement.provenance}
            </p>
            <p>{requirement.description}</p>
            {requirement.acceptanceCriteria.length ? (
              <ul className="meta">
                {requirement.acceptanceCriteria.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="quiet">No acceptance criteria recorded.</p>
            )}
            <ActionForm action={updateRequirementAction} submitLabel="Save requirement">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="requirementId" value={requirement.id} />
              <label className="field">
                <span>Title</span>
                <input name="title" defaultValue={requirement.title} required />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea name="description" defaultValue={requirement.description} />
              </label>
              <label className="field">
                <span>Acceptance criteria (one per line)</span>
                <textarea name="acceptanceCriteria" defaultValue={requirement.acceptanceCriteria.join("\n")} />
              </label>
              <label className="field">
                <span>Approval</span>
                <select name="approvalStatus" defaultValue={requirement.approvalStatus}>
                  <option value="PROPOSED">PROPOSED</option>
                  <option value="ACCEPTED">ACCEPTED</option>
                  <option value="REJECTED">REJECTED</option>
                  <option value="RETIRED">RETIRED</option>
                </select>
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createRequirementAction} submitLabel="Propose requirement">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="architectureId" value={arch.id} />
          <label className="field">
            <span>Title</span>
            <input name="title" required maxLength={200} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea name="description" />
          </label>
          <label className="field">
            <span>Type</span>
            <select name="reqType" defaultValue="FUNCTIONAL">
              <option value="FUNCTIONAL">FUNCTIONAL</option>
              <option value="NON_FUNCTIONAL">NON_FUNCTIONAL</option>
              <option value="SECURITY">SECURITY</option>
              <option value="PERFORMANCE">PERFORMANCE</option>
              <option value="UX">UX</option>
              <option value="OPERATIONAL">OPERATIONAL</option>
            </select>
          </label>
          <label className="field">
            <span>Priority</span>
            <select name="priority" defaultValue="NORMAL">
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="NORMAL">NORMAL</option>
              <option value="LOW">LOW</option>
            </select>
          </label>
          <label className="field">
            <span>Acceptance criteria (one per line)</span>
            <textarea name="acceptanceCriteria" />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Features">
        {featureRows.length === 0 ? <EmptyState>No features yet.</EmptyState> : null}
        {featureRows.map((feature) => (
          <article className="list-item" key={feature.id}>
            <h3>
              {feature.humanId}: {feature.name}
            </h3>
            <p className="quiet">
              {feature.status} · {feature.priority} · linked requirements {feature.requirementIds.length}
            </p>
            <p>{feature.purpose}</p>
            {feature.acceptanceCriteria.length ? (
              <ul className="meta">
                {feature.acceptanceCriteria.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="quiet">No acceptance criteria recorded.</p>
            )}
            <ActionForm action={updateFeatureAction} submitLabel="Save feature">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="featureId" value={feature.id} />
              <label className="field">
                <span>Name</span>
                <input name="name" defaultValue={feature.name} required />
              </label>
              <label className="field">
                <span>Purpose</span>
                <textarea name="purpose" defaultValue={feature.purpose} />
              </label>
              <label className="field">
                <span>Acceptance criteria</span>
                <textarea name="acceptanceCriteria" defaultValue={feature.acceptanceCriteria.join("\n")} />
              </label>
              <fieldset className="field">
                <legend>Linked requirements</legend>
                {requirementRows.map((requirement) => (
                  <label key={requirement.id}>
                    <input
                      type="checkbox"
                      name="requirementIds"
                      value={requirement.id}
                      defaultChecked={feature.requirementIds.includes(requirement.id)}
                    />{" "}
                    {requirement.humanId}
                  </label>
                ))}
              </fieldset>
              <label className="field">
                <span>Status</span>
                <select name="status" defaultValue={feature.status}>
                  <option value="PROPOSED">PROPOSED</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="BUILD_READY">BUILD_READY</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="VERIFIED">VERIFIED</option>
                </select>
              </label>
            </ActionForm>
          </article>
        ))}
        <ActionForm action={createFeatureAction} submitLabel="Propose feature">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="architectureId" value={arch.id} />
          <label className="field">
            <span>Name</span>
            <input name="name" required maxLength={200} />
          </label>
          <label className="field">
            <span>Purpose</span>
            <textarea name="purpose" />
          </label>
          <label className="field">
            <span>Acceptance criteria</span>
            <textarea name="acceptanceCriteria" />
          </label>
          <fieldset className="field">
            <legend>Link accepted/proposed requirements</legend>
            {requirementRows.map((requirement) => (
              <label key={requirement.id}>
                <input type="checkbox" name="requirementIds" value={requirement.id} /> {requirement.humanId}
              </label>
            ))}
          </fieldset>
        </ActionForm>
      </Panel>

      <Panel title="User flows">
        {flowRows.length === 0 ? <EmptyState>No flows yet.</EmptyState> : null}
        {flowRows.map((flow) => (
          <article className="list-item" key={flow.id}>
            <h3>
              {flow.humanId}: {flow.name}
            </h3>
            <p className="quiet">
              Actor: {flow.actor || "unknown"} · Start: {flow.startingCondition || "unknown"}
            </p>
            <ol>
              {flow.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="quiet">Outcome: {flow.expectedOutcome || "unknown"}</p>
          </article>
        ))}
        <ActionForm action={createFlowAction} submitLabel="Add flow">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="architectureId" value={arch.id} />
          <label className="field">
            <span>Name</span>
            <input name="name" required />
          </label>
          <label className="field">
            <span>Actor</span>
            <input name="actor" />
          </label>
          <label className="field">
            <span>Starting condition</span>
            <input name="startingCondition" />
          </label>
          <label className="field">
            <span>Steps (one per line)</span>
            <textarea name="steps" />
          </label>
          <label className="field">
            <span>Expected outcome</span>
            <textarea name="expectedOutcome" />
          </label>
          <label className="field">
            <span>Edge cases</span>
            <textarea name="edgeCases" />
          </label>
          <label className="field">
            <span>Feature</span>
            <select name="featureId" defaultValue="">
              <option value="">None</option>
              {featureRows.map((feature) => (
                <option key={feature.id} value={feature.id}>
                  {feature.humanId}
                </option>
              ))}
            </select>
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Unresolved questions / decisions">
        {openQuestions.length === 0 ? <EmptyState>No open product questions.</EmptyState> : null}
        {openQuestions.map((question) => (
          <article className="list-item" key={question.id}>
            <h3>{question.question}</h3>
            <p className="quiet">{question.status}</p>
            <ActionForm action={resolveQuestionAction} submitLabel="Resolve question">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="questionId" value={question.id} />
              <input type="hidden" name="status" value="RESOLVED" />
              <label className="field">
                <span>Resolution</span>
                <textarea name="resolution" required />
              </label>
            </ActionForm>
            {question.status === "OPEN" ? (
              <ActionForm action={escalateQuestionToDecisionAction} submitLabel="Send to Decision Inbox">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="architectureId" value={arch.id} />
                <input type="hidden" name="questionId" value={question.id} />
                <input type="hidden" name="question" value={question.question} />
                <label className="field">
                  <span>Option A</span>
                  <input name="optionA" />
                </label>
                <label className="field">
                  <span>Option B</span>
                  <input name="optionB" />
                </label>
              </ActionForm>
            ) : null}
          </article>
        ))}
        <ActionForm action={createQuestionAction} submitLabel="Add unresolved question">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="architectureId" value={arch.id} />
          <label className="field">
            <span>Question</span>
            <textarea name="question" required />
          </label>
        </ActionForm>
      </Panel>

      <Panel title="Dependencies">
        {dependencyRows.length === 0 ? <EmptyState>No dependencies recorded.</EmptyState> : null}
        {dependencyRows.map((dependency) => (
          <article className="list-item" key={dependency.id}>
            <h3>
              {dependency.fromKind}:{dependency.fromRef} → {dependency.toKind}:{dependency.toRef}
            </h3>
            <p className="quiet">
              {dependency.status}
              {dependency.note ? ` · ${dependency.note}` : ""}
            </p>
          </article>
        ))}
        <ActionForm action={createDependencyAction} submitLabel="Add dependency">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="architectureId" value={arch.id} />
          <label className="field">
            <span>From kind</span>
            <select name="fromKind" defaultValue="FEATURE">
              <option value="FEATURE">FEATURE</option>
              <option value="REQUIREMENT">REQUIREMENT</option>
              <option value="DECISION">DECISION</option>
              <option value="EXTERNAL">EXTERNAL</option>
              <option value="ARCHITECTURE_WORK">ARCHITECTURE_WORK</option>
            </select>
          </label>
          <label className="field">
            <span>From ref</span>
            <input name="fromRef" required placeholder="FEAT-001 or Stripe" />
          </label>
          <label className="field">
            <span>To kind</span>
            <select name="toKind" defaultValue="REQUIREMENT">
              <option value="FEATURE">FEATURE</option>
              <option value="REQUIREMENT">REQUIREMENT</option>
              <option value="DECISION">DECISION</option>
              <option value="EXTERNAL">EXTERNAL</option>
              <option value="ARCHITECTURE_WORK">ARCHITECTURE_WORK</option>
            </select>
          </label>
          <label className="field">
            <span>To ref</span>
            <input name="toRef" required placeholder="REQ-001" />
          </label>
          <label className="field">
            <span>Note</span>
            <textarea name="note" />
          </label>
        </ActionForm>
      </Panel>

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
