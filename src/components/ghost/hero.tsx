import Link from "next/link";
import { CoreStateLabel, GhostCore } from "@/components/ghost/experience";
import { OS_PIPELINE_STAGES, type OsPipelineStageId } from "@/lib/dashboard/os";

export function DashboardHero({
  activeStageId,
  askHref = "#ask-ghost",
}: {
  activeStageId?: OsPipelineStageId | null;
  askHref?: string;
}) {
  return (
    <section className="os-hero" aria-labelledby="hero-title">
      <div className="os-hero-main">
        <p className="eyebrow">Welcome back</p>
        <h1 className="os-hero-title" id="hero-title">
          Ghost is your
          <span className="os-hero-brand">
            <GhostCore size="title" />
            second mind
          </span>
          for building and operating projects.
        </h1>
        <p className="os-hero-lede">
          Keep the real state of your projects, make better decisions, and move from idea to production with clarity.
        </p>
        <div className="os-hero-actions">
          <a className="button" href={askHref}>
            Ask Ghost Anything
          </a>
          <Link className="button-secondary" href="/projects/new">
            New Project
          </Link>
        </div>
        <p className="hero-status">
          Core <CoreStateLabel />
        </p>
      </div>
      <aside className="os-hero-pipeline" aria-label="Ghost operating pipeline">
        <p className="eyebrow">Pipeline</p>
        <ol className="os-pipeline-vertical">
          {OS_PIPELINE_STAGES.map((stage) => (
            <li key={stage.id} data-active={activeStageId === stage.id ? "true" : "false"}>
              <span className="os-pipeline-dot" aria-hidden="true" />
              <span>
                <strong>{stage.label}</strong>
                <em>{stage.subtitle}</em>
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </section>
  );
}
