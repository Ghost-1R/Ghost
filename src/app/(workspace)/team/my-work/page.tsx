import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getAccessContext, hasFounderSurface } from "@/lib/access/session-access";
import { getSession } from "@/lib/auth/session";
import { formatTimestamp } from "@/lib/format";
import { submitForReviewAction } from "@/lib/team/actions";
import { loadMyWork } from "@/lib/team/queries";

export const metadata: Metadata = {
  title: "My Work",
};

const PREVIEWS = {
  TEAM_MEMBER: {
    label: "Team member",
    can: [
      "See the projects they are added to",
      "Work on assignments given to them and submit them for review",
      "Never see Settings, Team, or other companies",
    ],
  },
  PROJECT_ADMIN: {
    label: "Project admin",
    can: [
      "See every project in their company",
      "Assign work and review submissions",
      "Never see Settings or invite and revoke teammates",
    ],
  },
} as const;

export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; joined?: string }>;
}) {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const { preview, joined } = await searchParams;
  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  const previewRole =
    hasFounderSurface(access) && (preview === "TEAM_MEMBER" || preview === "PROJECT_ADMIN")
      ? PREVIEWS[preview]
      : null;

  const result = await loadMyWork(session.supabase, session.user.id);
  const assignments = result.status === "ok" ? result.data.assignments : [];
  const projects = result.status === "ok" ? result.data.projects : [];
  const open = assignments.filter((row) => row.status === "ASSIGNED" || row.status === "IN_PROGRESS");

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">My Work</p>
          <h1>Your assignments.</h1>
          <p className="quiet">Work assigned to you, the projects you can open, and what is waiting on review.</p>
        </div>
      </div>

      {joined ? (
        <p className="notice" role="status">
          You joined the team. Your projects are listed below.
        </p>
      ) : null}

      {previewRole ? (
        <section className="notice" aria-label="Role preview">
          <p>
            <strong>Previewing: {previewRole.label}.</strong> This page is what they see.{" "}
            <Link href="/team">Back to Team</Link>
          </p>
          <ul className="meta">
            {previewRole.can.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.status === "error" ? <ErrorState message={result.message} /> : null}

      <Panel title="My Work">
        {assignments.length === 0 ? (
          <EmptyState>Nothing is assigned to you right now.</EmptyState>
        ) : (
          <ul className="projects-index-list">
            {assignments.map((assignment) => (
              <li key={assignment.id}>
                <div className="projects-index-row">
                  <h3>{assignment.title}</h3>
                  <StatusBadge status={assignment.status} />
                </div>
                {assignment.instructions ? <p className="quiet">{assignment.instructions}</p> : null}
                <ul className="meta">
                  <li>
                    <Link href={`/projects/${assignment.projectId}`}>{assignment.projectName}</Link>
                  </li>
                  <li>{assignment.dueAt ? `Due ${formatTimestamp(assignment.dueAt)}` : "No due date"}</li>
                  {assignment.reviewNote ? <li>Review: {assignment.reviewNote}</li> : null}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Assigned projects">
        {projects.length === 0 ? (
          <EmptyState>You have not been added to any projects yet.</EmptyState>
        ) : (
          <ul className="projects-index-list">
            {projects.map((project) => (
              <li key={project.id}>
                <div className="projects-index-row">
                  <h3>
                    <Link href={`/projects/${project.id}`}>{project.name}</Link>
                  </h3>
                  <span className="badge badge-neutral">
                    {project.role === "PROJECT_ADMIN" || project.role === "ADMIN_VIA_COMPANY"
                      ? "Project admin"
                      : "Team member"}
                  </span>
                </div>
                {project.companyName ? <p className="quiet">{project.companyName}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Submit for review">
        {open.length === 0 ? (
          <EmptyState>No open work to submit.</EmptyState>
        ) : (
          <ActionForm action={submitForReviewAction} submitLabel="Submit for review">
            <label className="field">
              <span>Assignment</span>
              <select name="assignmentId" required defaultValue={open[0]?.id}>
                {open.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.title} — {assignment.projectName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>What did you finish?</span>
              <textarea name="note" required maxLength={4000} rows={4} />
            </label>
          </ActionForm>
        )}
      </Panel>
    </div>
  );
}
