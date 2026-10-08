import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, ErrorState } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/lib/auth/session";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Projects",
};

export default async function ProjectsPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const projects = await loadProjectSummaries(session.supabase);

  return (
    <div className="stack projects-index">
      <div className="page-head">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>What you are building.</h1>
          <p className="quiet">Each project has a brain, memory, and next action — not a vanity board.</p>
        </div>
        <Link className="button" href="/projects/new">
          New project
        </Link>
      </div>

      {projects.status === "error" ? <ErrorState message={projects.message} /> : null}
      {projects.status === "ok" && projects.data.length === 0 ? (
        <EmptyState>No projects yet. Create your first project so Ghost has a place to work.</EmptyState>
      ) : null}
      {projects.status === "ok" && projects.data.length > 0 ? (
        <ul className="projects-index-list">
          {projects.data.map((project) => (
            <li key={project.id}>
              <article>
                <div className="projects-index-row">
                  <h2>
                    <Link href={`/projects/${project.id}`}>{project.name}</Link>
                  </h2>
                  <StatusBadge status={project.status} />
                </div>
                <p className="quiet">{project.description || "No description recorded."}</p>
                <ul className="meta">
                  <li>{project.currentMilestone || "No milestone recorded."}</li>
                  <li>{project.openBlockers} open blockers</li>
                  <li>{project.nextAction ?? "No open next action."}</li>
                </ul>
              </article>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
