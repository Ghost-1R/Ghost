import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { loadWorkspaceStatus } from "@/lib/workspace/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { projectId } = await context.params;
  const owned = await session.supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (owned.error || !owned.data) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const status = await loadWorkspaceStatus(session.supabase, {
    ownerId: session.user.id,
    projectId,
  });
  if (status.status === "error") {
    return NextResponse.json({ error: status.message }, { status: 500 });
  }
  return NextResponse.json(status.data);
}
