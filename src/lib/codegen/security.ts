import path from "node:path";
import { redactSecrets } from "@/lib/security/redact";
import type { FileChangeProposal } from "./types";

const FORBIDDEN_PATH_PARTS = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "credentials.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519",
  ".git",
  "node_modules",
]);

export type PathValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: string; message: string };

export function validateRelativeProposalPath(
  relativePath: string,
  allowedRoots: string[],
): PathValidationResult {
  const trimmed = relativePath.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed)) {
    return { ok: false, reason: "ABSOLUTE_PATH", message: "Absolute paths are not allowed." };
  }
  if (trimmed.includes("\0") || trimmed.includes("..")) {
    return { ok: false, reason: "PATH_ESCAPE", message: "Path escape rejected." };
  }
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.some((p) => FORBIDDEN_PATH_PARTS.has(p) || p.startsWith(".env"))) {
    return { ok: false, reason: "FORBIDDEN_PATH", message: "Secret or forbidden path rejected." };
  }
  const underRoot = allowedRoots.some((root) => {
    const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
    return trimmed === r || trimmed.startsWith(`${r}/`);
  });
  if (!underRoot) {
    return {
      ok: false,
      reason: "OUTSIDE_ALLOWED_ROOT",
      message: `Path ${trimmed} is outside allowed roots.`,
    };
  }
  // Normalize without resolving outside
  const normalized = path.posix.normalize(trimmed);
  if (normalized.startsWith("..") || normalized.includes("/../")) {
    return { ok: false, reason: "PATH_ESCAPE", message: "Normalized path escape rejected." };
  }
  return { ok: true, normalized };
}

export function validateProposals(
  proposals: FileChangeProposal[],
  allowedRoots: string[],
  maxOutputBytes: number,
): { ok: true; proposals: FileChangeProposal[] } | { ok: false; reason: string; message: string } {
  if (!Array.isArray(proposals) || proposals.length === 0) {
    return { ok: false, reason: "EMPTY_PROPOSALS", message: "No file proposals returned." };
  }
  if (proposals.length > 32) {
    return { ok: false, reason: "TOO_MANY_FILES", message: "Proposal file count exceeds limit." };
  }
  let total = 0;
  const normalized: FileChangeProposal[] = [];
  for (const proposal of proposals) {
    const pathCheck = validateRelativeProposalPath(proposal.relativePath, allowedRoots);
    if (!pathCheck.ok) return pathCheck;
    if (proposal.op !== "DELETE" && typeof proposal.content !== "string") {
      return { ok: false, reason: "INVALID_CONTENT", message: "CREATE/UPDATE requires string content." };
    }
    if (proposal.op === "DELETE" && proposal.content != null) {
      return { ok: false, reason: "INVALID_CONTENT", message: "DELETE must not include content." };
    }
    const bytes = Buffer.byteLength(proposal.content ?? "", "utf8");
    total += bytes;
    if (total > maxOutputBytes) {
      return { ok: false, reason: "OUTPUT_TOO_LARGE", message: "Aggregate proposal exceeds byte budget." };
    }
    if (proposal.content && /(?:sk-|gsk_|ghp_|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)/.test(proposal.content)) {
      return { ok: false, reason: "SECRET_IN_OUTPUT", message: "Proposal appears to contain secrets." };
    }
    normalized.push({
      ...proposal,
      relativePath: pathCheck.normalized,
      content: proposal.content == null ? null : redactSecrets(proposal.content),
    });
  }
  return { ok: true, proposals: normalized };
}

export function assertObjectiveSafe(objective: string): { ok: true } | { ok: false; reason: string; message: string } {
  const text = objective.trim();
  if (text.length < 8 || text.length > 4_000) {
    return { ok: false, reason: "INVALID_OBJECTIVE", message: "Objective length out of bounds." };
  }
  if (/\b(rm\s+-rf|curl\s+|wget\s+|docker\s+socket|\/var\/run\/docker)\b/i.test(text)) {
    return { ok: false, reason: "UNSAFE_OBJECTIVE", message: "Objective requests unsafe host operations." };
  }
  return { ok: true };
}
