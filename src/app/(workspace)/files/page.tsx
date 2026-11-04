import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ResultExplainCard } from "@/components/today/result-explain";
import { EmptyState, ErrorState } from "@/components/ui/panel";
import { getSession } from "@/lib/auth/session";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Files",
};

type ArtifactRow = {
  id: string;
  title: string;
  content_ref: string;
  content_sha256: string;
  kind: string | null;
  created_at: string;
  project_id: string;
  task_id: string;
};

export default async function FilesPage() {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const projects = await loadProjectSummaries(session.supabase);
  const projectNames = new Map(
    projects.status === "ok" ? projects.data.map((row) => [row.id, row.name]) : [],
  );

  const artifacts = await session.supabase
    .from("agent_review_artifacts")
    .select("id, title, content_ref, content_sha256, kind, created_at, project_id, task_id")
    .eq("owner_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(40);

  if (artifacts.error && !/does not exist|schema cache/i.test(artifacts.error.message)) {
    return <ErrorState message="Files could not be loaded from persisted artifacts." />;
  }

  const rows = (artifacts.data ?? []) as ArtifactRow[];

  return (
    <div className="surface-page">
      <header className="surface-hero">
        <p className="eyebrow">Files</p>
        <h1>Project evidence and artifacts</h1>
        <p className="quiet">
          Founder-private review artifacts only. Ghost does not invent files or completion
          percentages. Test results are labeled clearly; IDs and hashes stay under technical
          details.
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState>
          No artifacts yet. Run a bounded test review from{" "}
          <Link href="/dashboard">Today</Link> or a{" "}
          <Link href="/projects">project Worker</Link> to save evidence here.
        </EmptyState>
      ) : (
        <ul className="worker-artifacts files-result-list">
          {rows.map((row) => (
            <li key={row.id}>
              <ResultExplainCard
                title={row.title}
                content={row.content_ref}
                contentSha256={row.content_sha256}
                kind={row.kind}
                projectName={projectNames.get(row.project_id) ?? "Project"}
                href={`/projects/${row.project_id}/workspace?task=${encodeURIComponent(row.task_id)}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
