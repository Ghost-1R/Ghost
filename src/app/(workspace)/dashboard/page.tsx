import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AskGhost } from "@/app/(workspace)/dashboard/ask-ghost";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/lib/auth/session";
import { loadDecisionQueue, loadFounderRules, loadMemoryProposals, loadProjectKnowledge } from "@/lib/memory/queries";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const [projects, decisions, rules, knowledge, proposals] = await Promise.all([
    loadProjectSummaries(session.supabase),
    loadDecisionQueue(session.supabase),
    loadFounderRules(session.supabase),
    loadProjectKnowledge(session.supabase),
    loadMemoryProposals(session.supabase),
  ]);

  const pendingCount =
    proposals.status === "ok" ? proposals.data.filter((item) => item.status === "PENDING").length : null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Continue from the real state.</h1>
        </div>
        <Link className="button" href="/projects/new">
          New project
        </Link>
      </div>

      <Panel title="Ask Ghost">
        <AskGhost />
      </Panel>

      <Panel title="Continue building" action={<Link href="/projects">All projects</Link>}>
        {projects.status === "error" ? <ErrorState message={projects.message} /> : null}
        {projects.status === "ok" && projects.data.length === 0 ? (
          <EmptyState>No projects yet. Create your first project.</EmptyState>
        ) : null}
        {projects.status === "ok" && projects.data.length > 0 ? (
          <div className="card-grid">
            {projects.data.map((project) => (
              <article className="card" key={project.id}>
                <h3>
                  <Link href={`/projects/${project.id}`}>{project.name}</Link>
                </h3>
                <p className="quiet">{project.currentMilestone || "No milestone recorded."}</p>
                <ul className="meta">
                  <li>
                    <StatusBadge status={project.status} />
                  </li>
                  <li>{project.openBlockers} open blockers</li>
                  <li>{project.nextAction ?? "No open next action."}</li>
                </ul>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="split">
        <Panel title="Needs your decision">
          {decisions.status === "error" ? <ErrorState message={decisions.message} /> : null}
          {decisions.status === "ok" && decisions.data.length === 0 ? (
            <EmptyState>Nothing is waiting on a decision.</EmptyState>
          ) : null}
          {decisions.status === "ok" && decisions.data.length > 0 ? (
            <div className="stack">
              {decisions.data.map((item) => (
                <article className="list-item" key={`${item.kind}-${item.id}`}>
                  <h3>
                    <Link href={item.href}>{item.title}</Link>
                  </h3>
                  <p className="quiet">{item.detail}</p>
                </article>
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel title="Ghost memory" action={<Link href="/memory">Open memory</Link>}>
          <ul className="meta">
            <li>
              Founder rules: {rules.status === "ok" ? rules.data.filter((rule) => rule.status === "ACTIVE").length : "unavailable"}
            </li>
            <li>Project knowledge: {knowledge.status === "ok" ? knowledge.data.length : "unavailable"}</li>
            <li>Pending proposals: {pendingCount === null ? "unavailable" : pendingCount}</li>
          </ul>
          {rules.status === "error" ? <ErrorState message={rules.message} /> : null}
          {knowledge.status === "error" ? <ErrorState message={knowledge.message} /> : null}
          {proposals.status === "error" ? <ErrorState message={proposals.message} /> : null}
        </Panel>
      </div>

      <Panel title="Recent activity">
        <EmptyState>No activity log exists yet. Ghost does not invent a timeline.</EmptyState>
      </Panel>
    </div>
  );
}
