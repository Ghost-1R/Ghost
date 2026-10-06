import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/auth/session";
import { loadProjectSummaries } from "@/lib/projects/queries";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (session.status === "unconfigured") {
    redirect("/login?reason=unconfigured");
  }

  if (session.status !== "authenticated") {
    redirect("/login");
  }

  const projects = await loadProjectSummaries(session.supabase);
  const navProjects =
    projects.status === "ok"
      ? projects.data.map((project) => ({ id: project.id, name: project.name }))
      : [];

  return (
    <AppShell email={session.user.email} projects={navProjects}>
      {children}
    </AppShell>
  );
}
