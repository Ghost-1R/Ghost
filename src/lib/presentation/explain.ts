import { reviewFreshness } from "./freshness";
import type { PresentationReview } from "./types";

export function presentationQuestion(message: string): boolean {
  return /ready to show the customer/i.test(message.trim());
}

export function explainPresentation(input: {
  review: PresentationReview | null;
  current: { commitSha: string; treeHash: string };
}): { text: string; title: string } {
  if (!input.review) {
    return {
      title: "No presentation review",
      text: "This has not been verified as presentation-ready. No completed pre-presentation review exists. I will not guess.",
    };
  }
  const freshness = reviewFreshness(input.review, input.current);
  if (freshness === "stale") {
    return {
      title: `Presentation review ${input.review.commitSha.slice(0, 7)}`,
      text: `The latest pre-presentation review is historical for commit ${input.review.commitSha.slice(0, 7)}. The current tree is different, so that review does not make this code presentation-ready.`,
    };
  }
  const next = input.review.fixQueue[0];
  const gapText = input.review.gaps.slice(0, 6).join("; ");
  return {
    title: `Presentation review ${input.review.result}`,
    text: `PRESENTATION REVIEW. Result: ${input.review.result}. Commit ${input.review.commitSha.slice(0, 7)}. Environment ${input.review.environment}. Checked ${input.review.createdAt}. ${gapText || "No gaps recorded."}${next ? ` Next fix: ${next.recommendedFix}` : ""}`,
  };
}
