import { splitAnswer } from "@/lib/conversation/queries";

export const READY_HOLD_MS = 2400;
const LONG_ANSWER_CHARS = 700;
const LONG_ANSWER_LINES = 14;

type Turn = { role: string; content: string };

export type LatestExchange<T extends Turn> = {
  ask: string | null;
  answer: T | null;
  thinking: boolean;
  unanswered: boolean;
};

export function latestExchange<T extends Turn>(messages: readonly T[], pendingQuestion: string | null): LatestExchange<T> {
  if (pendingQuestion) {
    return { ask: pendingQuestion, answer: null, thinking: true, unanswered: false };
  }
  const last = messages.at(-1);
  if (last?.role === "user") {
    return { ask: last.content, answer: null, thinking: false, unanswered: true };
  }
  let answerIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      answerIndex = index;
      break;
    }
  }
  if (answerIndex < 0) {
    return { ask: null, answer: null, thinking: false, unanswered: false };
  }
  let ask: string | null = null;
  for (let index = answerIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      ask = messages[index].content;
      break;
    }
  }
  return { ask, answer: messages[answerIndex], thinking: false, unanswered: false };
}

export function isLongAnswer(content: string): boolean {
  const answer = splitAnswer(content).answer;
  return answer.length > LONG_ANSWER_CHARS || answer.split("\n").length > LONG_ANSWER_LINES;
}
