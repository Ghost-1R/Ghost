import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GhostConversation } from "@/components/ghost/conversation";
import { TodayDayBoard } from "@/components/today/day-board";
import { FounderDate } from "@/components/today/founder-date";
import { SoftNavLink, StaggerBoard, StaggerCard } from "@/components/today/motion";
import { EmptyState, ErrorState } from "@/components/ui/panel";
import { isModelConfigured } from "@/lib/ai/provider";
import { loadAssignPanelData } from "@/lib/assignments/queries";
import { getSession } from "@/lib/auth/session";
import { loadLatestConversation } from "@/lib/conversation/queries";
import {
  applyDayPlanPlacements,
  plainDecisionTitle,
  recommendDayPlan,
  type OpenDecisionSeed,
} from "@/lib/dashboard/day-plan";
import { founderPlanDate, loadSavedDayPlan } from "@/lib/dashboard/day-plan-store";
import {
  decisionReviewHref,
  groupActivityByDate,
  groupProjectsByStatus,
  type ProjectBoardRow,
} from "@/lib/dashboard/today-board";
import { formatTimestamp } from "@/lib/format";
import { loadTodayActions } from "@/lib/operations/actions";
import { loadRecentActivity } from "@/lib/operations/activity";
import {
  loadAgentTaskSurface,
  projectAgentTasksToActivity,
  projectAgentTasksToTodayActions,
} from "@/lib/operations/agent-task-surface";
import { prioritizeTodayActions } from "@/lib/operations/today";
import { loadOpenDecisions } from "@/lib/decisions/queries";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Today",
};

const FOUNDER_TZ = "America/New_York";

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
  const planDate = founderPlanDate(FOUNDER_TZ);

  const [projects, conversation, today, openDecisions, agentTaskSurface, savedPlan] =
    await Promise.all([
      loadProjectSummaries(session.supabase),
      loadLatestConversation(session.supabase, null),
      loadTodayActions(session.supabase),
      loadOpenDecisions(session.supabase),
      loadAgentTaskSurface(session.supabase, { limit: 24 }),
      loadSavedDayPlan(session.supabase, session.user.id, planDate),
    ]);

  const projectList = projects.status === "ok" ? projects.data : [];
  // Team / Ghost AI assignment options; resolves to empty lists when the schema is not applied.
  const assignWork = await loadAssignPanelData(session.supabase).catch(() => null);
  const decisionList = openDecisions.status === "ok" ? openDecisions.data : [];
  const agentTaskRows = agentTaskSurface.status === "ok" ? agentTaskSurface.data : [];
  const todayList = prioritizeTodayActions([
    ...(today.status === "ok" ? today.data : []),
    ...projectAgentTasksToTodayActions(agentTaskRows),
  ]);

  const decisionSeeds: OpenDecisionSeed[] = decisionList.map((decision) => ({
    id: decision.id,
    projectId: decision.projectId,
    projectName:
      projectList.find((project) => project.id === decision.projectId)?.name ?? "Workspace",
    title: decision.title,
    question: decision.question,
  }));

  const recommended = recommendDayPlan({
    actions: todayList,
    agentTasks: agentTaskRows,
    decisions: decisionSeeds,
  });
  const planned = applyDayPlanPlacements(
    recommended,
    savedPlan.status === "ok" ? savedPlan.data?.placements ?? null : null,
  );

  const focusProject =
    projectList.find((project) =>
      agentTaskRows.some(
        (row) =>
          row.projectId === project.id &&
          ["RUNNING", "CHECKPOINT", "CLAIMED", "BLOCKED", "QUEUED"].includes(row.status),
      ),
    ) ??
    projectList.find((project) => decisionList.some((decision) => decision.projectId === project.id)) ??
    projectList[0] ??
    null;

  const decisionTaskIds = decisionList.flatMap((decision) =>
    decision.evidence.filter((item) => item.type === "task").map((item) => item.id),
  );
  const decisionAuthIds = decisionList.flatMap((decision) =>
    decision.evidence.filter((item) => item.type === "authorization").map((item) => item.id),
  );
  const taskById = new Map<string, { id: string; projectId: string }>();
  const taskByAuth = new Map<string, { id: string; projectId: string }>();
  if (decisionTaskIds.length > 0) {
    const evidenceTasks = await session.supabase
      .from("agent_tasks")
      .select("id, project_id")
      .eq("owner_id", session.user.id)
      .in("id", decisionTaskIds)
      .limit(80);
    for (const row of (evidenceTasks.data ?? []) as Array<{ id: string; project_id: string }>) {
      taskById.set(row.id, { id: row.id, projectId: row.project_id });
    }
  }
  if (decisionAuthIds.length > 0) {
    const bound = await session.supabase
      .from("agent_tasks")
      .select("id, project_id, authorization_id")
      .eq("owner_id", session.user.id)
      .in("authorization_id", decisionAuthIds)
      .limit(80);
    for (const row of (bound.data ?? []) as Array<{
      id: string;
      project_id: string;
      authorization_id: string;
    }>) {
      taskByAuth.set(row.authorization_id, { id: row.id, projectId: row.project_id });
    }
  }

  const firstDecision = decisionList[0] ?? null;
  const needsDecision = firstDecision
    ? (() => {
        const evidenceTask = firstDecision.evidence.find((item) => item.type === "task");
        const evidenceAuth = firstDecision.evidence.find((item) => item.type === "authorization");
        const bound =
          (evidenceTask ? taskById.get(evidenceTask.id) : undefined) ??
          (evidenceAuth ? taskByAuth.get(evidenceAuth.id) : undefined);
        return {
          id: firstDecision.id,
          title: plainDecisionTitle(firstDecision.title),
          question: firstDecision.question,
          projectName:
            projectList.find((project) => project.id === firstDecision.projectId)?.name ??
            "Workspace",
          reviewHref: decisionReviewHref({
            decisionId: firstDecision.id,
            projectId: bound?.projectId ?? firstDecision.projectId,
            taskId: bound?.id ?? null,
          }),
        };
      })()
    : null;

  const latestArtifact = await session.supabase
    .from("agent_review_artifacts")
    .select("id, title, content_ref, content_sha256, kind, project_id, task_id, created_at")
    .eq("owner_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(8);

  const artifactRows =
    ((latestArtifact.data ?? []) as Array<{
      id: string;
      title: string;
      content_ref: string;
      content_sha256: string;
      kind: string;
      project_id: string;
      task_id: string;
      created_at: string;
    }>) || [];
  const preferredArtifact =
    artifactRows.find((row) => /test run completed|MOCK result/i.test(row.title)) ??
    artifactRows[0] ??
    null;
  const latestResult = preferredArtifact
    ? {
        title: preferredArtifact.title,
        content: preferredArtifact.content_ref,
        contentSha256: preferredArtifact.content_sha256,
        kind: preferredArtifact.kind,
        href: `/projects/${preferredArtifact.project_id}/workspace?task=${encodeURIComponent(preferredArtifact.task_id)}`,
        projectName:
          projectList.find((project) => project.id === preferredArtifact.project_id)?.name ??
          "Project",
      }
    : null;

  const projectRows: ProjectBoardRow[] = projectList.map((project) => ({
    projectId: project.id,
    projectName: project.name,
    status: project.status,
    nextAction: project.nextAction,
    href: `/projects/${project.id}`,
  }));
  const projectGroups = groupProjectsByStatus(projectRows);

  const recentActivity = await loadRecentActivity(session.supabase, 16);
  const activityItems = [
    ...(recentActivity.status === "ok" ? recentActivity.data : []),
    ...projectAgentTasksToActivity(agentTaskRows),
  ]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 18);
  const activityGroups = groupActivityByDate(activityItems, FOUNDER_TZ);

  return (
    <div className="ghost-home today-home today-home-wide today-home-plan">
      <header className="today-hero today-hero-plan">
        <div className="today-hero-copy">
          <p className="ghost-brand">GHOST</p>
          <FounderDate />
          <h1>{greeting}</h1>
          <p className="ghost-home-lede">
            Arrange the day, assign a test review, and open saved results — without inventing work.
          </p>
        </div>
      </header>

      <TodayDayBoard
        actions={todayList}
        agentTasks={agentTaskRows}
        decisions={decisionSeeds}
        savedPlacements={savedPlan.status === "ok" ? savedPlan.data?.placements ?? null : null}
        planDate={planDate}
        timeZone={FOUNDER_TZ}
        projects={projectList.map((project) => ({ id: project.id, name: project.name }))}
        latestResult={latestResult}
        needsDecision={needsDecision}
        assignWork={assignWork}
      />

      <StaggerBoard>
        <StaggerCard index={0}>
          <section className="today-section today-ask-section" id="ask-ghost" aria-labelledby="ask-heading">
            <div className="ghost-home-section-head">
              <p className="eyebrow">Companion</p>
              <h2 id="ask-heading">Ask Ghost</h2>
              <p className="quiet today-ask-scope">
                {focusProject
                  ? `Answering about ${focusProject.name}.`
                  : "Answering across your workspace."}
              </p>
            </div>
            <GhostConversation
              projectId={focusProject?.id ?? null}
              projectName={focusProject?.name ?? null}
              conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
              messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
              providerConfigured={isModelConfigured()}
              variant="command"
              loadError={
                conversation.status === "error"
                  ? "Conversation could not be loaded right now. Your projects and plan above are still available."
                  : null
              }
            />
          </section>
        </StaggerCard>

        <StaggerCard index={1}>
          <section className="today-section" aria-labelledby="projects-heading">
            <div className="ghost-home-section-head ghost-home-section-head-row">
              <div>
                <p className="eyebrow">Portfolio</p>
                <h2 id="projects-heading">Projects</h2>
              </div>
              <Link href="/projects">All projects</Link>
            </div>
            {projects.status === "error" ? (
              <ErrorState message="Projects could not be loaded right now." />
            ) : projectGroups.length === 0 ? (
              <EmptyState>
                No projects yet.{" "}
                <Link href="/projects/new">Start a project</Link> so Ghost has a home for work.
              </EmptyState>
            ) : (
              <div className="today-project-groups">
                {projectGroups.map((group) => (
                  <div key={group.status} className="today-project-group">
                    <p className="eyebrow">{group.status.replaceAll("_", " ")}</p>
                    <ul className="today-card-list">
                      {group.projects.map((row) => (
                        <li key={row.projectId}>
                          <h3>
                            <SoftNavLink href={row.href}>{row.projectName}</SoftNavLink>
                          </h3>
                          {row.nextAction ? (
                            <p className="ceo-next">Next: {row.nextAction}</p>
                          ) : (
                            <p className="quiet">No next action recorded</p>
                          )}
                          <SoftNavLink
                            className="today-open-project"
                            href={`/projects/${row.projectId}/workspace`}
                          >
                            Open worker
                          </SoftNavLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </StaggerCard>

        <StaggerCard index={2}>
          <section className="today-section" aria-labelledby="activity-heading">
            <div className="ghost-home-section-head">
              <p className="eyebrow">Trail</p>
              <h2 id="activity-heading">Recent activity</h2>
            </div>
            {recentActivity.status === "error" && activityItems.length === 0 ? (
              <ErrorState message="Recent activity could not be loaded." />
            ) : activityGroups.length === 0 ? (
              <EmptyState>No recent recorded activity.</EmptyState>
            ) : (
              <div className="today-activity-groups">
                {activityGroups.map((group) => (
                  <div key={group.dayKey} className="today-activity-day">
                    <h3>{group.dayLabel}</h3>
                    <ul className="today-card-list">
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <p className="ceo-project-label">{item.projectName}</p>
                          <p>{item.title}</p>
                          <p className="quiet">{item.detail}</p>
                          <p className="quiet">{formatTimestamp(item.at)}</p>
                          <div className="today-inline-actions">
                            <SoftNavLink href={item.href}>Open</SoftNavLink>
                            {item.resultHref ? (
                              <SoftNavLink href={item.resultHref}>Saved result</SoftNavLink>
                            ) : null}
                            {item.evidenceHref && item.evidenceHref !== item.href ? (
                              <SoftNavLink href={item.evidenceHref}>Evidence</SoftNavLink>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </StaggerCard>
      </StaggerBoard>
      {/* keep planned count available for diagnostics without rendering inventing copy */}
      <span className="visually-hidden" data-plan-items={planned.length} />
    </div>
  );
}
