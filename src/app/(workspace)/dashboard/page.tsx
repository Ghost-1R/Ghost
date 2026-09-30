import type { Metadata } from "next";
import Link from "next/link";
import path from "node:path";
import { redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { DashboardHero } from "@/components/ghost/hero";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { loadLatestConversation } from "@/lib/conversation/queries";
import { loadDecisionQueue, loadFounderRules, loadMemoryProposals, loadProjectKnowledge } from "@/lib/memory/queries";
import { loadPatterns } from "@/lib/patterns/library";
import { loadPresentationStatus } from "@/lib/presentation/status";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Dashboard",
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function checkedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : `${date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
}

export default async function DashboardPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const summaries = loadProjectSummaries(session.supabase);
  const [projects, decisions, rules, knowledge, proposals, conversation, patterns, presentation] = await Promise.all([
    summaries,
    loadDecisionQueue(session.supabase),
    loadFounderRules(session.supabase),
    loadProjectKnowledge(session.supabase),
    loadMemoryProposals(session.supabase),
    loadLatestConversation(session.supabase, null),
    loadPatterns(path.join(process.cwd(), "ghost-patterns")).catch(() => null),
    loadPresentationStatus(session.supabase, session.user.id, summaries),
  ]);

  const activeRules = rules.status === "ok" ? rules.data.filter((rule) => rule.status === "ACTIVE").length : null;
  const pendingCount =
    proposals.status === "ok" ? proposals.data.filter((item) => item.status === "PENDING").length : null;
  const drafts = patterns ? patterns.filter((pattern) => pattern.status === "DRAFT").length : null;
  const review = presentation.review;

  return (
    <div className="stack dashboard">
      <DashboardHero />

      {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
      <GhostConversation
        projectId={null}
        projectName={null}
        conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
        messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
        providerConfigured={isModelConfigured()}
        variant="command"
      />

      <div className="page-head section-head">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>Continue from the real state.</h2>
        </div>
        <Link className="button" href="/projects/new">
          New project
        </Link>
      </div>

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

      <section className="systems" aria-label="Ghost systems">
        <article className="system-card">
          <p className="eyebrow">Memory</p>
          <h3>{activeRules === null ? "Founder rules unavailable" : plural(activeRules, "active founder rule", "active founder rules")}</h3>
          <ul className="meta">
            <li>Project knowledge: {knowledge.status === "ok" ? knowledge.data.length : "unavailable"}</li>
            <li>Pending proposals: {pendingCount === null ? "unavailable" : pendingCount}</li>
          </ul>
          <Link className="system-link" href="/memory">
            Open memory
          </Link>
        </article>
        <article className="system-card">
          <p className="eyebrow">Patterns</p>
          <h3>{patterns ? plural(patterns.length, "stored pattern", "stored patterns") : "Patterns unavailable"}</h3>
          <ul className="meta">
            <li>{drafts === null ? "Draft count unavailable" : `${plural(drafts, "draft", "drafts")} awaiting approval`}</li>
          </ul>
          <Link className="system-link" href="/patterns">
            Open patterns
          </Link>
        </article>
        <article className="system-card">
          <p className="eyebrow">Latest review</p>
          {review ? (
            <>
              <h3>
                <StatusBadge status={review.result} />{" "}
                {presentation.fresh
                  ? presentation.hosted
                    ? "Fresh for this deployment"
                    : "Fresh for this tree"
                  : presentation.hosted
                    ? "For an earlier deployment"
                    : "For an earlier tree"}
              </h3>
              <ul className="meta">
                <li>Commit {review.commitSha.slice(0, 7)}</li>
                <li>Checked {checkedAt(review.createdAt)}</li>
              </ul>
            </>
          ) : (
            <h3>No presentation review recorded</h3>
          )}
          <Link className="system-link" href="/presentation">
            Open presentation
          </Link>
        </article>
      </section>

      <Panel title="Recent activity">
        <EmptyState>No activity log exists yet. Ghost does not invent a timeline.</EmptyState>
      </Panel>
    </div>
  );
}
