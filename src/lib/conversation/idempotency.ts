type StoredTurn = {
  role: string;
  content: string;
};

export function reuseUnansweredUserMessage(messages: StoredTurn[], content: string): boolean {
  const last = messages.at(-1);
  return last?.role === "user" && last.content === content;
}
