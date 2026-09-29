import type {
  BrainAction,
  BrainBlocker,
  BrainMilestone,
  BrainProject,
  BrainProjectSummary,
  BrainRule,
  BrainText,
  BrainVerification,
  GhostContext,
} from "./types";
import { displayVerificationState, isSupportedVerified } from "./verification";

const LIMIT = 20;

type ProjectInput = {
  project: BrainProject;
  milestones: BrainMilestone[];
  knowledge: Array<BrainText & { kind: string }>;
  blockers: BrainBlocker[];
  nextActions: BrainAction[];
  verification: BrainVerification[];
  founderRules: BrainRule[];
};

function take<T>(items: T[], truncated: { value: boolean }): T[] {
  if (items.length > LIMIT) {
    truncated.value = true;
    return items.slice(0, LIMIT);
  }

  return items;
}

function currentMilestone(project: BrainProject, milestones: BrainMilestone[]): BrainMilestone | null {
  const named = milestones.find((milestone) => milestone.title === project.currentMilestone);
  return named ?? milestones[0] ?? null;
}

export function assembleProjectContext(input: ProjectInput): GhostContext {
  const truncated = { value: false };
  const openBlockers = input.blockers.filter((blocker) => blocker.status === "OPEN");
  const openActions = input.nextActions
    .filter((action) => action.status === "OPEN")
    .sort((left, right) => left.position - right.position);

  return {
    scope: "project",
    project: input.project,
    projects: [],
    milestone: currentMilestone(input.project, input.milestones),
    requirements: take(
      input.knowledge.filter((item) => item.kind === "REQUIREMENT").map(({ title, content }) => ({ title, content })),
      truncated,
    ),
    decisions: take(
      input.knowledge.filter((item) => item.kind === "DECISION").map(({ title, content }) => ({ title, content })),
      truncated,
    ),
    constraints: take(
      input.knowledge.filter((item) => item.kind === "CONSTRAINT").map(({ title, content }) => ({ title, content })),
      truncated,
    ),
    blockers: take(
      openBlockers.map(({ title, description }) => ({ title, content: description })),
      truncated,
    ),
    nextActions: take(
      openActions.map(({ title, description }) => ({ title, content: description })),
      truncated,
    ),
    verification: take(
      input.verification.map((record) => ({
        category: record.category,
        target: record.target,
        state: displayVerificationState(record),
        supported: isSupportedVerified(record),
        checkedAt: record.checkedAt,
      })),
      truncated,
    ),
    founderRules: take(
      input.founderRules
        .filter((rule) => rule.status === "ACTIVE")
        .map(({ id, title, content }) => ({ id, title, content })),
      truncated,
    ),
    truncated: truncated.value,
  };
}

export function assembleGlobalContext(input: {
  projects: BrainProjectSummary[];
  founderRules: BrainRule[];
}): GhostContext {
  const truncated = { value: false };

  return {
    scope: "global",
    project: null,
    projects: take(input.projects, truncated),
    milestone: null,
    requirements: [],
    decisions: [],
    constraints: [],
    blockers: [],
    nextActions: [],
    verification: [],
    founderRules: take(
      input.founderRules
        .filter((rule) => rule.status === "ACTIVE")
        .map(({ id, title, content }) => ({ id, title, content })),
      truncated,
    ),
    truncated: truncated.value,
  };
}

export function resolveProjectMention(
  message: string,
  projects: Array<{ id: string; name: string }>,
): { kind: "none" } | { kind: "one"; id: string } | { kind: "many"; ids: string[] } {
  const haystack = message.toLocaleLowerCase();
  const matches = projects
    .filter((project) => project.name.trim().length > 0 && haystack.includes(project.name.toLocaleLowerCase()))
    .sort((left, right) => right.name.length - left.name.length);

  if (matches.length === 0) {
    return { kind: "none" };
  }

  const longest = matches[0]?.name.length ?? 0;
  const top = matches.filter((project) => project.name.length === longest);
  if (top.length === 1) {
    return { kind: "one", id: top[0].id };
  }

  return { kind: "many", ids: top.map((project) => project.id) };
}
