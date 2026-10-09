import { tokens } from "@/lib/ghost-context/select";
import type { ContextItem } from "@/lib/ghost-context/types";
import type { CompanionIntent } from "./intent";
import type { ProjectFocus } from "./focus";

type ProjectSummaryInput = {
  id: string;
  name: string;
  status: string;
  currentMilestone: string;
  openBlockers: number;
  nextAction: string | null;
};

/**
 * Filter global project summaries so unrelated projects do not dominate.
 * Attention questions still surface blockers; new ideas do not.
 */
export function selectCompanionProjectItems(input: {
  question: string;
  intent: CompanionIntent;
  focus: ProjectFocus;
  projects: ProjectSummaryInput[];
}): ContextItem[] {
  const { question, intent, focus, projects } = input;
  const attention = intent === "PROJECT_STATUS" && /\b(needs me|waiting|blocking|attention)\b/i.test(question);
  const wanted = new Set(tokens(question));

  const allowedIds = new Set(
    focus.kind === "one"
      ? [focus.id]
      : focus.kind === "several"
        ? focus.projects.map((project) => project.id)
        : [],
  );

  const exploration = intent === "NEW_IDEA" || focus.kind === "new_proposal" || intent === "PROJECT_DISCOVERY";

  return projects
    .filter((project) => {
      if (allowedIds.size > 0) return allowedIds.has(project.id);
      if (exploration) {
        // Only include a project if the founder actually named it.
        return false;
      }
      if (attention) {
        return project.openBlockers > 0 || Boolean(project.nextAction);
      }
      if (intent === "RESEARCH") {
        const nameTokens = tokens(project.name);
        return nameTokens.some((word) => wanted.has(word));
      }
      // Generic questions: include lightly, but do not force-keep every project.
      const nameTokens = tokens(project.name);
      const nameHit = nameTokens.some((word) => wanted.has(word));
      return nameHit || project.openBlockers > 0;
    })
    .map((project) => {
      const forceKeep =
        allowedIds.has(project.id) ||
        (attention && (project.openBlockers > 0 || Boolean(project.nextAction)));
      const nameTokens = tokens(project.name);
      let relevance = nameTokens.reduce((sum, word) => sum + (wanted.has(word) ? 2 : 0), 0);
      if (project.openBlockers > 0) relevance += 1;
      if (forceKeep) relevance = Math.max(relevance, 1);

      return {
        id: project.id,
        type: "project_summary" as const,
        authority: "PROJECT_STATE" as const,
        sourceTable: "projects",
        sourceId: project.id,
        projectId: project.id,
        title: project.name,
        content: `${project.currentMilestone}. Open blockers: ${project.openBlockers}. Next action: ${project.nextAction ?? "none"}.`,
        status: project.status,
        relevance,
        keep: forceKeep,
        selectedBecause: forceKeep
          ? "Selected because it matches the active project focus or attention question."
          : "Optional project summary; included only when relevant to the question.",
      };
    });
}
