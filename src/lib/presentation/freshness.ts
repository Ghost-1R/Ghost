import type { EvidenceRecord, PresentationReview } from "./types";

export type Freshness = "fresh" | "stale";

export function evidenceFreshness(
  row: Pick<EvidenceRecord, "commitSha" | "treeHash">,
  current: { commitSha: string; treeHash: string },
): Freshness {
  if (row.commitSha === current.commitSha && row.treeHash === current.treeHash) {
    return "fresh";
  }
  return "stale";
}

export function reviewFreshness(
  review: Pick<PresentationReview, "commitSha" | "treeHash">,
  current: { commitSha: string; treeHash: string },
): Freshness {
  return evidenceFreshness(review, current);
}
