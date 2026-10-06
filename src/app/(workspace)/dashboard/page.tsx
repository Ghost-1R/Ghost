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
  moneyStatusPhase1,
  rankTop3Actions,
  whoMightCallSection,
  type CeoSignal,
} from "@/lib/dashboard/ceo";
import { loadCeoSignals } from "@/lib/dashboard/ceo-queries";
import { resolveFounderDecision } from "@/lib/decisions/actions";
import { loadOpenDecisions } from "@/lib/decisions/queries";
import { loadTodayActions } from "@/lib/operations/actions";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Command Center",
};

function greetingLine(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
  const founderName =
    profile.data?.display_name?.trim() ||
    session.user.email?.split("@")[0] ||
    "Founder";

  const [projects, conversation, today, openDecisions] = await Promise.all([
    loadProjectSummaries(session.supabase),
    loadLatestConversation(session.supabase, null),
    loadTodayActions(session.supabase),
    loadOpenDecisions(session.supabase),
  ]);

  const projectList = projects.status === "ok" ? projects.data : [];
  const decisionList = openDecisions.status === "ok" ? openDecisions.data : [];
  const todayList = today.status === "ok" ? today.data : [];

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
    });
    return {
      projectId: project.id,
      projectName: project.name,
      health,
      nextAction: health.nextAction ?? project.nextAction,
      href: `/projects/${project.id}`,
    };
  });

  return (
    <div className="ceo-home">
      <header className="ceo-greeting">
        <p className="eyebrow">Ghost · Second Me</p>
        <h1>
          {greetingLine()}, {founderName}.
        </h1>
        <p className="ceo-lede">Here&apos;s what needs you today.</p>
      </header>

      <section className="ceo-panel ceo-top3" aria-labelledby="top3-heading">
        <div className="ceo-panel-head">
          <p className="eyebrow">Top 3 Actions</p>
          <h2 id="top3-heading">What needs you.</h2>
        </div>
        {top3.length === 0 ? (
          <EmptyState>Nothing urgent is recorded right now. Ghost does not invent work to fill this list.</EmptyState>
        ) : (
          <ol className="ceo-action-list">
            {top3.map((item, index) => (
              <li key={item.id}>
                <span className="ceo-rank" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <p className="ceo-project-label">{item.projectName}</p>
                  <h3>{item.nextAction}</h3>
                  <p className="quiet">
                    {item.status} · {item.reason}
                  </p>
                </div>
                <Link className="button-secondary ceo-go" href={item.href}>
                  Continue →
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="ceo-panel ceo-waiting" aria-labelledby="waiting-heading" id="waiting-on-me">
        <div className="ceo-panel-head">
          <p className="eyebrow">Waiting on Me</p>
          <h2 id="waiting-heading">Decisions and reviews only you can clear.</h2>
        </div>
        {openDecisions.status === "error" ? <ErrorState message={openDecisions.message} /> : null}
        {waiting.length === 0 ? (
          <EmptyState>Nothing is waiting on you.</EmptyState>
        ) : (
          <ul className="ceo-simple-list">
            {waiting.map((item) => (
              <li key={item.id}>
                <div>
                  <p className="ceo-project-label">{item.projectName}</p>
                  <h3>{item.what}</h3>
                  <p className="quiet">
                    {item.reason}
                    {item.ageLabel ? ` · ${item.ageLabel}` : ""}
                  </p>
                  {item.id.startsWith("dec-") ? (
                    <ActionForm action={resolveFounderDecision} submitLabel={item.actionLabel}>
                      <input type="hidden" name="decisionId" value={item.id.replace(/^dec-/, "")} />
                      <input type="hidden" name="projectId" value={item.projectId ?? ""} />
                      <input type="hidden" name="status" value="RESOLVED" />
                      <label className="field">
                        <span>Your choice</span>
                        <input name="selectedOption" required maxLength={200} placeholder="Selected option or answer" />
                      </label>
                    </ActionForm>
                  ) : null}
                </div>
                <Link className="button-secondary" href={item.href}>
                  {item.actionLabel} →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ceo-panel ceo-red" aria-labelledby="red-heading">
        <div className="ceo-panel-head">
          <p className="eyebrow">Red Lights</p>
          <h2 id="red-heading">Shipping blockers only.</h2>
        </div>
        {redLights.length === 0 ? (
          <EmptyState>No known shipping blockers.</EmptyState>
        ) : (
          <ul className="ceo-simple-list">
            {redLights.map((light) => (
              <li key={light.id}>
                <div>
                  <p className="ceo-project-label">{light.projectName}</p>
                  <h3>{light.reason}</h3>
                  <p className="quiet">{light.evidence}</p>
                  <p className="ceo-next">{light.nextAction}</p>
                </div>
                <Link className="button-secondary" href={light.href}>
                  Fix →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ceo-panel ceo-ask" id="ask-ghost" aria-labelledby="ask-heading">
        <div className="ceo-panel-head">
          <p className="eyebrow">Ask Ghost</p>
          <h2 id="ask-heading">Ask Ghost anything…</h2>
        </div>
        <p className="quiet">
          Questions answer immediately from Project Brain. Build, deploy, publish, send, and other consequential
          actions stay gated in the operating system.
        </p>
        {conversation.status === "error" ? <ErrorState message={conversation.message} /> : null}
        <GhostConversation
          projectId={null}
          projectName={null}
          conversationId={conversation.status === "ok" ? conversation.data?.id ?? null : null}
          messages={conversation.status === "ok" ? conversation.data?.messages ?? [] : []}
          providerConfigured={isModelConfigured()}
          variant="command"
        />
      </section>

      <section className="ceo-panel ceo-projects" aria-labelledby="projects-heading">
        <div className="ceo-panel-head ceo-panel-head-row">
          <div>
            <p className="eyebrow">Projects</p>
            <h2 id="projects-heading">Health, reason, next step.</h2>
          </div>
          <Link href="/projects">All projects</Link>
        </div>
        {projects.status === "error" ? <ErrorState message={projects.message} /> : null}
        {projects.status === "ok" && projectRows.length === 0 ? <EmptyState>No projects yet.</EmptyState> : null}
        {projectRows.length > 0 ? (
          <ul className="ceo-project-rows">
            {projectRows.map((row) => (
              <li key={row.projectId}>
                <span className="ceo-health" title={row.health.status} aria-label={row.health.status}>
                  {healthGlyph(row.health.status)}
                </span>
                <div>
                  <h3>
                    <Link href={row.href}>{row.projectName}</Link>
                  </h3>
                  <p className="quiet">{row.health.reason}</p>
                  {row.nextAction ? <p className="ceo-next">Next: {row.nextAction}</p> : null}
                </div>
                <Link className="button-secondary" href={row.href}>
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="ceo-panel ceo-call" aria-labelledby="call-heading" id="who-might-call">
        <div className="ceo-panel-head">
          <p className="eyebrow">Who Might Call Me</p>
          <h2 id="call-heading">Exceptions only.</h2>
        </div>
        <p className="ceo-honest quiet">{whoMightCall.notice}</p>
        {whoMightCall.exceptions.length === 0 ? (
          <EmptyState>No recorded client-facing exceptions right now.</EmptyState>
        ) : (
          <ul className="ceo-simple-list">
            {whoMightCall.exceptions.map((item) => (
              <li key={item.id}>
                <div>
                  <p className="ceo-project-label">{item.projectName}</p>
                  <p>{item.reason}</p>
                </div>
                <Link href={item.href}>Open →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ceo-panel ceo-money" aria-labelledby="money-heading">
        <div className="ceo-panel-head">
          <p className="eyebrow">Money</p>
          <h2 id="money-heading">{money.label}</h2>
        </div>
        <p className="ceo-money-detail">{money.detail}</p>
        <p className="quiet">Ghost will not invent revenue, MRR, or failed charges.</p>
      </section>
    </div>
  );
}
