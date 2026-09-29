import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { ProposalActions, RetireRuleButton } from "@/app/(workspace)/memory/memory-actions";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/lib/auth/session";
import { formatTimestamp } from "@/lib/format";
import { createMemoryProposal } from "@/lib/memory/actions";
import { matchesMemoryQuery, MEMORY_RISK, rememberReason } from "@/lib/memory/intelligence";
import { loadFounderRules, loadMemoryProposals, loadProjectKnowledge } from "@/lib/memory/queries";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Memory",
};

async function readFounderFile(): Promise<{ text: string } | { error: string }> {
  try {
    const text = await readFile(path.join(process.cwd(), "FOUNDER.md"), "utf8");
    return { text };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "FOUNDER.md could not be read." };
  }
}

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const params = await searchParams;
  const filter = {
    q: one(params.q),
    status: one(params.status),
    scope: one(params.scope),
    project: one(params.project),
    type: one(params.type),
  };

  const [rules, knowledge, proposals, projects, founderFile] = await Promise.all([
    loadFounderRules(session.supabase),
    loadProjectKnowledge(session.supabase),
    loadMemoryProposals(session.supabase),
    loadProjectSummaries(session.supabase),
    readFounderFile(),
  ]);

  const ruleRows = rules.status === "ok" ? rules.data : [];
  const knowledgeRows = knowledge.status === "ok" ? knowledge.data : [];
  const proposalRows = proposals.status === "ok" ? proposals.data : [];
  const projectName = new Map(
    projects.status === "ok" ? projects.data.map((project) => [project.id, project.name]) : [],
  );
  const active = ruleRows.filter((rule) => rule.status === "ACTIVE");
  const retired = ruleRows.filter((rule) => rule.status === "RETIRED");
  const pending = proposalRows.filter((item) => item.status === "PENDING");
  const reviewed = proposalRows.filter((item) => item.status !== "PENDING");
  const visibleActive = active.filter((rule) =>
    matchesMemoryQuery(
      { title: rule.title, content: rule.content, status: rule.status, scope: "FOUNDER_RULE", projectId: rule.originProjectId, type: "founder_rule" },
      filter,
    ),
  );
  const visibleRetired = retired.filter((rule) =>
    matchesMemoryQuery(
      { title: rule.title, content: rule.content, status: rule.status, scope: "FOUNDER_RULE", projectId: rule.originProjectId, type: "founder_rule" },
      filter,
    ),
  );
  const visibleKnowledge = knowledgeRows.filter((item) =>
    matchesMemoryQuery(
      { title: item.title, content: item.content, status: item.kind, scope: "PROJECT_KNOWLEDGE", projectId: item.projectId, type: item.kind },
      filter,
    ),
  );
  const visiblePending = pending.filter((item) =>
    matchesMemoryQuery(
      { title: item.title, content: item.content, status: item.status, scope: item.scope, projectId: item.projectId, type: item.scope },
      filter,
    ),
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Memory</p>
          <h1>The founder&apos;s operating manual.</h1>
        </div>
      </div>

      <Panel title="Memory health">
        <ul className="meta">
          <li>Active founder rules: {active.length}</li>
          <li>Pending proposals: {pending.length}</li>
          <li>Retired rules: {retired.length}</li>
          <li>Project knowledge: {knowledgeRows.length}</li>
        </ul>
        <p className="quiet">
          Proposal creation is {MEMORY_RISK.proposalCreation}. Approval and retirement are {MEMORY_RISK.approval}. Bulk
          deletion is {MEMORY_RISK.bulkDeletion}. A destructive reset is {MEMORY_RISK.destructiveReset}.
        </p>
      </Panel>

      <Panel title="Filter">
        <form className="stack" method="get">
          <label className="field">
            <span>Text</span>
            <input name="q" defaultValue={filter.q} />
          </label>
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue={filter.status}>
              <option value="">Any status</option>
              <option value="PENDING">Pending</option>
              <option value="ACTIVE">Active</option>
              <option value="RETIRED">Retired</option>
              <option value="REJECTED">Rejected</option>
              <option value="DECISION">Decision</option>
              <option value="REQUIREMENT">Requirement</option>
              <option value="CONSTRAINT">Constraint</option>
            </select>
          </label>
          <label className="field">
            <span>Scope</span>
            <select name="scope" defaultValue={filter.scope}>
              <option value="">Any scope</option>
              <option value="FOUNDER_RULE">Founder rule</option>
              <option value="PROJECT_KNOWLEDGE">Project knowledge</option>
            </select>
          </label>
          <label className="field">
            <span>Project</span>
            <select name="project" defaultValue={filter.project}>
              <option value="">Any project</option>
              {projects.status === "ok"
                ? projects.data.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))
                : null}
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select name="type" defaultValue={filter.type}>
              <option value="">Any type</option>
              <option value="founder_rule">Founder rule</option>
              <option value="FOUNDER_RULE">Founder proposal</option>
              <option value="PROJECT_KNOWLEDGE">Project proposal</option>
              <option value="DECISION">Decision</option>
              <option value="REQUIREMENT">Requirement</option>
              <option value="CONSTRAINT">Constraint</option>
              <option value="LESSON">Lesson</option>
              <option value="FACT">Fact</option>
            </select>
          </label>
          <button className="button" type="submit">
            Apply filter
          </button>
        </form>
      </Panel>

      <Panel title="Pending review">
        <p className="quiet">
          A proposal is not trusted memory. Approve a founder rule, reject it, or keep it on one project.
        </p>
        {proposals.status === "error" ? <ErrorState message={proposals.message} /> : null}
        {visiblePending.length === 0 ? <EmptyState>No pending memory proposals.</EmptyState> : null}
        {visiblePending.map((proposal) => (
          <article className="list-item" key={proposal.id}>
            <h3>{proposal.title}</h3>
            <p>{proposal.content}</p>
            <ul className="meta">
              <li>
                <StatusBadge status={proposal.status} />
              </li>
              <li>
                <StatusBadge status={proposal.scope} />
              </li>
              <li>Project: {proposal.projectId ? projectName.get(proposal.projectId) ?? "Unknown project" : "None"}</li>
              <li>Created {formatTimestamp(proposal.createdAt)}</li>
              <li>Source: {proposal.provenance}</li>
              <li>{rememberReason(proposal.provenance)}</li>
            </ul>
            <ProposalActions proposalId={proposal.id} scope={proposal.scope} projectId={proposal.projectId} />
          </article>
        ))}
      </Panel>

      <Panel title="Active founder rules">
        <p className="quiet">Cross-project rules. A client cannot insert an active rule directly.</p>
        {rules.status === "error" ? <ErrorState message={rules.message} /> : null}
        {visibleActive.length === 0 ? <EmptyState>No active founder rules.</EmptyState> : null}
        {visibleActive.map((rule) => (
          <article className="list-item" key={rule.id}>
            <h3>{rule.title}</h3>
            <p>{rule.content}</p>
            <ul className="meta">
              <li>
                <StatusBadge status={rule.status} />
              </li>
              <li>Provenance: {rule.provenance}</li>
              <li>{rememberReason(rule.provenance)}</li>
              <li>Approved {formatTimestamp(rule.approvedAt)}</li>
            </ul>
            <RetireRuleButton ruleId={rule.id} />
          </article>
        ))}
      </Panel>

      <Panel title="Project knowledge">
        {knowledge.status === "error" ? <ErrorState message={knowledge.message} /> : null}
        {visibleKnowledge.length === 0 ? <EmptyState>No project knowledge is stored.</EmptyState> : null}
        {visibleKnowledge.map((item) => (
          <article className="list-item" key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.content}</p>
            <ul className="meta">
              <li>{item.projectName}</li>
              <li>
                <StatusBadge status={item.kind} />
              </li>
              <li>Source: {item.source || "Not recorded"}</li>
            </ul>
          </article>
        ))}
      </Panel>

      <Panel title="Retired">
        <p className="quiet">Retired rules stay here and are left out of normal Ghost context.</p>
        {visibleRetired.length === 0 ? <EmptyState>No retired founder rules.</EmptyState> : null}
        {visibleRetired.map((rule) => (
          <article className="list-item" key={rule.id}>
            <h3>{rule.title}</h3>
            <p>{rule.content}</p>
            <ul className="meta">
              <li>
                <StatusBadge status={rule.status} />
              </li>
              <li>Provenance: {rule.provenance}</li>
              <li>Updated {formatTimestamp(rule.updatedAt)}</li>
              <li>A separate retirement reason was not recorded.</li>
            </ul>
          </article>
        ))}
        {reviewed.length > 0 ? (
          <div className="stack">
            <h3>Reviewed proposals</h3>
            {reviewed.map((proposal) => (
              <article className="list-item" key={proposal.id}>
                <h3>{proposal.title}</h3>
                <p>{proposal.content}</p>
                <ul className="meta">
                  <li>
                    <StatusBadge status={proposal.status} />
                  </li>
                  <li>Created {formatTimestamp(proposal.createdAt)}</li>
                  <li>Source: {proposal.provenance}</li>
                </ul>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel title="Repository founder rules">
        <p className="quiet">Read from FOUNDER.md. This file is not the database.</p>
        {"error" in founderFile ? <ErrorState message={founderFile.error} /> : <pre className="prose">{founderFile.text}</pre>}
      </Panel>

      <Panel title="Record a proposal">
        <ActionForm action={createMemoryProposal} submitLabel="Save proposal">
          <label className="field">
            <span>Title</span>
            <input name="title" required maxLength={200} />
          </label>
          <label className="field">
            <span>Content</span>
            <textarea name="content" required />
          </label>
          <label className="field">
            <span>Scope</span>
            <select name="scope" defaultValue="FOUNDER_RULE">
              <option value="FOUNDER_RULE">Founder rule</option>
              <option value="PROJECT_KNOWLEDGE">Project knowledge</option>
            </select>
          </label>
          <label className="field">
            <span>Project, required for project knowledge</span>
            <select name="projectId" defaultValue="">
              <option value="">No project</option>
              {projects.status === "ok"
                ? projects.data.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))
                : null}
            </select>
          </label>
          {projects.status === "error" ? <ErrorState message={projects.message} /> : null}
        </ActionForm>
      </Panel>
    </div>
  );
}
