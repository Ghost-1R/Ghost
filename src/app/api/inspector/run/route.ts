import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { HOSTED_INSPECTION_REFUSAL, isHostedRuntime, parseInspectionTarget, productionUrl } from "@/lib/inspector/runtime";
import { executeTrustedInspection } from "@/lib/inspector/trusted-inspection";
import type { InspectionProgress } from "@/lib/inspector/schedule";
import { rejectedClientEvidence } from "@/lib/presentation/records";
import { loadProjectDetail } from "@/lib/projects/queries";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const session = await getSession();
  if (session.status !== "authenticated") {
    return Response.json({ error: "You are not signed in." }, { status: 401 });
  }
  if (isHostedRuntime()) {
    return Response.json({ error: HOSTED_INSPECTION_REFUSAL }, { status: 409 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "That request is not an inspection." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const forged = rejectedClientEvidence(Object.keys(record));
  if (forged || Object.keys(record).some((key) => key !== "projectId" && key !== "target")) {
    return Response.json({ error: forged ?? "That request is not an inspection." }, { status: 400 });
  }
  const target = parseInspectionTarget(record.target);
  if (!target || (target === "production" && !productionUrl())) {
    return Response.json({ error: "That inspection target is not available." }, { status: 400 });
  }
  const projectId = record.projectId;
  if (typeof projectId !== "string" || !UUID_PATTERN.test(projectId)) {
    return Response.json({ error: "That project is not visible." }, { status: 404 });
  }
  const project = await loadProjectDetail(session.supabase, projectId);
  if (project.status !== "ok" || !project.data) {
    return Response.json({ error: "That project is not visible." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: InspectionProgress) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await executeTrustedInspection({
          ownerId: session.user.id,
          projectId,
          cwd: process.cwd(),
          target,
          supabase: session.supabase,
          onProgress: send,
        });
        revalidatePath("/inspector");
        revalidatePath("/presentation");
      } catch {
        send({
          stage: "FAILED",
          check: null,
          status: "failed",
          elapsedMs: 0,
          detail: "Inspection stopped before it could finish.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
