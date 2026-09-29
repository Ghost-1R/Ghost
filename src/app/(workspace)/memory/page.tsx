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

export default async function MemoryPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const [rules, knowledge, proposals, projects, founderFile] = await Promise.all([
    loadFounderRules(session.supabase),
    loadProjectKnowledge(session.supabase),
    loadMemoryProposals(session.supabase),
    loadProjectSummaries(session.supabase),
    readFounderFile(),
  ]);

  const pending = proposals.status === "ok" ? proposals.data.filter((item) => item.status === "PENDING") : [];
  const reviewed = proposals.status === "ok" ? proposals.data.filter((item) => item.status !== "PENDING") : [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Memory</p>
          <h1>Rules, knowledge, proposals.</h1>
        </div>
      </div>

      <Panel title="Repository founder rules">
        <p className="quiet">
          Read from FOUNDER.md in this working tree. This is not the database, and it has not been
          synced into Supabase.
        </p>
        {"error" in founderFile ? <ErrorState message={founderFile.error} /> : <pre className="prose">{founderFile.text}</pre>}
      </Panel>

      <Panel title="Founder rules">
        <p className="quiet">Approved cross-project rules stored for this founder.</p>
        {rules.status === "error" ? <ErrorState message={rules.message} /> : null}
        {rules.status === "ok" && rules.data.length === 0 ? (
          <EmptyState>No founder rules are stored in the database.</EmptyState>
        ) : null}
        {rules.status === "ok"
          ? rules.data.map((rule) => (
              <article className="list-item" key={rule.id}>
                <h3>{rule.title}</h3>
                <p>{rule.content}</p>
                <ul className="meta">
                  <li>
                    <StatusBadge status={rule.status} />
                  </li>
                  <li>Provenance: {rule.provenance}</li>
                  <li>Approved {formatTimestamp(rule.approvedAt)}</li>
                </ul>
                {rule.status === "ACTIVE" ? <RetireRuleButton ruleId={rule.id} /> : null}
              </article>
            ))
          : null}
      </Panel>

      <Panel title="Project knowledge">
        {knowledge.status === "error" ? <ErrorState message={knowledge.message} /> : null}
        {knowledge.status === "ok" && knowledge.data.length === 0 ? (
          <EmptyState>No project knowledge is stored.</EmptyState>
        ) : null}
        {knowledge.status === "ok"
          ? knowledge.data.map((item) => (
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
            ))
          : null}
      </Panel>

      <Panel title="Memory proposals">
        <p className="quiet">
          Pending items stay proposals until you approve, reject, or keep them on the project.
          Founder-authored proposals are labeled as such. Ghost is not inferring them.
        </p>
        {proposals.status === "error" ? <ErrorState message={proposals.message} /> : null}
        {proposals.status === "ok" && pending.length === 0 ? (
          <EmptyState>No pending memory proposals.</EmptyState>
        ) : null}
        {pending.map((proposal) => (
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
              <li>Provenance: {proposal.provenance}</li>
            </ul>
            <ProposalActions
              proposalId={proposal.id}
              scope={proposal.scope}
              projectId={proposal.projectId}
            />
          </article>
        ))}
        {reviewed.length > 0 ? (
          <div className="stack">
            <h3>Reviewed</h3>
            {reviewed.map((proposal) => (
              <article className="list-item" key={proposal.id}>
                <h3>{proposal.title}</h3>
                <ul className="meta">
                  <li>
                    <StatusBadge status={proposal.status} />
                  </li>
                  <li>Created {formatTimestamp(proposal.createdAt)}</li>
                </ul>
              </article>
            ))}
          </div>
        ) : null}
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
