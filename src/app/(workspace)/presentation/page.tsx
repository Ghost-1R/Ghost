import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState, Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSession } from "@/lib/auth/session";
import { listReviews, presentationRoot } from "@/lib/presentation/ledger";
import { presentationCoreState } from "@/lib/experience/core-state";
import { reviewFreshness } from "@/lib/presentation/freshness";
import { hashWorkingTree } from "@/lib/presentation/tree";
import { loadRecordedReview } from "@/lib/presentation/recorded";
import { HOSTED_REVIEW_REFUSAL, isHostedRuntime, releaseCommit } from "@/lib/inspector/runtime";
import { loadProjectSummaries } from "@/lib/projects/queries";
import { CoreSignal } from "@/components/ghost/experience";
import { PresentationReviewForm } from "./presentation-actions";

export const metadata: Metadata = {
  title: "Presentation",
};

export default async function PresentationPage() {
  const session = await getSession();
  if (session.status !== "authenticated") {
    redirect("/login");
  }
  const hosted = isHostedRuntime();
  const [projects, reviews, tree, deployed] = await Promise.all([
    loadProjectSummaries(session.supabase),
    hosted ? Promise.resolve([]) : listReviews(presentationRoot(), session.user.id),
    hosted ? Promise.resolve(null) : hashWorkingTree(process.cwd()),
    hosted ? releaseCommit() : Promise.resolve(null),
  ]);
  const ghost = projects.status === "ok" ? projects.data.find((project) => project.name.toLocaleLowerCase() === "ghost") : null;
  const latest = !ghost
    ? null
    : hosted
      ? await loadRecordedReview(session.supabase, session.user.id, ghost.id, "production")
      : reviews.filter((review) => review.projectId === ghost.id).at(-1) ?? null;
  const freshness = !latest ? null : tree ? reviewFreshness(latest, tree) : latest.commitSha === deployed ? "fresh" : "stale";
  const coreState = presentationCoreState(latest?.result ?? null, freshness);

  return (
    <div className="stack">
      <CoreSignal state={coreState} />
      <div className="page-head">
        <div>
          <p className="eyebrow">Presentation</p>
          <h1>Done is not client ready.</h1>
        </div>
      </div>
      <Panel title="Pre-presentation review">
        <p className="quiet">
          The result is derived from evidence, requirements, and findings. A completed build does not create READY.
          Production is not claimed from a local build.
        </p>
        {!ghost ? (
          <p className="notice">No visible GHOST project.</p>
        ) : hosted ? (
          <p className="notice">{HOSTED_REVIEW_REFUSAL}</p>
        ) : (
          <PresentationReviewForm projectId={ghost.id} />
        )}
      </Panel>
      {!latest ? <EmptyState>No presentation review has been recorded.</EmptyState> : null}
      {latest ? (
        <Panel title="Latest review">
          <ul className="meta">
            <li>
              <StatusBadge status={latest.result} />
            </li>
            <li>
              {hosted
                ? freshness === "fresh"
                  ? "Fresh for this deployment"
                  : "Historical for an earlier deployment"
                : freshness === "fresh"
                  ? "Fresh for this tree"
                  : "Historical for an earlier tree"}
            </li>
            <li>Environment {latest.environment}</li>
            <li>Commit {latest.commitSha.slice(0, 7)}</li>
            <li>Checked {latest.createdAt}</li>
          </ul>
          {latest.traceability.some((row) => row.status === "FUTURE_SCOPE") ? (
            <ul>
              {latest.traceability
                .filter((row) => row.status === "FUTURE_SCOPE")
                .map((row) => (
                  <li key={row.requirement}>Future scope: {row.requirement}</li>
                ))}
            </ul>
          ) : null}
          {latest.gaps.length === 0 ? <p>No gaps recorded.</p> : null}
          {latest.gaps.length > 0 ? (
            <ul>
              {latest.gaps.slice(0, 12).map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          ) : null}
          {latest.result === "READY" && freshness === "fresh" ? (
            <p>A customer handoff can be prepared from this review.</p>
          ) : (
            <p>A customer handoff is withheld until the current tree is READY.</p>
          )}
        </Panel>
      ) : null}
      {latest && latest.fixQueue.length > 0 ? (
        <Panel title="Fix queue">
          <ul>
            {latest.fixQueue.slice(0, 8).map((finding) => (
              <li key={`${finding.severity}-${finding.description}`}>
                {finding.severity}: {finding.description} Fix: {finding.recommendedFix}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
