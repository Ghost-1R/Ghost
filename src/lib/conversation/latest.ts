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
  /** Isolates this exchange from older turns in long threads. */
  exchangeKey: string | null;
};

export function latestExchange<T extends Turn>(messages: readonly T[], pendingQuestion: string | null): LatestExchange<T> {
  if (pendingQuestion) {
    return {
      ask: pendingQuestion,
      answer: null,
      thinking: true,
      unanswered: false,
      exchangeKey: `pending:${pendingQuestion.slice(0, 64)}`,
    };
  }
  const last = messages.at(-1);
  if (last?.role === "user") {
    const id = "id" in last && typeof (last as { id?: unknown }).id === "string" ? (last as { id: string }).id : "user";
    return {
      ask: last.content,
      answer: null,
      thinking: false,
      unanswered: true,
      exchangeKey: `unanswered:${id}`,
    };
  }
  let answerIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      answerIndex = index;
      break;
    }
  }
  if (answerIndex < 0) {
    return { ask: null, answer: null, thinking: false, unanswered: false, exchangeKey: null };
  }
  let ask: string | null = null;
  let askIndex = -1;
  for (let index = answerIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      ask = messages[index].content;
      askIndex = index;
      break;
    }
  }
  const answer = messages[answerIndex];
  const answerId = "id" in answer && typeof (answer as { id?: unknown }).id === "string" ? (answer as { id: string }).id : String(answerIndex);
  return {
    ask,
    answer,
    thinking: false,
    unanswered: false,
    exchangeKey: `exchange:${askIndex}:${answerId}`,
  };
}

export function isLongAnswer(content: string): boolean {
  const answer = splitAnswer(content).answer;
  return answer.length > LONG_ANSWER_CHARS || answer.split("\n").length > LONG_ANSWER_LINES;
}
