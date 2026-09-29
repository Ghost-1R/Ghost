import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, ErrorState, Panel } from "@/components/ui/panel";
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
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>What you are building.</h1>
        </div>
        <Link className="button" href="/projects/new">
          New project
        </Link>
      </div>
      <Panel title="Project records">
        {projects.status === "error" ? <ErrorState message={projects.message} /> : null}
        {projects.status === "ok" && projects.data.length === 0 ? (
          <EmptyState>No projects yet. Create your first project.</EmptyState>
        ) : null}
        {projects.status === "ok" && projects.data.length > 0 ? (
          <div className="stack">
            {projects.data.map((project) => (
              <article className="list-item" key={project.id}>
                <h3>
                  <Link href={`/projects/${project.id}`}>{project.name}</Link>
                </h3>
                <p className="quiet">{project.description || "No description recorded."}</p>
                <ul className="meta">
                  <li>
                    <StatusBadge status={project.status} />
                  </li>
                  <li>{project.currentMilestone || "No milestone recorded."}</li>
                  <li>{project.openBlockers} open blockers</li>
                  <li>{project.nextAction ?? "No open next action."}</li>
                </ul>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
