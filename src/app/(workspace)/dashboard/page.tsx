import type { Metadata } from "next";
import Link from "next/link";
import path from "node:path";
import { redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { DashboardHero } from "@/components/ghost/hero";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { describeProviderPolicy, isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { loadLatestConversation } from "@/lib/conversation/queries";
import { loadOpenDecisions } from "@/lib/decisions/queries";
import { formatTimestamp } from "@/lib/format";
import { loadFounderRules, loadMemoryProposals, loadProjectKnowledge } from "@/lib/memory/queries";
import { loadRecentActivity } from "@/lib/operations/activity";
import { loadTodayActions } from "@/lib/operations/actions";
import { explainTodayPriority } from "@/lib/operations/today";
import { loadPatterns } from "@/lib/patterns/library";
import { loadPresentationStatus } from "@/lib/presentation/status";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Dashboard",
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function githubConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || process.env.GITHUB_PAT?.trim(),
  );
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim());
}

export default async function DashboardPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const summaries = loadProjectSummaries(session.supabase);
  const provider = describeProviderPolicy();
  const [
    projects,
    rules,
    knowledge,
    proposals,
    conversation,
    patterns,
    presentation,
    today,
    openDecisions,
    activity,
  ] = await Promise.all([
    summaries,
    loadFounderRules(session.supabase),
    loadProjectKnowledge(session.supabase),
    loadMemoryProposals(session.supabase),
    loadLatestConversation(session.supabase, null),
    loadPatterns(path.join(process.cwd(), "ghost-patterns")).catch(() => null),
    loadPresentationStatus(session.supabase, session.user.id, summaries),
    loadTodayActions(session.supabase),
    loadOpenDecisions(session.supabase),
    loadRecentActivity(session.supabase),
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

      <Panel title="Today with Ghost">
        {today.status === "error" ? <ErrorState message={today.message} /> : null}
        {today.status === "ok" && today.data.length === 0 ? (
          <EmptyState>Nothing needs your attention right now. Ghost does not invent tasks to fill this list.</EmptyState>
        ) : null}
        {today.status === "ok" && today.data.length > 0 ? (
          <div className="stack">
            {today.data.map((item) => (
              <article className="list-item" key={item.id}>
                <h3>
                  <Link href={`/projects/${item.projectId}`}>{item.title}</Link>
                </h3>
                <p className="quiet">
                  {item.projectName} · {item.status}
                  {item.requiresDecision ? " · decision required" : ""} · {item.provenance}
                </p>
                <p className="quiet">{explainTodayPriority(item)}</p>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel title="Needs your decision">
        {openDecisions.status === "error" ? <ErrorState message={openDecisions.message} /> : null}
        {openDecisions.status === "ok" && openDecisions.data.length === 0 ? (
          <EmptyState>No founder decisions are waiting.</EmptyState>
        ) : null}
        {openDecisions.status === "ok" && openDecisions.data.length > 0 ? (
          <div className="stack">
            {openDecisions.data.map((decision) => (
              <article className="list-item" key={decision.id}>
                <h3>
                  <Link href={`/projects/${decision.projectId}`}>{decision.title}</Link>
                </h3>
                <p className="quiet">{decision.question}</p>
                {decision.recommendation ? <p className="quiet">Ghost recommends: {decision.recommendation}</p> : null}
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel title="Your projects" action={<Link href="/projects">All projects</Link>}>
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
                <p className="quiet">
                  Lifecycle: {project.lifecycleStage} · {project.currentMilestone || "No milestone recorded."}
                </p>
                <ul className="meta">
                  <li>
                    <StatusBadge status={project.status} />
                  </li>
                  <li>
                    {project.openBlockers === 0
                      ? "No open blockers"
                      : `${project.openBlockers} open blocker${project.openBlockers === 1 ? "" : "s"}`}
                  </li>
                  <li>Next: {project.nextAction ?? "No open next action recorded."}</li>
                </ul>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel title="Build progress">
        {projects.status === "ok" && projects.data.length > 0 ? (
          <div className="stack">
            {projects.data.map((project) => (
              <article className="list-item" key={`progress-${project.id}`}>
                <h3>
                  <Link href={`/projects/${project.id}`}>{project.name}</Link>
                </h3>
                <p className="quiet">
                  Stage {project.lifecycleStage}
                  {project.currentMilestone ? ` · ${project.currentMilestone}` : ""}
                </p>
                <p className="quiet">Ghost does not invent completion percentages.</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState>No project lifecycle is recorded yet.</EmptyState>
        )}
      </Panel>

      <Panel title="Latest activity">
        {activity.status === "error" ? <ErrorState message={activity.message} /> : null}
        {activity.status === "ok" && activity.data.length === 0 ? (
          <EmptyState>No operational activity is recorded yet.</EmptyState>
        ) : null}
        {activity.status === "ok" && activity.data.length > 0 ? (
          <div className="stack">
            {activity.data.map((item) => (
              <article className="list-item" key={item.id}>
                <h3>
                  <Link href={item.href}>{item.title}</Link>
                </h3>
                <p className="quiet">
                  {item.projectName} · {formatTimestamp(item.at)}
                </p>
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
                <li>Checked {formatTimestamp(review.createdAt)}</li>
              </ul>
            </>
          ) : (
            <h3>No presentation review recorded</h3>
          )}
          <Link className="system-link" href="/presentation">
            Open presentation
          </Link>
        </article>
        <article className="system-card">
          <p className="eyebrow">Integrations</p>
          <h3>Connected systems Ghost can prove</h3>
          <ul className="meta">
            <li>Supabase: {supabaseConfigured() ? "connected" : "not configured"}</li>
            <li>
              Groq: {provider.status === "READY" ? `ready · ${provider.model}` : "not configured"}
            </li>
            <li>GitHub: {githubConfigured() ? "configured (read-only)" : "NOT CONFIGURED"}</li>
            <li>Render: Ghost deployment platform</li>
            <li>Vercel: not used for Ghost</li>
            <li>Paid fallback: {provider.paidFallback}</li>
          </ul>
          <Link className="system-link" href="/settings">
            Open settings
          </Link>
        </article>
      </section>
    </div>
  );
}
