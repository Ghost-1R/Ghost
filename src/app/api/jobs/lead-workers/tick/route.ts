import { leadWorkerServiceClient, leadWorkersEnvEnabled, leadWorkersSecret } from "@/lib/lead-workers/db";
import { runLeadWorkerTick } from "@/lib/lead-workers/tick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = leadWorkersSecret();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = request.headers.get("x-ghost-lead-worker-secret")?.trim() ?? "";
  return bearer === secret || alt === secret;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!leadWorkersEnvEnabled()) {
    return Response.json(
      {
        ok: false,
        status: "blocked",
        message: "GHOST_LEAD_WORKERS_ENABLED is not set.",
      },
      { status: 409 },
    );
  }
  try {
    const supabase = leadWorkerServiceClient();
    const result = await runLeadWorkerTick(supabase, { trigger: "schedule" });
    return Response.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
