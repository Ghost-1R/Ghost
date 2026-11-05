import Link from "next/link";
import { explainArtifactResult } from "@/lib/dashboard/result-labels";

export function ResultExplainCard({
  title,
  content,
  contentSha256,
  kind,
  href,
  projectName,
}: {
  title: string;
  content: string;
  contentSha256?: string | null;
  kind?: string | null;
  href?: string | null;
  projectName?: string | null;
}) {
  const explained = explainArtifactResult({
    title,
    content,
    contentSha256,
    kind,
  });

  return (
    <article
      className="today-result-card"
      data-test-result={explained.isTestResult ? "true" : "false"}
    >
      <div className="today-result-icon" aria-hidden="true">
        {explained.isTestResult ? "✓" : "•"}
      </div>
      <div className="today-result-body">
        <p className="eyebrow">{explained.isTestResult ? "Test result" : "Saved result"}</p>
        <h3>{explained.headline}</h3>
        <p className="today-result-summary">{explained.summary}</p>
        {projectName ? <p className="ceo-project-label">{projectName}</p> : null}
        {href ? (
          <Link className="today-result-open" href={href}>
            Open saved result
          </Link>
        ) : null}
        <details className="today-tech-details">
          <summary>View technical details</summary>
          <pre>{explained.technicalLines.join("\n") || "No technical details recorded."}</pre>
        </details>
      </div>
    </article>
  );
}
