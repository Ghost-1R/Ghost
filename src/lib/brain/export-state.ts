import type { GhostContext } from "./types";

export function exportProjectState(context: GhostContext): { markdown: string; json: string } {
  const project = context.project;
  const lines = [
    "# Project state export",
    "",
    "This preview was generated from the database Project Brain. It does not write repository files.",
    "",
    "## Project",
    "",
    project?.name ?? "Unknown",
    "",
    "## Status",
    "",
    project?.status ?? "Unknown",
    "",
    "## Current Milestone",
    "",
    context.milestone?.title ?? project?.currentMilestone ?? "Unknown",
    "",
    "## Requirements",
    "",
    ...context.requirements.map((item) => `- ${item.title}`),
    "",
    "## Decisions",
    "",
    ...context.decisions.map((item) => `- ${item.title}`),
    "",
    "## Open blockers",
    "",
    ...context.blockers.map((item) => `- ${item.title}`),
    "",
    "## Next actions",
    "",
    ...context.nextActions.map((item) => `- ${item.title}`),
    "",
    "## Verification",
    "",
    ...context.verification.map((item) => `- ${item.target}: ${item.state}`),
    "",
  ];

  return {
    markdown: lines.join("\n"),
    json: JSON.stringify(
      {
        project: context.project,
        milestone: context.milestone,
        requirements: context.requirements,
        decisions: context.decisions,
        constraints: context.constraints,
        blockers: context.blockers,
        nextActions: context.nextActions,
        verification: context.verification,
        founderRules: context.founderRules,
      },
      null,
      2,
    ),
  };
}
