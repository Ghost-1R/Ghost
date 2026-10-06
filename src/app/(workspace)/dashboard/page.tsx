import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { DashboardHero } from "@/components/ghost/hero";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { loadLatestConversation } from "@/lib/conversation/queries";
import {
  buildOperatingMetrics,
  countOpenDecisionsForProject,
  mapLifecycleToPipelineStage,
  OS_PIPELINE_STAGES,
  pickActiveProject,
} from "@/lib/dashboard/os";
import { loadActiveProductCounts, loadDashboardGroundedCounts } from "@/lib/dashboard/queries";
import { resolveFounderDecision } from "@/lib/decisions/actions";
import { loadOpenDecisions } from "@/lib/decisions/queries";
import { formatTimestamp } from "@/lib/format";
import { loadRecentActivity } from "@/lib/operations/activity";
import { loadTodayActions } from "@/lib/operations/actions";
import { explainTodayPriority } from "@/lib/operations/today";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const [
    projects,
    conversation,
    today,
    openDecisions,
    activity,
  ] = await Promise.all([
    loadProjectSummaries(session.supabase),
    loadLatestConversation(session.supabase, null),
    loadTodayActions(session.supabase),
    loadOpenDecisions(session.supabase),
    loadRecentActivity(session.supabase, 8),
  ]);

  const projectList = projects.status === "ok" ? projects.data : [];
  const decisionList = openDecisions.status === "ok" ? openDecisions.data : [];
  const todayList = today.status === "ok" ? today.data : [];
  const activityList = activity.status === "ok" ? activity.data.slice(0, 6) : [];
  const active = pickActiveProject(projectList);
  const activeStageId = active ? mapLifecycleToPipelineStage(active.lifecycleStage) : null;

  const grounded =
    projects.status === "ok"
      ? await loadDashboardGroundedCounts(
          session.supabase,
          projectList.map((project) => project.id),
        )
      : null;
  const productCounts = active
    ? await loadActiveProductCounts(session.supabase, active.id)
    : null;

  const openBlockerCount = projectList.reduce((sum, project) => sum + project.openBlockers, 0);
  const metrics = buildOperatingMetrics({
    projectCount: projectList.length,
    openDecisionCount: decisionList.length,
    openBlockerCount,
    verifiedItemCount: grounded?.status === "ok" ? grounded.data.verifiedItemCount : null,
    productionProjectCount: grounded?.status === "ok" ? grounded.data.productionProjectCount : null,
  });

  const activeDecisionCount = active ? countOpenDecisionsForProject(decisionList, active.id) : 0;
  const requirementCount =
    productCounts?.status === "ok" ? productCounts.data.requirementCount : null;
  const featureCount = productCounts?.status === "ok" ? productCounts.data.featureCount : null;

  return (
    <div className="stack os-dashboard">
      <div className="os-hero-row">
        <DashboardHero activeStageId={activeStageId} />
        <section className="os-active-card" aria-label="Active project">
          <p className="eyebrow">Active Project</p>
          {active ? (
            <>
              <h2>{active.name}</h2>
              <p className="quiet">{active.description || "No description recorded."}</p>
              <ul className="meta os-active-meta">
                <li>
                  <StatusBadge status={active.status} />
                </li>
                <li className="os-chip">{active.lifecycleStage}</li>
                {active.openBlockers > 0 ? (
                  <li className="os-chip os-chip-warn">{active.openBlockers} blocker{active.openBlockers === 1 ? "" : "s"}</li>
                ) : null}
                {activeDecisionCount > 0 ? (
                  <li className="os-chip os-chip-purple">{activeDecisionCount} decision{activeDecisionCount === 1 ? "" : "s"} open</li>
                ) : null}
              </ul>
              <ul className="meta">
                {requirementCount !== null ? <li>Requirements: {requirementCount}</li> : null}
                {featureCount !== null ? <li>Features: {featureCount}</li> : null}
                <li>Open Decisions: {activeDecisionCount}</li>
              </ul>
              {active.nextAction ? <p className="os-next-line">Next: {active.nextAction}</p> : null}
              <Link className="button" href={`/projects/${active.id}`}>
                Open Project →
              </Link>
            </>
          ) : (
            <>
              <h2>No active project</h2>
              <p className="quiet">Create a project to give Ghost something to operate.</p>
              <Link className="button" href="/projects/new">
                New Project
              </Link>
            </>
          )}
        </section>
      </div>

      <section className="os-metrics" aria-label="Operating summary">
        {metrics.map((metric) => (
          <article className="os-metric" key={metric.key}>
            <p className="eyebrow">{metric.label}</p>
            <p className="os-metric-value">{metric.value}</p>
          </article>
        ))}
      </section>

      <section className="os-panel" aria-labelledby="pipeline-heading">
        <div className="os-panel-head">
          <div>
            <p className="eyebrow">Project Pipeline</p>
            <h2 id="pipeline-heading">Where your product is in the Ghost operating system.</h2>
          </div>
        </div>
        <ol className="os-pipeline-horizontal">
          {OS_PIPELINE_STAGES.map((stage) => (
            <li key={stage.id} data-active={activeStageId === stage.id ? "true" : "false"}>
              <strong>{stage.label}</strong>
              <span>{stage.subtitle}</span>
            </li>
          ))}
        </ol>
        <p className="quiet os-pipeline-note">
          Current stage only is highlighted from authoritative lifecycle. Ghost does not invent prior-stage completion.
        </p>
      </section>

      <div className="os-attention-grid">
        <section className="os-panel" aria-labelledby="today-heading">
          <div className="os-panel-head">
            <div>
              <p className="eyebrow">Today with Ghost</p>
              <h2 id="today-heading">What deserves your attention now.</h2>
            </div>
          </div>
          {today.status === "error" ? <ErrorState message={today.message} /> : null}
          {today.status === "ok" && todayList.length === 0 ? (
            <EmptyState>Nothing needs your attention right now. Ghost does not invent tasks to fill this list.</EmptyState>
          ) : null}
          {todayList.length > 0 ? (
            <div className="stack">
              {todayList.slice(0, 5).map((item) => (
                <article className="os-row" key={item.id}>
                  <div>
                    <h3>
                      <Link href={`/projects/${item.projectId}`}>{item.title}</Link>
                    </h3>
                    <p className="quiet">
                      {item.projectName} · {item.status}
                      {item.requiresDecision ? " · decision required" : ""}
                    </p>
                    <p className="quiet">{explainTodayPriority(item)}</p>
                  </div>
                  <Link className="button-secondary os-row-action" href={`/projects/${item.projectId}`}>
                    Open →
                  </Link>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section className="os-panel os-panel-decision" aria-labelledby="decisions-heading">
          <div className="os-panel-head">
            <div>
              <p className="eyebrow">Needs Your Decision</p>
              <h2 id="decisions-heading">Choices Ghost will not make for you.</h2>
            </div>
          </div>
          {openDecisions.status === "error" ? <ErrorState message={openDecisions.message} /> : null}
          {openDecisions.status === "ok" && decisionList.length === 0 ? (
            <EmptyState>No founder decisions are waiting.</EmptyState>
          ) : null}
          {decisionList.length > 0 ? (
            <div className="stack">
              {decisionList.slice(0, 6).map((decision) => {
                const href = decision.projectId
                  ? `/projects/${decision.projectId}`
                  : decision.ideaId
                    ? `/ideas/${decision.ideaId}`
                    : "/dashboard";
                const projectName =
                  projectList.find((project) => project.id === decision.projectId)?.name ??
                  (decision.ideaId ? "Idea Lab" : "Ghost");
                return (
                  <article className="os-row" key={decision.id}>
                    <div>
                      <p className="os-row-project">{projectName}</p>
                      <h3>
                        <Link href={href}>{decision.title}</Link>
                      </h3>
                      <p className="quiet">{decision.question}</p>
                      {decision.recommendation ? (
                        <p className="quiet">Ghost recommends: {decision.recommendation}</p>
                      ) : null}
                      <ActionForm action={resolveFounderDecision} submitLabel="Resolve">
                        <input type="hidden" name="decisionId" value={decision.id} />
                        <input type="hidden" name="projectId" value={decision.projectId ?? ""} />
                        <input type="hidden" name="status" value="RESOLVED" />
                        <label className="field">
                          <span>Your choice</span>
                          <input name="selectedOption" required maxLength={200} placeholder="Selected option or answer" />
                        </label>
                      </ActionForm>
                    </div>
                    <Link className="button-secondary os-row-action" href={href}>
                      Review →
                    </Link>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>

      <div className="os-lower-grid">
        <section className="os-panel" aria-labelledby="activity-heading">
          <div className="os-panel-head">
            <div>
              <p className="eyebrow">Recent Activity</p>
              <h2 id="activity-heading">What actually changed.</h2>
            </div>
          </div>
          {activity.status === "error" ? <ErrorState message={activity.message} /> : null}
          {activity.status === "ok" && activityList.length === 0 ? (
            <EmptyState>No operational activity is recorded yet.</EmptyState>
          ) : null}
          {activityList.length > 0 ? (
            <div className="stack">
              {activityList.map((item) => (
                <article className="os-row" key={item.id}>
                  <div>
                    <h3>
                      <Link href={item.href}>{item.title}</Link>
                    </h3>
                    <p className="quiet">
                      {item.projectName} · {formatTimestamp(item.at)}
                    </p>
                    <p className="quiet">{item.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section className="os-panel" aria-labelledby="projects-heading">
          <div className="os-panel-head">
            <div>
              <p className="eyebrow">Your Projects</p>
              <h2 id="projects-heading">The work Ghost is tracking.</h2>
            </div>
            <Link href="/projects">All projects</Link>
          </div>
          {projects.status === "error" ? <ErrorState message={projects.message} /> : null}
          {projects.status === "ok" && projectList.length === 0 ? (
            <EmptyState>No projects yet. Create your first project.</EmptyState>
          ) : null}
          {projectList.length > 0 ? (
            <div className="os-project-grid">
              {projectList.map((project) => {
                const decisions = countOpenDecisionsForProject(decisionList, project.id);
                return (
                  <article className="os-project-card" key={project.id} data-active={active?.id === project.id ? "true" : "false"}>
                    <p className="eyebrow">{project.lifecycleStage}</p>
                    <h3>
                      <Link href={`/projects/${project.id}`}>{project.name}</Link>
                    </h3>
                    <p className="quiet">{project.description || "No description recorded."}</p>
                    <ul className="meta">
                      <li>
                        <StatusBadge status={project.status} />
                      </li>
                      <li>
                        {project.openBlockers} blocker{project.openBlockers === 1 ? "" : "s"}
                      </li>
                      <li>
                        {decisions} decision{decisions === 1 ? "" : "s"}
                      </li>
                    </ul>
                    {project.nextAction ? <p className="quiet">Next: {project.nextAction}</p> : null}
                    <Link className="button-secondary" href={`/projects/${project.id}`}>
                      Open Project
                    </Link>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>

      <section className="os-panel os-ask-panel" id="ask-ghost" aria-labelledby="ask-heading">
        <div className="os-panel-head">
          <div>
            <p className="eyebrow">Ask Ghost</p>
            <h2 id="ask-heading">Ask about projects, blockers, decisions, bugs, or what to do next.</h2>
          </div>
        </div>
        <p className="quiet">
          Try: “Checkout is broken — what do we know?” · “Why are orders stuck?” · “What should I test first?”
        </p>
        {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
        <GhostConversation
          projectId={active?.id ?? null}
          projectName={active?.name ?? null}
          conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
          messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
          providerConfigured={isModelConfigured()}
          variant="command"
        />
      </section>
    </div>
  );
}
