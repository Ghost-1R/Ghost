import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { canAdminProject } from "@/lib/access/permissions";
import { getAccessContext } from "@/lib/access/session-access";
import { getSession } from "@/lib/auth/session";
import { loadAssignPanelData } from "@/lib/assignments/queries";
import { loadProjectDetail } from "@/lib/projects/queries";
import { checkSchemaFeature } from "@/lib/schema/readiness";
import {
  activateUnderworldPlanForm,
  createUnderworldGoalForm,
  previewUnderworldPlanForm,
  runNextUnderworldStepForm,
} from "@/lib/underworld/actions";
import { loadLatestUnderworldBoard } from "@/lib/underworld/queries";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Underworld" };

export default async function UnderworldPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const [project, access, schema, board, assignPanel] = await Promise.all([
    loadProjectDetail(session.supabase, id),
    getAccessContext(session.supabase, session.user.id, session.user.email),
    checkSchemaFeature(session.supabase, "underworld"),
    loadLatestUnderworldBoard(session.supabase, id),
    loadAssignPanelData(session.supabase, { projectIds: [id] }),
  ]);

  if (project.status === "error") {
    return (
      <div className="stack">
        <h1>Underworld</h1>
        <ErrorState message={project.message} />
      </div>
    );
  }
  if (!project.data) notFound();

  const detail = project.data;
  const admin = canAdminProject(access, detail.id, detail.companyId);
  const latest = board.status === "ok" ? board.data : null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link href={`/projects/${detail.id}`}>{detail.name}</Link> · Underworld
          </p>
          <h1>Coordinated workers.</h1>
          <p className="quiet">
            Planner → executor → independent reviewer. MOCK only. LIVE stays off. Staged for founder review.
          </p>
        </div>
        <Link className="button-secondary" href={`/projects/${detail.id}/workspace`}>
          Worker
        </Link>
      </div>

      {!schema.ready ? (
        <section className="notice" role="status">
          <p>
            <strong>Underworld is staged locally.</strong> Apply the Underworld migration after the Companies/Team
            hosted migration gate clears.
          </p>
        </section>
      ) : null}

      {admin && schema.ready ? (
        <Panel title="New goal">
          <ActionForm action={createUnderworldGoalForm} submitLabel="Propose MOCK plan">
            <input type="hidden" name="companyId" value={detail.companyId} />
            <input type="hidden" name="projectId" value={detail.id} />
            <label className="field">
              <span>Goal</span>
              <input name="title" required maxLength={200} placeholder="Verify Sales Map ZIP totals" />
            </label>
            <label className="field">
              <span>Objective</span>
              <textarea name="objective" rows={3} placeholder="What should be true when this is done?" />
            </label>
          </ActionForm>
        </Panel>
      ) : null}

      {!latest ? (
        <EmptyState>No Underworld goal on this project yet.</EmptyState>
      ) : (
        <>
          <Panel title={latest.goal.title}>
            <ul className="meta">
              <li>Status: {latest.goal.status}</li>
              <li>Classification: {latest.goal.classification}</li>
              <li>Budget: ${((latest.goal.budgetCents ?? 0) / 100).toFixed(2)} (MOCK)</li>
            </ul>
            <p className="quiet">{latest.goal.objective || "No objective recorded."}</p>
            <p className="quiet">{latest.goal.stopCondition}</p>
          </Panel>

          <Panel title={`Plan v${latest.plan.version}`}>
            <ul className="meta">
              <li>
                <StatusBadge status={latest.plan.status} />
              </li>
              <li>Fingerprint {latest.plan.scopeFingerprint.slice(0, 12)}</li>
            </ul>
            <pre className="quiet" style={{ whiteSpace: "pre-wrap" }}>
              {latest.plan.scopeSummary}
            </pre>
            {admin && schema.ready && latest.plan.status === "DRAFT" ? (
              <ActionForm action={previewUnderworldPlanForm} submitLabel="Preview scope">
                <input type="hidden" name="planId" value={latest.plan.id} />
                <input type="hidden" name="projectId" value={detail.id} />
                <input type="hidden" name="companyId" value={detail.companyId} />
              </ActionForm>
            ) : null}
            {admin && schema.ready && latest.plan.status === "PREVIEWED" ? (
              <ActionForm action={activateUnderworldPlanForm} submitLabel="Activate MOCK plan">
                <input type="hidden" name="planId" value={latest.plan.id} />
                <input type="hidden" name="goalId" value={latest.goal.id} />
                <input type="hidden" name="projectId" value={detail.id} />
                <input type="hidden" name="companyId" value={detail.companyId} />
                <input type="hidden" name="confirmPreview" value="yes" />
              </ActionForm>
            ) : null}
          </Panel>

          <Panel title="Steps">
            <ul className="projects-index-list">
              {latest.steps.map((step) => (
                <li key={step.id}>
                  <div className="projects-index-row">
                    <h3>
                      {step.seq}. {step.title}
                    </h3>
                    <StatusBadge status={step.status} />
                  </div>
                  <ul className="meta">
                    <li>{step.role}</li>
                    <li>{step.assigneeKind === "AI" ? "Ghost AI (MOCK)" : "Human"}</li>
                    <li>
                      attempts {step.attemptCount}/{step.maxAttempts}
                    </li>
                  </ul>
                  <p className="quiet">{step.stopCondition}</p>
                </li>
              ))}
            </ul>
            {admin && schema.ready && latest.plan.status === "ACTIVE" ? (
              <ActionForm action={runNextUnderworldStepForm} submitLabel="Run next READY step">
                <input type="hidden" name="planId" value={latest.plan.id} />
                <input type="hidden" name="projectId" value={detail.id} />
                <input type="hidden" name="companyId" value={detail.companyId} />
                <label className="field">
                  <span>Independent reviewer (for REVIEWER step)</span>
                  <select name="reviewerUserId" defaultValue="">
                    <option value="">Select teammate</option>
                    {assignPanel.teammates
                      .filter((mate) => mate.companyId === detail.companyId)
                      .map((mate) => (
                        <option key={mate.userId} value={mate.userId}>
                          {mate.label}
                        </option>
                      ))}
                  </select>
                </label>
              </ActionForm>
            ) : null}
          </Panel>
        </>
      )}
    </div>
  );
}
