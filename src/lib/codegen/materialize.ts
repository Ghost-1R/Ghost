import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { createCodeWorkspaceContract } from "@/lib/agent-runtime/workspace";
import { validateRelativeProposalPath } from "./security";
import type { FileChangeProposal } from "./types";

export type MaterializeResult =
  | {
      ok: true;
      workspacePath: string;
      files: Array<{ relativePath: string; sha256: string; bytes: number }>;
      contentSha256: string;
    }
  | { ok: false; reason: string; message: string };

/**
 * Materialize proposals only inside an isolated workspace under allowed roots.
 * No unrestricted filesystem writes. No commits.
 */
export function materializeProposals(input: {
  taskId: string;
  ownerId: string;
  projectId: string;
  workspaceRoot: string;
  allowedRelativeRoots: string[];
  proposals: FileChangeProposal[];
}): MaterializeResult {
  const contract = createCodeWorkspaceContract({
    taskId: input.taskId,
    ownerId: input.ownerId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
  });
  if (!contract.ok) {
    return { ok: false, reason: contract.reason, message: contract.message };
  }

  const files: Array<{ relativePath: string; sha256: string; bytes: number }> = [];
  const hash = createHash("sha256");

  for (const proposal of input.proposals) {
    const pathCheck = validateRelativeProposalPath(proposal.relativePath, input.allowedRelativeRoots);
    if (!pathCheck.ok) return pathCheck;
    if (proposal.op === "DELETE") {
      return { ok: false, reason: "DELETE_UNSUPPORTED", message: "Mock pilot does not apply DELETE ops." };
    }
    const abs = path.join(contract.contract.hostPath, pathCheck.normalized);
    const resolvedRoot = path.resolve(contract.contract.hostPath);
    if (!path.resolve(abs).startsWith(resolvedRoot)) {
      return { ok: false, reason: "PATH_ESCAPE", message: "Write escaped workspace." };
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    const content = proposal.content ?? "";
    writeFileSync(abs, content, "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const bytes = Buffer.byteLength(content, "utf8");
    hash.update(pathCheck.normalized).update(sha256);
    files.push({ relativePath: pathCheck.normalized, sha256, bytes });
  }

  return {
    ok: true,
    workspacePath: contract.contract.hostPath,
    files,
    contentSha256: hash.digest("hex"),
  };
}

export function cleanupWorkspace(workspacePath: string): void {
  if (existsSync(workspacePath)) {
    rmSync(workspacePath, { recursive: true, force: true });
  }
}
