import type { GhostClient } from "@/lib/auth/session";
import { isHostedRuntime, releaseCommit } from "@/lib/inspector/runtime";
import type { QueryResult } from "@/lib/result";
import { reviewFreshness } from "./freshness";
import { listReviews, presentationRoot } from "./ledger";
import { loadRecordedReview } from "./recorded";
import { hashWorkingTree } from "./tree";
import type { PresentationReview } from "./types";

export type PresentationStatus = {
  hosted: boolean;
  review: PresentationReview | null;
  fresh: boolean;
};

// Mirrors the Presentation page: production reads the recorded production review and compares it to the
// deployed commit; a local runtime compares the latest local review to the current working tree.
export async function loadPresentationStatus(
  supabase: GhostClient,
  ownerId: string,
  projects: Promise<QueryResult<Array<{ id: string; name: string }>>>,
): Promise<PresentationStatus> {
  const hosted = isHostedRuntime();
  const [summaries, reviews, tree, deployed] = await Promise.all([
    projects,
    hosted ? Promise.resolve([]) : listReviews(presentationRoot(), ownerId).catch(() => []),
    hosted ? Promise.resolve(null) : hashWorkingTree(process.cwd()).catch(() => null),
    hosted ? releaseCommit() : Promise.resolve(null),
  ]);
  const ghost = summaries.status === "ok" ? summaries.data.find((project) => project.name.toLocaleLowerCase() === "ghost") : null;
  if (!ghost) {
    return { hosted, review: null, fresh: false };
  }
  const review = hosted
    ? await loadRecordedReview(supabase, ownerId, ghost.id, "production")
    : reviews.filter((item) => item.projectId === ghost.id).at(-1) ?? null;
  const fresh = !review ? false : tree ? reviewFreshness(review, tree) === "fresh" : review.commitSha === deployed;
  return { hosted, review, fresh };
}
