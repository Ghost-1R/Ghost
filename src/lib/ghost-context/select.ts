const STOP_WORDS = new Set([
  "the",
  "and",
  "our",
  "what",
  "are",
  "was",
  "you",
  "for",
  "this",
  "that",
  "with",
  "from",
  "just",
  "because",
  "should",
  "have",
  "has",
  "been",
  "not",
  "but",
  "its",
  "your",
  "about",
  "into",
  "how",
  "why",
  "who",
  "when",
  "where",
  "which",
  "does",
  "did",
  "can",
  "will",
  "would",
  "could",
  "please",
  "tell",
  "say",
]);

export function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

export function relevanceScore(question: string, title: string, content: string): number {
  const wanted = new Set(tokens(question));
  if (wanted.size === 0) {
    return 0;
  }

  let score = 0;
  for (const word of tokens(`${title} ${content}`)) {
    if (wanted.has(word)) {
      score += 1;
    }
  }

  return score;
}
