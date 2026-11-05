import Link from "next/link";
import { queueBuildPlanReviewShiftJob } from "@/lib/underworld-shifts/actions";
import type { UnderworldShiftJob } from "@/lib/underworld-shifts/types";

function statusCopy(status: UnderworldShiftJob["status"]): string {
  switch (status) {
    case "QUEUED":
      return "queued";
    case "WORKING":
      return "working";
    case "BLOCKED":
      return "blocked";
    case "AWAITING_APPROVAL":
      return "awaiting approval";
    case "COMPLETE":
      return "complete";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
  }
}

async function queueReviewAction(formData: FormData) {
  "use server";
  const companyId = String(formData.get("companyId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (!companyId || !projectId) return;
  await queueBuildPlanReviewShiftJob({ companyId, projectId });
}

export function ShiftRunnerPanel(props: {
  companyId: string;
  projectId: string;
  projectName: string;
  jobs: UnderworldShiftJob[];
  withinShift: boolean;
}) {
  return (
    <section className="stack" aria-label="Underworld shift runner">
      <header>
        <p className="ghost-brand">SHIFT RUNNER</p>
        <h2>Build plan review</h2>
        <p>
          Server-side shift work for {props.projectName}. City scene controls above are simulated crew
          routines and stay separate from this runner.
        </p>
        <p className="meta">
          Default shift · Mon–Fri 9:00–17:00 America/New_York · now{" "}
          {props.withinShift ? "inside shift" : "outside shift (no new claims)"}
        </p>
      </header>

      <form action={queueReviewAction}>
        <input type="hidden" name="companyId" value={props.companyId} />
        <input type="hidden" name="projectId" value={props.projectId} />
        <button type="submit">Queue read-only build plan review</button>
      </form>
      <p className="quiet">
        Queuing requests founder approval first. The worker claims eligible jobs only during the shift,
        continues with the browser closed, and checkpoints unfinished work at shift end.
      </p>

      <h3>Persisted jobs</h3>
      {props.jobs.length === 0 ? (
        <p>No shift jobs recorded for this project yet.</p>
      ) : (
        <ul>
          {props.jobs.map((job) => (
            <li key={job.id}>
              <strong>{statusCopy(job.status)}</strong>
              {job.checkpointLabel ? ` · ${job.checkpointLabel}` : ""}
              {job.reviewSummary ? <p>{job.reviewSummary}</p> : null}
              {job.evidence.length > 0 ? (
                <p className="meta">
                  {job.evidence.map((link) => (
                    <span key={link.href}>
                      <Link href={link.href}>{link.label}</Link>{" "}
                    </span>
                  ))}
                </p>
              ) : null}
              {job.status === "AWAITING_APPROVAL" ? (
                <p>
                  <Link href="/approvals">Open Approvals</Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
