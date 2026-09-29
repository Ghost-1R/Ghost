export type MemoryIntent =
  | { kind: "none" }
  | { kind: "ask-scope"; content: string }
  | { kind: "propose"; scope: "FOUNDER_RULE" | "PROJECT_KNOWLEDGE"; content: string }
  | { kind: "where"; content: string }
  | { kind: "why" }
  | { kind: "retire"; target: string }
  | { kind: "correct" };

const COMMAND =
  /^(?:please\s+)?(?:remember that|remember this rule|remember this|make this a rule)\b[:\s-]*(.*)$/i;
const FOUNDER_WIDE = /\b(any project|all projects|every project|for any of my projects|founder rule|i want|this rule)\b/i;
const WHERE = /^where did you learn\b[:\s-]*(.*)$/i;
const WHY = /^(?:why\??|why did you\b.*)$/i;
const RETIRE = /^(?:please\s+)?retire(?:\s+rule)?\b[:\s-]*(.*)$/i;
const CORRECT =
  /\b(that rule is wrong|stop using that rule|don't use that rule anymore|do not use that rule anymore|i don't do that anymore|i do not do that anymore)\b/i;

function projectTarget(content: string, projectName: string | null): boolean {
  if (/\bthis project\b/i.test(content)) {
    return true;
  }
  if (!projectName) {
    return false;
  }
  const name = projectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b(?:for|about|on)\\s+${name}\\b|\\b${name}\\s+(?:must|cannot|can not|should not)\\b`, "i");
  return pattern.test(content);
}

export function detectMemoryIntent(message: string, projectName: string | null): MemoryIntent {
  const trimmed = message.trim();
  const where = trimmed.match(WHERE);
  if (where) {
    return { kind: "where", content: (where[1] ?? "").trim() || trimmed };
  }
  if (WHY.test(trimmed)) {
    return { kind: "why" };
  }
  const retire = trimmed.match(RETIRE);
  if (retire) {
    return { kind: "retire", target: (retire[1] ?? "").trim() };
  }
  if (CORRECT.test(trimmed)) {
    return { kind: "correct" };
  }

  const match = trimmed.match(COMMAND);
  if (!match) {
    return { kind: "none" };
  }

  const content = (match[1] ?? "").trim().replace(/^rule\b[:\s-]*/i, "");
  if (!content) {
    return { kind: "ask-scope", content: trimmed };
  }

  if (projectTarget(content, projectName)) {
    return { kind: "propose", scope: "PROJECT_KNOWLEDGE", content };
  }

  if (FOUNDER_WIDE.test(content) || FOUNDER_WIDE.test(trimmed)) {
    return { kind: "propose", scope: "FOUNDER_RULE", content };
  }

  return { kind: "ask-scope", content };
}
