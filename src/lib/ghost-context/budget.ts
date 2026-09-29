import { authorityRank } from "./authority";
import type { ContextItem } from "./types";

export const CONTEXT_CHAR_BUDGET = 7000;
export const HISTORY_MESSAGE_LIMIT = 8;
export const HISTORY_CHAR_BUDGET = 3500;

export function applyBudget(items: ContextItem[], budgetChars = CONTEXT_CHAR_BUDGET): ContextItem[] {
  const kept = items.filter((item) => item.keep);
  const optional = items
    .filter((item) => !item.keep)
    .sort((left, right) => {
      const authority = authorityRank(left.authority) - authorityRank(right.authority);
      if (authority !== 0) {
        return authority;
      }
      return right.relevance - left.relevance;
    });

  const selected = [...kept];
  let used = selected.reduce((sum, item) => sum + item.title.length + item.content.length, 0);

  for (const item of optional) {
    const size = item.title.length + item.content.length;
    if (used + size > budgetChars) {
      continue;
    }
    selected.push(item);
    used += size;
  }

  return selected;
}

export function boundConversation<T extends { role: string; content: string }>(
  messages: T[],
  limit = HISTORY_MESSAGE_LIMIT,
  maxChars = HISTORY_CHAR_BUDGET,
): T[] {
  const selected: T[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (selected.length >= limit) {
      break;
    }
    if (selected.length > 0 && used + message.content.length > maxChars) {
      break;
    }
    selected.push(message);
    used += message.content.length;
  }

  return selected.reverse();
}
