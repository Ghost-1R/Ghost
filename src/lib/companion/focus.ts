import { normalizeName } from "@/lib/ghost-context/resolve";
import { tokens } from "@/lib/ghost-context/select";
import type { CompanionIntent } from "./intent";

export type ProjectFocus =
  | { kind: "none" }
  | { kind: "new_proposal"; label: string }
  | { kind: "one"; id: string; name: string }
  | { kind: "several"; projects: Array<{ id: string; name: string }> };

export type NamedProject = { id: string; name: string };

function mentionedProjects(message: string, projects: NamedProject[], mode: "longest" | "all" = "longest"): NamedProject[] {
  const haystack = normalizeName(message);
  const matches = projects.filter((project) => {
    const name = normalizeName(project.name);
    return name.length > 0 && haystack.includes(name);
  });
  if (matches.length === 0) return [];
  if (mode === "all") {
    // Prefer longer names when one name is a substring of another, but keep distinct projects.
    return matches.filter((project) => {
      const name = normalizeName(project.name);
      return !matches.some(
        (other) => other.id !== project.id && normalizeName(other.name).includes(name) && normalizeName(other.name).length > name.length,
      );
    });
  }
  const longest = matches.reduce((best, project) => Math.max(best, normalizeName(project.name).length), 0);
  return matches.filter((project) => normalizeName(project.name).length === longest);
}

function ideaLabel(message: string): string {
  const match =
    message.match(/\b(?:build|create|start|make|launch)\s+(?:a|an|the)?\s*(.+?)(?:\.|$)/i) ??
    message.match(/\bidea for\s+(.+?)(?:\.|$)/i);
  const raw = (match?.[1] ?? message).trim().replace(/[?.!]+$/, "");
  return raw.slice(0, 80) || "new product idea";
}

/**
 * Resolve what the founder is talking about.
 * Explicit project names beat stale conversation association.
 * Exploratory new ideas unlock a stale project page lock when no project is named.
 */
export function resolveProjectFocus(input: {
  message: string;
  intent: CompanionIntent;
  projects: NamedProject[];
  lockedProjectId: string | null;
}): ProjectFocus {
  const named =
    input.intent === "RESEARCH"
      ? mentionedProjects(input.message, input.projects, "all")
      : mentionedProjects(input.message, input.projects);

  if (named.length === 1) {
    return { kind: "one", id: named[0].id, name: named[0].name };
  }

  if (input.intent === "RESEARCH" && named.length >= 2) {
    return { kind: "several", projects: named };
  }

  if (named.length > 1) {
    return { kind: "several", projects: named };
  }

  // Unnamed exploratory ideas must not inherit an unrelated locked project brain.
  if (input.intent === "NEW_IDEA" || input.intent === "PROJECT_DISCOVERY") {
    return { kind: "new_proposal", label: ideaLabel(input.message) };
  }

  if (input.lockedProjectId) {
    const locked = input.projects.find((project) => project.id === input.lockedProjectId);
    if (locked) return { kind: "one", id: locked.id, name: locked.name };
  }

  return { kind: "none" };
}

/** True when the latest message shares almost no tokens with recent history. */
export function isTopicShift(
  message: string,
  recentMessages: Array<{ role: string; content: string }>,
  knownProjects: NamedProject[],
): boolean {
  if (recentMessages.length === 0) return false;

  const current = new Set(tokens(message));
  if (current.size === 0) return false;

  const namedNow = mentionedProjects(message, knownProjects);
  if (namedNow.length > 0) {
    const recentText = recentMessages
      .slice(-6)
      .map((entry) => entry.content)
      .join(" ");
    const namedInHistory = mentionedProjects(recentText, knownProjects);
    if (namedInHistory.length > 0 && !namedNow.some((project) => namedInHistory.some((prior) => prior.id === project.id))) {
      return true;
    }
  }

  const prior = new Set(
    tokens(
      recentMessages
        .slice(-6)
        .map((entry) => entry.content)
        .join(" "),
    ),
  );
  let overlap = 0;
  for (const word of current) {
    if (prior.has(word)) overlap += 1;
  }
  return overlap / current.size < 0.2;
}
