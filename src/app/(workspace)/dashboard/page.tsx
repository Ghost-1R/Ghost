import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState } from "@/components/ui/panel";
import { isModelConfigured } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { loadLatestConversation } from "@/lib/conversation/queries";
import {
  buildRedLights,
  buildWaitingOnMe,
  deriveProjectHealth,
  healthGlyph,
  healthLabel,
  moneyStatusPhase1,
  rankTop3Actions,
  whoMightCallSection,
  type CeoSignal,
} from "@/lib/dashboard/ceo";
import { ProjectTruthPanel } from "@/components/operations/project-truth-panel";
import { loadCeoSignals } from "@/lib/dashboard/ceo-queries";
import { resolveFounderDecision } from "@/lib/decisions/actions";
import { loadOpenDecisions } from "@/lib/decisions/queries";
import { loadTodayActions } from "@/lib/operations/actions";
import { loadRecentActivity } from "@/lib/operations/activity";
import {
  loadAgentTaskSurface,
  projectAgentTasksToActivity,
  projectAgentTasksToTodayActions,
} from "@/lib/operations/agent-task-surface";
import { prioritizeTodayActions } from "@/lib/operations/today";
import { loadProjectTruthSnapshot } from "@/lib/project-truth";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Home",
};

/** Prefer a real display name; otherwise a neutral greeting (never an email handle). */
function companionGreeting(displayName: string | null | undefined): string {
  const name = displayName?.trim() ?? "";
  if (name.length >= 2 && !name.includes("@") && !/^ghost[-_]/i.test(name)) {
    return `Welcome back, ${name}.`;
  }
  return "Welcome back.";
}

export default async function DashboardPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const profile = await session.supabase
    .from("profiles")
    .select("display_name")
    .eq("id", session.user.id)
    .maybeSingle();
  const greeting = companionGreeting(profile.data?.display_name);

  const [projects, conversation, today, openDecisions, agentTaskSurface] = await Promise.all([
    loadProjectSummaries(session.supabase),
    loadLatestConversation(session.supabase, null),
    loadTodayActions(session.supabase),
    loadOpenDecisions(session.supabase),
    loadAgentTaskSurface(session.supabase, { limit: 12 }),
  ]);

  const projectList = projects.status === "ok" ? projects.data : [];
  const decisionList = openDecisions.status === "ok" ? openDecisions.data : [];
  const agentTaskRows = agentTaskSurface.status === "ok" ? agentTaskSurface.data : [];
  const todayList = prioritizeTodayActions([
    ...(today.status === "ok" ? today.data : []),
    ...projectAgentTasksToTodayActions(agentTaskRows),
  ]);

  const signalBundle =
    projects.status === "ok"
      ? await loadCeoSignals(
          session.supabase,
          projectList.map((project) => ({ id: project.id, name: project.name })),
        )
      : null;

  const signals: CeoSignal[] = signalBundle?.status === "ok" ? signalBundle.data.signals : [];
  const verifiedIds =
    signalBundle?.status === "ok" ? signalBundle.data.verifiedProjectIds : new Set<string>();
  const presentationReviews =
    signalBundle?.status === "ok" ? signalBundle.data.presentationReviews : [];

  const decisionsForCeo = decisionList.map((decision) => ({
    id: decision.id,
    projectId: decision.projectId,
    projectName:
      projectList.find((project) => project.id === decision.projectId)?.name ??
      (decision.ideaId ? "Idea Lab" : "Workspace"),
    title: decision.title,
    question: decision.question,
    createdAt: decision.createdAt,
  }));

  const top3 = rankTop3Actions({
    today: todayList,
    signals,
    decisions: decisionsForCeo,
  });

  const waiting = buildWaitingOnMe({
    decisions: decisionsForCeo,
    requiresDecisionActions: todayList.filter((action) => action.requiresDecision),
    presentationReviews,
  });

  const whoMightCall = whoMightCallSection(signals);
  const redLights = buildRedLights(signals);
  const money = moneyStatusPhase1();

  const projectRows = projectList.map((project) => {
    const projectSignals = signals.filter((signal) => signal.projectId === project.id);
    const critical = projectSignals.filter((signal) => signal.severity === "critical");
    const yellow = projectSignals.filter((signal) => signal.severity === "high");
    const openDecisionCount = decisionList.filter((decision) => decision.projectId === project.id).length;
    const health = deriveProjectHealth({
      openBlockerCount: project.openBlockers,
      criticalSignals: critical,
      yellowSignals: yellow,
      hasVerifiedEvidence: verifiedIds.has(project.id),
      openDecisionCount,
      nextAction: project.nextAction,
      projectName: project.name,
    });
    return {
      projectId: project.id,
      projectName: project.name,
      description: project.description,
      health,
      nextAction: health.nextAction,
      href: `/projects/${project.id}`,
    };
  });

  const activeProject =
    projectRows.find((row) => row.health.status === "RED") ??
    projectRows.find((row) => row.health.status === "YELLOW") ??
    projectRows[0] ??
    null;

  const [activeTruth, recentActivity] = await Promise.all([
    activeProject
      ? loadProjectTruthSnapshot(session.supabase, {
          projectId: activeProject.projectId,
          projectName: activeProject.projectName,
          hasFreshInspectorPass: null,
        })
      : Promise.resolve(null),
    loadRecentActivity(session.supabase, 8),
  ]);

  const activityItems = [
    ...(recentActivity.status === "ok" ? recentActivity.data : []),
    ...projectAgentTasksToActivity(agentTaskRows),
  ]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 12);

  return (
    <div className="ghost-home">
      <header className="ghost-home-hero">
        <p className="ghost-brand">GHOST</p>
        <h1>{greeting}</h1>
        <p className="ghost-home-lede">Your second mind — ask, decide, and keep building.</p>
      </header>

      <section className="ghost-home-ask" id="ask-ghost" aria-labelledby="ask-heading">
        <div className="ghost-home-section-head">
          <h2 id="ask-heading">Ask Ghost</h2>
          <p className="quiet">
            Grounded in Project Brain. Consequential actions stay gated until you approve them.
          </p>
        </div>
        {conversation.status === "error" ? (
          <ErrorState message="Conversation could not be loaded right now. Your projects and decisions below are still available." />
        ) : null}
        <GhostConversation
          projectId={null}
          projectName={null}
          conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
          messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
          providerConfigured={isModelConfigured()}
          variant="command"
        />
      </section>

      <div className="ghost-home-triad">
        <section className="ghost-home-rail" aria-labelledby="truth-heading">
          <h2 id="truth-heading">What is true</h2>
          {redLights.length === 0 ? (
            <EmptyState>No known shipping blockers from connected evidence.</EmptyState>
          ) : (
            <ul className="ghost-home-rail-list">
              {redLights.slice(0, 4).map((light) => (
                <li key={light.id}>
                  <p className="ceo-project-label">{light.projectName}</p>
                  <p>{light.reason}</p>
                  <Link href={light.href}>{light.ctaLabel}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="ghost-home-rail ghost-home-rail-decision"
          aria-labelledby="decision-heading"
          id="waiting-on-me"
        >
          <h2 id="decision-heading">Needs a decision</h2>
          <p className="quiet">
            Judgment and executable authorizations are separate.{" "}
            <Link href="/approvals">Open Approval Center</Link>
          </p>
          {openDecisions.status === "error" ? (
            <ErrorState message="Open decisions could not be loaded. Try again shortly." />
          ) : null}
          {waiting.length === 0 ? (
            <EmptyState>Nothing is waiting on you.</EmptyState>
          ) : (
            <ul className="ghost-home-rail-list">
              {waiting.slice(0, 4).map((item) => (
                <li key={item.id}>
                  <p className="ceo-project-label">{item.projectName}</p>
                  <p>{item.what}</p>
                  <p className="quiet">{item.reason}</p>
                  {item.id.startsWith("dec-") ? (
                    <ActionForm action={resolveFounderDecision} submitLabel="Resolve">
                      <input type="hidden" name="decisionId" value={item.id.replace(/^dec-/, "")} />
                      <input type="hidden" name="projectId" value={item.projectId ?? ""} />
                      <input type="hidden" name="status" value="RESOLVED" />
                      <label className="field">
                        <span>Your choice</span>
                        <input name="selectedOption" required maxLength={200} placeholder="Selected option or answer" />
                      </label>
                    </ActionForm>
                  ) : (
                    <Link href={item.href}>{item.actionLabel}</Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ghost-home-rail" aria-labelledby="next-heading">
          <h2 id="next-heading">What happens next</h2>
          {top3.length === 0 ? (
            <EmptyState>Nothing urgent is recorded. Ghost does not invent work.</EmptyState>
          ) : (
            <ol className="ghost-home-rail-list ghost-home-next-list">
              {top3.map((item, index) => (
                <li key={item.id} data-status={item.status}>
                  <span className="ceo-rank" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <p className="ceo-project-label">{item.projectName}</p>
                    <p>{item.headline}</p>
                    <p className="ceo-next">Next: {item.nextAction}</p>
                    <Link href={item.href}>{item.ctaLabel}</Link>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {activeProject ? (
        <section className="ghost-home-active" aria-labelledby="active-project-heading">
          <div className="ghost-home-section-head ghost-home-section-head-row">
            <div>
              <p className="eyebrow">Active project</p>
              <h2 id="active-project-heading">{activeProject.projectName}</h2>
            </div>
            <Link className="button" href={activeProject.href}>
              Open Project Brain
            </Link>
          </div>
          <div className="ghost-home-active-body">
            <span
              className={`ceo-status ceo-status-${activeProject.health.status.toLowerCase()}`}
              title={healthLabel(activeProject.health.status)}
            >
              <span className="ceo-status-dot" aria-hidden="true" />
              <span aria-hidden="true">{healthGlyph(activeProject.health.status)}</span>
              <span className="ceo-status-text">{healthLabel(activeProject.health.status)}</span>
            </span>
            <p className="quiet">{activeProject.health.reason}</p>
            {activeProject.nextAction ? <p className="ceo-next">Next: {activeProject.nextAction}</p> : null}
          </div>
          {activeTruth?.status === "ok" ? (
            <ProjectTruthPanel
              snapshot={activeTruth.data}
              title="Operational truth"
              deployHref={`/projects/${activeProject.projectId}/deploy`}
            />
          ) : activeTruth?.status === "error" ? (
            <ErrorState message="Project Truth could not be loaded from recorded evidence." />
          ) : null}
        </section>
      ) : (
        <section className="ghost-home-active" aria-labelledby="active-project-heading">
          <div className="ghost-home-section-head ghost-home-section-head-row">
            <div>
              <p className="eyebrow">Active project</p>
              <h2 id="active-project-heading">No project yet</h2>
            </div>
            <Link className="button" href="/projects/new">
              Start a project
            </Link>
          </div>
          <EmptyState>Create a project so Ghost has a home for truth, decisions, and next steps.</EmptyState>
        </section>
      )}

      {projectRows.length > 1 ? (
        <section className="ghost-home-projects" aria-labelledby="projects-heading">
          <div className="ghost-home-section-head ghost-home-section-head-row">
            <h2 id="projects-heading">Projects</h2>
            <Link href="/projects">All projects</Link>
          </div>
          <ul className="ghost-home-project-rows">
            {projectRows.map((row) => (
              <li key={row.projectId} data-status={row.health.status}>
                <span className={`ceo-status ceo-status-${row.health.status.toLowerCase()}`}>
                  <span className="ceo-status-dot" aria-hidden="true" />
                  <span className="ceo-status-text">{healthLabel(row.health.status)}</span>
                </span>
                <div>
                  <h3>
                    <Link href={row.href}>{row.projectName}</Link>
                  </h3>
                  {row.nextAction ? <p className="ceo-next">Next: {row.nextAction}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {projects.status === "error" ? <ErrorState message="Projects could not be loaded right now." /> : null}

      <details className="ghost-home-more">
        <summary>More context</summary>
        <div className="ghost-home-more-grid">
          <section aria-labelledby="activity-heading">
            <h3 id="activity-heading">What changed</h3>
            {recentActivity.status === "error" && activityItems.length === 0 ? (
              <ErrorState message="Recent activity could not be loaded." />
            ) : activityItems.length === 0 ? (
              <EmptyState>No recent recorded activity.</EmptyState>
            ) : (
              <ul className="ghost-home-rail-list">
                {activityItems.map((item) => (
                  <li key={item.id}>
                    <p className="ceo-project-label">{item.projectName}</p>
                    <p>{item.title}</p>
                    <p className="quiet">{item.detail}</p>
                    <Link href={item.href}>Open</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="call-heading">
            <h3 id="call-heading">Who might call</h3>
            <p className="quiet">{whoMightCall.notice}</p>
            {whoMightCall.exceptions.length === 0 ? (
              <EmptyState>No current client-facing exceptions from connected signals.</EmptyState>
            ) : (
              <ul className="ghost-home-rail-list">
                {whoMightCall.exceptions.map((item) => (
                  <li key={item.id}>
                    <p className="ceo-project-label">{item.projectName}</p>
                    <p>{item.reason}</p>
                    <Link href={item.href}>Open project</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="money-heading">
            <h3 id="money-heading">{money.label}</h3>
            <p className="quiet">{money.detail}</p>
          </section>
        </div>
      </details>
    </div>
  );
}
