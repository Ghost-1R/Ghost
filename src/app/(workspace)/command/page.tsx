import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CommandDashboard } from "@/components/command/command-dashboard";
import { getAccessContext, hasFounderSurface } from "@/lib/access/session-access";
import { getSession } from "@/lib/auth/session";
import { loadCompaniesForUser } from "@/lib/companies/queries";
import { loadCommandBoard } from "@/lib/command/load";

export const metadata: Metadata = {
  title: "CEO Command",
};

export default async function CommandPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const session = await getSession();
  if (session.status !== "authenticated") redirect("/login");

  const access = await getAccessContext(session.supabase, session.user.id, session.user.email);
  if (!hasFounderSurface(access)) redirect("/dashboard");

  const { company } = await searchParams;
  const profile = await session.supabase
    .from("profiles")
    .select("display_name")
    .eq("id", session.user.id)
    .maybeSingle();

  const [board, companies] = await Promise.all([
    loadCommandBoard(session.supabase, {
      userId: session.user.id,
      email: session.user.email,
      access,
      companyId: company ?? null,
      displayName: profile.data?.display_name ?? null,
    }),
    loadCompaniesForUser(session.supabase, session.user.id),
  ]);

  const companyOptions =
    companies.status === "ok"
      ? companies.data.map((row) => ({ id: row.id, name: row.name }))
      : [];

  return <CommandDashboard board={board} companies={companyOptions} />;
}
