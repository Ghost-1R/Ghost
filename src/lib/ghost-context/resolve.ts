import type { ProjectName } from "./types";

export type ProjectResolution =
  | { kind: "locked"; id: string }
  | { kind: "one"; id: string }
  | { kind: "ambiguous"; names: string[] }
  | { kind: "unknown"; name: string }
  | { kind: "global" };

const GENERIC_TARGET = new Set(["us", "me", "it", "this", "that", "the project"]);

export function normalizeName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveAuthorizedProject(input: {
  message: string;
  lockedProjectId: string | null;
  projects: ProjectName[];
}): ProjectResolution {
  if (input.lockedProjectId) {
    return { kind: "locked", id: input.lockedProjectId };
  }

  const named = input.message.match(/\b(?:blocking|about)\s+([a-z0-9][a-z0-9 .'-]{1,80})/i);
  if (named?.[1]) {
    const target = named[1].replace(/[?.!]+$/g, "").trim();
    const normalizedTarget = normalizeName(target);
    if (GENERIC_TARGET.has(normalizedTarget)) {
      return { kind: "global" };
    }

    const exact = input.projects.filter((project) => normalizeName(project.name) === normalizedTarget);
    if (exact.length === 1) {
      return { kind: "one", id: exact[0].id };
    }
    if (exact.length > 1) {
      return { kind: "ambiguous", names: exact.map((project) => project.name) };
    }
    return { kind: "unknown", name: target };
  }

  const haystack = normalizeName(input.message);
  const matches = input.projects.filter((project) => {
    const name = normalizeName(project.name);
    return name.length > 0 && haystack.includes(name);
  });

  if (matches.length > 0) {
    const longest = matches.reduce((best, project) => Math.max(best, normalizeName(project.name).length), 0);
    const top = matches.filter((project) => normalizeName(project.name).length === longest);
    if (top.length > 1) {
      return { kind: "ambiguous", names: top.map((project) => project.name) };
    }
    return { kind: "one", id: top[0]?.id ?? matches[0].id };
  }

  return { kind: "global" };
}
