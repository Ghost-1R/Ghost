import { boundConversation, HISTORY_CHAR_BUDGET, HISTORY_MESSAGE_LIMIT } from "@/lib/ghost-context/budget";
import type { CompanionIntent } from "./intent";
import { isTopicShift, type NamedProject, type ProjectFocus } from "./focus";

/**
 * Bound history for companion replies.
 * On topic shift / new idea, do not carry unrelated prior exchanges into the model.
 */
export function boundCompanionHistory<T extends { role: string; content: string }>(input: {
  messages: T[];
  intent: CompanionIntent;
  focus: ProjectFocus;
  projects: NamedProject[];
  limit?: number;
  maxChars?: number;
}): T[] {
  const { messages, intent, focus, projects } = input;
  const latest = messages.at(-1);
  if (!latest) return [];

  const prior = messages.slice(0, -1);
  const shift = isTopicShift(latest.content, prior, projects);

  if (intent === "NEW_IDEA" || (focus.kind === "new_proposal" && shift)) {
    return [latest];
  }

  if (shift && (intent === "QUESTION" || intent === "PROJECT_STATUS" || intent === "RESEARCH")) {
    // Keep only the current ask — prior thread was a different topic.
    return [latest];
  }

  if (intent === "CLARIFICATION" || intent === "PROJECT_DISCOVERY") {
    // Keep a short recent window so follow-ups stay coherent.
    return boundConversation(messages, Math.min(4, input.limit ?? HISTORY_MESSAGE_LIMIT), input.maxChars ?? HISTORY_CHAR_BUDGET);
  }

  return boundConversation(messages, input.limit ?? HISTORY_MESSAGE_LIMIT, input.maxChars ?? HISTORY_CHAR_BUDGET);
}
