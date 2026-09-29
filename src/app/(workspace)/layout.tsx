import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (session.status === "unconfigured") {
    redirect("/login?reason=unconfigured");
  }

  if (session.status !== "authenticated") {
    redirect("/login");
  }

  return <AppShell email={session.user.email}>{children}</AppShell>;
}
