import type { DriftReport, StateSnapshot } from "./types";

function normalize(value: string | null): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.toLocaleLowerCase();
}

function sectionValue(markdown: string, heading: string): string | null {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const match = pattern.exec(markdown);
  if (!match) {
    return null;
  }

  const rest = markdown.slice(match.index + match[0].length);
  for (const line of rest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      return null;
    }
    return trimmed;
  }

  return null;
}

function labeledValue(markdown: string, label: string): string | null {
  const pattern = new RegExp(`^${label}:\\s*(.*)$`, "im");
  const match = pattern.exec(markdown);
  if (!match) {
    return null;
  }

  if (match[1].trim()) {
    return match[1].trim();
  }

  const rest = markdown.slice(match.index + match[0].length);
  for (const line of rest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      return null;
    }
    return trimmed;
  }

  return null;
}

export function parseGhostMarkdown(markdown: string): StateSnapshot {
  return {
    milestone: sectionValue(markdown, "Current Milestone"),
    status: sectionValue(markdown, "Status"),
    production: labeledValue(markdown, "Production"),
  };
}

export function detectStateDrift(repository: StateSnapshot, database: StateSnapshot): DriftReport {
  const fields = (["milestone", "status", "production"] as const).flatMap((field) => {
    const left = normalize(repository[field]);
    const right = normalize(database[field]);
    if (left === right) {
      return [];
    }

    return [
      {
        field,
        repository: repository[field]?.trim() || null,
        database: database[field]?.trim() || null,
      },
    ];
  });

  return { drifted: fields.length > 0, fields };
}
