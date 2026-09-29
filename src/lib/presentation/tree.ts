import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isExcludedRepositoryPath } from "@/lib/repository/exclude";
import { readGitState } from "@/lib/repository/local-git";

export function hashTreeContents(files: Array<{ path: string; content: Buffer | null }>): string {
  const hash = createHash("sha256");
  const included = files
    .filter((file) => !isExcludedRepositoryPath(file.path) && file.content)
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const file of included) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content ?? Buffer.alloc(0));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function hashWorkingTree(cwd: string): Promise<{ commitSha: string; treeHash: string }> {
  const state = await readGitState(cwd);
  const paths = [...new Set([...state.trackedFiles, ...state.changedFiles])]
    .filter((filePath) => !filePath.endsWith("/") && !isExcludedRepositoryPath(filePath))
    .sort();
  const files: Array<{ path: string; content: Buffer | null }> = [];
  for (const filePath of paths) {
    const content = await readFile(path.join(state.root, filePath)).catch(() => null);
    files.push({ path: filePath, content });
  }
  return { commitSha: state.commit, treeHash: hashTreeContents(files) };
}
