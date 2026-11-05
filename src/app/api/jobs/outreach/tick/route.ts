import { NextResponse } from "next/server";
import { outreachServiceClient, outreachWorkerSecret } from "@/lib/outreach-worker/db";
import { runOutreachTick } from "@/lib/outreach-worker/tick";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const expected = outreachWorkerSecret();
  if (!expected) return false;
  const header =
    request.headers.get("x-ghost-outreach-worker-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  return header === expected;
}

/** Cron/manual tick for Outreach send queue. */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabase = outreachServiceClient();
    const result = await runOutreachTick(supabase, { trigger: "schedule" });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "tick failed",
      },
      { status: 500 },
    );
  }
}
