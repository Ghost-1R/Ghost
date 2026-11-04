import { redirect } from "next/navigation";
import { PreferenceShell } from "@/components/settings/preference-shell";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/auth/session";
import { loadFounderPreferences } from "@/lib/preferences/store";
import { DEFAULT_FOUNDER_PREFERENCES } from "@/lib/preferences/types";
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

  const [projects, prefsResult] = await Promise.all([
    loadProjectSummaries(session.supabase),
    loadFounderPreferences(session.supabase, session.user.id),
  ]);
  const navProjects =
    projects.status === "ok"
      ? projects.data.map((project) => ({ id: project.id, name: project.name }))
      : [];
  const preferences =
    prefsResult.status === "ok" ? prefsResult.data : { ...DEFAULT_FOUNDER_PREFERENCES };

  return (
    <>
      <PreferenceShell preferences={preferences} />
      <AppShell email={session.user.email} projects={navProjects}>
        {children}
      </AppShell>
    </>
  );
}
