export const PATTERN_STATUSES = ["DRAFT", "APPROVED", "RETIRED"] as const;

export type PatternStatus = (typeof PATTERN_STATUSES)[number];

export type PatternRecord = {
  id: string;
  name: string;
  purpose: string;
  useWhen: string;
  doNotUseWhen: string;
  preconditions: string;
  implementation: string;
  verification: string;
  risks: string;
  provenance: string;
  status: PatternStatus;
};

function section(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    return "";
  }
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    body.push(line);
  }
  return body.join("\n").trim();
}

export function parsePattern(id: string, markdown: string): PatternRecord {
  const name = markdown.match(/^# (.+)$/m)?.[1]?.trim() ?? id;
  const statusText = section(markdown, "Status").toUpperCase();
  const status = PATTERN_STATUSES.find((value) => statusText.includes(value)) ?? "DRAFT";
  return {
    id,
    name,
    purpose: section(markdown, "Purpose"),
    useWhen: section(markdown, "Use When"),
    doNotUseWhen: section(markdown, "Do Not Use When"),
    preconditions: section(markdown, "Preconditions"),
    implementation: section(markdown, "Implementation"),
    verification: section(markdown, "Verification"),
    risks: section(markdown, "Risks"),
    provenance: section(markdown, "Provenance"),
    status,
  };
}
