import Link from "next/link";
import { EmptyState } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTimestamp } from "@/lib/format";
import {
  formatEvidenceLine,
  operationalStateLabel,
  summarizeProjectTruth,
  type ProjectTruthSnapshot,
} from "@/lib/project-truth";

export function ProjectTruthPanel({
  snapshot,
  title = "Project Truth",
  deployHref,
}: {
  snapshot: ProjectTruthSnapshot;
  title?: string;
  deployHref?: string;
}) {
  const summary = summarizeProjectTruth(snapshot);
  const historyHref = deployHref ?? `/projects/${snapshot.projectId}/deploy`;

  return (
    <section className="project-truth" aria-labelledby="project-truth-heading">
      <div className="project-truth-head">
        <h2 id="project-truth-heading">{title}</h2>
        <StatusBadge status={snapshot.overallState} />
      </div>
      <p className="project-truth-headline">{summary.headline}</p>
      {summary.unknownNotice ? <p className="quiet">{summary.unknownNotice}</p> : null}

      <ul className="meta project-truth-facets">
        <li>
          Deployment: {operationalStateLabel(snapshot.deployment.state)} — {summary.deploymentLine}
        </li>
        <li>
          Local verification: {operationalStateLabel(snapshot.verification.state)} —{" "}
          {summary.verificationLine}
        </li>
        <li>
          Next:{" "}
          {summary.nextLine ??
            "No higher-priority action derived from recorded evidence."}
        </li>
      </ul>

      {snapshot.blockers.length > 0 ? (
        <div className="project-truth-block">
          <h3>Blocked</h3>
          <ul className="ghost-home-rail-list">
            {snapshot.blockers.slice(0, 5).map((blocker) => (
              <li key={blocker.id}>
                <p>{blocker.title}</p>
                <Link href={blocker.href}>Open project</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {snapshot.openDecisions.length > 0 ? (
        <div className="project-truth-block">
          <h3>Needs founder approval</h3>
          <ul className="ghost-home-rail-list">
            {snapshot.openDecisions.slice(0, 5).map((decision) => (
              <li key={decision.id}>
                <p>{decision.title}</p>
                <Link href={decision.href}>Review decision</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {snapshot.currentFailures.length > 0 ? (
        <div className="project-truth-block">
          <h3>Current deployment failures</h3>
          <ul className="meta">
            {snapshot.currentFailures.slice(0, 5).map((row) => (
              <li key={row.id}>
                {row.humanId ?? row.id} failed
                {row.createdAt ? ` · ${formatTimestamp(row.createdAt)}` : ""}
                {row.failureReason ? ` — ${row.failureReason}` : ""}
              </li>
            ))}
          </ul>
          <Link href={historyHref}>Open deployment history</Link>
        </div>
      ) : null}

      {snapshot.historicalFailures.length > 0 ? (
        <details className="project-truth-history">
          <summary>
            Historical failures ({snapshot.historicalFailures.length}) — superseded, still visible
          </summary>
          <ul className="meta">
            {snapshot.historicalFailures.slice(0, 8).map((row) => (
              <li key={row.id}>
                {row.humanId ?? row.id} SUPERSEDED
                {row.supersededById ? ` by ${row.supersededById.slice(0, 8)}` : ""}
                {row.createdAt ? ` · ${formatTimestamp(row.createdAt)}` : ""}
              </li>
            ))}
          </ul>
          <Link href={historyHref}>Full deployment history</Link>
        </details>
      ) : null}

      {snapshot.evidence.length > 0 ? (
        <details className="project-truth-history">
          <summary>Supporting evidence ({snapshot.evidence.length})</summary>
          <ul className="meta">
            {snapshot.evidence.slice(0, 8).map((item, index) => (
              <li key={`${item.reference}-${index}`}>{formatEvidenceLine(item)}</li>
            ))}
          </ul>
        </details>
      ) : (
        <EmptyState>No supporting evidence rows are attached yet.</EmptyState>
      )}
    </section>
  );
}
