import { createHash, randomUUID } from "node:crypto";
import type { AgentTask, AgentTaskCheckpoint } from "./types";

/**
 * Review artifact + private preview interfaces (Build 09.8).
 * Artifacts are founder-private — never published as public previews.
 */

export const REVIEW_ARTIFACT_KINDS = [
  "DIFF_SUMMARY",
  "TEST_LOG",
  "CHECKPOINT_SNAPSHOT",
  "ERROR_REPORT",
  "PREVIEW_BUNDLE",
] as const;

export type ReviewArtifactKind = (typeof REVIEW_ARTIFACT_KINDS)[number];

export type ReviewArtifactVisibility = "FOUNDER_PRIVATE";

export type ReviewArtifact = {
  id: string;
  taskId: string;
  ownerId: string;
  projectId: string;
  kind: ReviewArtifactKind;
  title: string;
  /** Non-secret content reference (path, checksum, or inline short text). */
  contentRef: string;
  contentSha256: string;
  visibility: ReviewArtifactVisibility;
  /** Always false in this build — no public preview publishing. */
  publiclyPublished: false;
  createdAt: string;
};

export type PrivatePreview = {
  id: string;
  artifactId: string;
  taskId: string;
  ownerId: string;
  /** Opaque private token — not a public URL. */
  accessToken: string;
  expiresAt: string;
  publiclyPublished: false;
  createdAt: string;
};

export type ArtifactResult =
  | { ok: true; artifact: ReviewArtifact }
  | { ok: false; reason: string; message: string };

const SECRETISH = /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|Bearer\s+)/i;

export function createReviewArtifact(input: {
  task: Pick<AgentTask, "id" | "ownerId" | "projectId">;
  kind: ReviewArtifactKind;
  title: string;
  contentRef: string;
  at?: string;
}): ArtifactResult {
  const contentRef = input.contentRef.trim();
  if (!contentRef) {
    return { ok: false, reason: "EMPTY_CONTENT", message: "contentRef is required." };
  }
  if (SECRETISH.test(contentRef) || SECRETISH.test(input.title)) {
    return {
      ok: false,
      reason: "SECRET_IN_ARTIFACT",
      message: "Review artifacts must not contain credentials or API keys.",
    };
  }
  const createdAt = input.at ?? new Date().toISOString();
  const contentSha256 = createHash("sha256").update(contentRef).digest("hex");
  return {
    ok: true,
    artifact: {
      id: randomUUID(),
      taskId: input.task.id,
      ownerId: input.task.ownerId,
      projectId: input.task.projectId,
      kind: input.kind,
      title: input.title.trim().slice(0, 200),
      contentRef: contentRef.slice(0, 4000),
      contentSha256,
      visibility: "FOUNDER_PRIVATE",
      publiclyPublished: false,
      createdAt,
    },
  };
}

export function createCheckpointReviewArtifact(
  task: Pick<AgentTask, "id" | "ownerId" | "projectId">,
  checkpoint: AgentTaskCheckpoint,
  at?: string,
): ArtifactResult {
  return createReviewArtifact({
    task,
    kind: "CHECKPOINT_SNAPSHOT",
    title: `Checkpoint ${checkpoint.sequence}: ${checkpoint.label}`,
    contentRef: checkpoint.progressRef || `checkpoint:${checkpoint.id}`,
    at,
  });
}

export function createPrivatePreview(input: {
  artifact: ReviewArtifact;
  ownerId: string;
  ttlMs?: number;
  at?: string;
}): { ok: true; preview: PrivatePreview } | { ok: false; reason: string; message: string } {
  if (input.artifact.ownerId !== input.ownerId) {
    return { ok: false, reason: "OWNER_MISMATCH", message: "Only the owning founder can create previews." };
  }
  if (input.artifact.publiclyPublished !== false) {
    return { ok: false, reason: "PUBLIC_FORBIDDEN", message: "Public previews are not allowed." };
  }
  const at = input.at ?? new Date().toISOString();
  const ttl = input.ttlMs ?? 60 * 60 * 1000;
  return {
    ok: true,
    preview: {
      id: randomUUID(),
      artifactId: input.artifact.id,
      taskId: input.artifact.taskId,
      ownerId: input.ownerId,
      accessToken: createHash("sha256").update(`${input.artifact.id}:${at}:${randomUUID()}`).digest("hex"),
      expiresAt: new Date(Date.parse(at) + ttl).toISOString(),
      publiclyPublished: false,
      createdAt: at,
    },
  };
}

/** Always refuse public publish — founder review stays private. */
export function publishReviewArtifactPublicly(_artifact: ReviewArtifact): never {
  void _artifact;
  throw new Error("PUBLIC_PREVIEW_FORBIDDEN: review artifacts cannot be published publicly.");
}
