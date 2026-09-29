export type MemoryIntent =
  | { kind: "none" }
  | { kind: "ask-scope"; content: string }
  | { kind: "propose"; scope: "FOUNDER_RULE" | "PROJECT_KNOWLEDGE"; content: string };

const COMMAND = /^(?:please\s+)?(?:remember that|remember this|make this a rule)\b[:\s-]*(.*)$/i;
const FOUNDER_WIDE = /\b(any project|all projects|every project|for any of my projects|founder rule)\b/i;

export function detectMemoryIntent(message: string, projectName: string | null): MemoryIntent {
  const match = message.trim().match(COMMAND);
  if (!match) {
    return { kind: "none" };
  }

  const content = (match[1] ?? "").trim();
  if (!content) {
    return { kind: "ask-scope", content: message.trim() };
  }

  if (FOUNDER_WIDE.test(content) || FOUNDER_WIDE.test(message)) {
    return { kind: "propose", scope: "FOUNDER_RULE", content };
  }

  const namedProject = projectName ? content.toLocaleLowerCase().includes(projectName.toLocaleLowerCase()) : false;
  if (namedProject || /\bthis project\b/i.test(content)) {
    return { kind: "propose", scope: "PROJECT_KNOWLEDGE", content };
  }

  return { kind: "ask-scope", content };
}
