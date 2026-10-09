/**
 * Single companion intent router. Maps onto the existing consequential gate
 * (AskPath) without a second competing classifier.
 */

export const COMPANION_INTENTS = [
  "QUESTION",
  "NEW_IDEA",
  "PROJECT_DISCOVERY",
  "PROJECT_STATUS",
  "RESEARCH",
  "DECISION",
  "CONSEQUENTIAL_ACTION",
  "CLARIFICATION",
] as const;

export type CompanionIntent = (typeof COMPANION_INTENTS)[number];

/** Existing CEO gate values — keep binary for consequential protections. */
export type AskPath = "SECOND_ME" | "CONSEQUENTIAL";

const NEW_IDEA =
  /\b(i want to (?:build|create|start|make|launch)|i(?:'|’)m (?:thinking about|considering) (?:building|creating|starting)|help me (?:plan|design|scope)|(?:what are|what's|what is) the first steps|first steps(?:\s+for|\s+to)?|idea for|new (?:product|app|website|project)|let(?:'|’)s (?:build|create|start|plan) (?:a|an|the)?)/i;

const PROJECT_STATUS =
  /\b(what(?:'|’)s happening with|what is happening with|status of|how is|how(?:'|’)s|what needs me|what do i need|what(?:'|’)s waiting|waiting on me)\b/i;

const DECISION =
  /\b(should we|do we (?:approve|reject)|decide|confirm (?:whether|if)|make (?:a |the )?decision)\b/i;

const RESEARCH = /\b(compare|research|investigate|look into|versus|vs\.?)\b/i;

const DISCOVERY =
  /\b(what features|what should (?:it|we|the product)|how (?:should|would) (?:it|we)|who is (?:this|it) for|target (?:customer|user)|mvp|discovery|help me plan|plan (?:a|an|the)\s+(?:rental|website|app|product|platform)|(?:draft|show(?:\s+me)?)\s+(?:a |the )?(?:build plan|strategy|architecture|product definition))\b/i;

const CLARIFICATION =
  /^(it(?:'|’)s for|for a client|for myself|yes\.?|no\.?|that one|the second|continue|go on|more|and\b|also\b)/i;

/** True action verbs — not exploratory "I want to build…" or "show me a build plan". */
const CONSEQUENTIAL_VERBS =
  /\b(fix|rebuild|implement|change|modify|update\s+production|deploy|redeploy|publish|release|ship|send|email|message\s+the\s+client|execute|run\s+the\s+pipeline|apply\s+migration|delete|destroy|rollback|fix|create (?:a |the )?(?:build plan|strategy|project|decision|migration)|write (?:the |a )?(?:code|migration)|merge|push to (?:main|production)|save (?:the |a |this )?(?:build plan|strategy|architecture|plan)|persist (?:the |a |this )?(?:build plan|strategy|plan)|store (?:the |a |this )?(?:build plan|strategy|plan)|start building|begin building|start implementing|begin implementing)\b/i;

const QUESTION_MARKERS =
  /^(how|what|why|which|who|when|where|do|does|did|is|are|can|could|should|will|would|tell me|explain|summarize|show me)\b|\?$/i;

function isPureStatusQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (QUESTION_MARKERS.test(trimmed)) {
    if (/^(how|what|why|which|who|when|where)\b/i.test(trimmed)) return true;
    if (/\?\s*$/.test(trimmed)) return true;
  }
  return false;
}

/** Exploratory "build" language is discovery, not execution. */
function isExploratoryBuild(text: string): boolean {
  return /\b(want to build|thinking about building|considering building|build a (?:new )?(?:website|app|product|platform|tool|system)|building a (?:new )?(?:website|app|product))\b/i.test(
    text,
  );
}

export function classifyCompanionIntent(message: string): CompanionIntent {
  const text = message.trim();
  if (!text) return "QUESTION";

  if (NEW_IDEA.test(text) || isExploratoryBuild(text)) {
    return "NEW_IDEA";
  }

  // Drafting is discovery — creating/modifying records remains consequential.
  if (DISCOVERY.test(text)) {
    return "PROJECT_DISCOVERY";
  }

  if (CONSEQUENTIAL_VERBS.test(text) && !isPureStatusQuestion(text) && !isExploratoryBuild(text)) {
    return "CONSEQUENTIAL_ACTION";
  }

  if (CLARIFICATION.test(text) && text.length < 120) {
    return "CLARIFICATION";
  }

  if (PROJECT_STATUS.test(text)) {
    return "PROJECT_STATUS";
  }

  if (DECISION.test(text)) {
    return "DECISION";
  }

  if (RESEARCH.test(text)) {
    return "RESEARCH";
  }

  if (isPureStatusQuestion(text) || QUESTION_MARKERS.test(text)) {
    return "QUESTION";
  }

  return "QUESTION";
}

/** Compatibility with existing AskPath / consequential gate. */
export function classifyFounderAsk(message: string): AskPath {
  return classifyCompanionIntent(message) === "CONSEQUENTIAL_ACTION" ? "CONSEQUENTIAL" : "SECOND_ME";
}

export function askPathFromIntent(intent: CompanionIntent): AskPath {
  return intent === "CONSEQUENTIAL_ACTION" ? "CONSEQUENTIAL" : "SECOND_ME";
}
