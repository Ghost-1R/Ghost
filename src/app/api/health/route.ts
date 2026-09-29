import { releaseCommit } from "@/lib/inspector/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: "ok", commit: await releaseCommit() }, { headers: { "cache-control": "no-store" } });
}
