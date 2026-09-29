import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { tokens } from "@/lib/ghost-context/select";
import { containsSecretMaterial, isExcludedRepositoryPath } from "./exclude";
import { readGitState, type GitCommit } from "./local-git";

export const REPO_CANDIDATE_LIMIT = 40;
export const REPO_FILE_LIMIT = 6;
export const REPO_EXCERPT_CHARS = 400;
export const REPO_CHAR_BUDGET = 2200;
export const REPO_MAX_FILE_BYTES = 20_000;

const PATH_PATTERN = /\b((?:[\w.@()-]+\/)+[\w.@()-]+\.(?:ts|tsx|js|jsx|mjs|sql|md|json|css|txt))\b/g;

export type RepoFile = {
  path: string;
  excerpt: string;
};

export type RepoSnapshot = {
  branch: string;
  commit: string;
  capturedAt: string;
  workingTree: "clean" | "dirty";
  changedFiles: string[];
  recentCommits: GitCommit[];
  migrations: string[];
  packageName: string | null;
  testScript: string | null;
  files: RepoFile[];
};

export function explicitRepositoryPaths(message: string): string[] {
  return [...message.matchAll(PATH_PATTERN)].map((match) => match[1] ?? "").filter(Boolean);
}

export function scoreRepositoryPath(question: string, filePath: string, changed: boolean): number {
  const name = filePath.split("/").at(-1) ?? filePath;
  const score = tokens(question).filter((token) => tokens(`${filePath} ${name}`).includes(token)).length;
  return score + (changed && score > 0 ? 1 : 0);
}

function excerptAround(text: string, question: string): string {
  const lower = text.toLowerCase();
  const token = tokens(question).find((entry) => lower.includes(entry));
  const index = token ? lower.indexOf(token) : 0;
  const start = Math.max(0, index - 80);
  return text.slice(start, start + REPO_EXCERPT_CHARS);
}

async function readExcerpt(root: string, filePath: string, question: string): Promise<string | null> {
  if (isExcludedRepositoryPath(filePath)) {
    return null;
  }
  const absolute = path.join(root, filePath);
  const info = await stat(absolute).catch(() => null);
  if (!info || !info.isFile() || info.size > REPO_MAX_FILE_BYTES) {
    return null;
  }
  const text = await readFile(absolute, "utf8");
  if (containsSecretMaterial(text)) {
    return null;
  }
  return excerptAround(text, question);
}

export async function missingExplicitPaths(message: string, cwd: string): Promise<string[]> {
  const paths = explicitRepositoryPaths(message);
  const missing: string[] = [];
  for (const filePath of paths) {
    if (isExcludedRepositoryPath(filePath)) {
      missing.push(filePath);
      continue;
    }
    const info = await stat(path.resolve(cwd, filePath)).catch(() => null);
    if (!info?.isFile()) {
      missing.push(filePath);
    }
  }
  return missing;
}

export function shouldAttachRepository(projectName: string | null): boolean {
  return projectName?.toLocaleLowerCase() === "ghost";
}

export async function captureRepositorySnapshot(cwd: string, question: string): Promise<RepoSnapshot> {
  const state = await readGitState(cwd);
  const changed = new Set(state.changedFiles);
  const explicit = new Set(explicitRepositoryPaths(question));
  const pool = [...new Set([...state.trackedFiles, ...state.changedFiles])];
  const ranked = pool
    .filter((filePath) => !isExcludedRepositoryPath(filePath))
    .map((filePath) => ({
      filePath,
      score: explicit.has(filePath) ? 100 : scoreRepositoryPath(question, filePath, changed.has(filePath)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, REPO_CANDIDATE_LIMIT);

  const files: RepoFile[] = [];
  let used = 0;
  for (const entry of ranked) {
    if (files.length >= REPO_FILE_LIMIT) {
      break;
    }
    const excerpt = await readExcerpt(state.root, entry.filePath, question);
    if (!excerpt) {
      continue;
    }
    if (used + excerpt.length > REPO_CHAR_BUDGET) {
      continue;
    }
    files.push({ path: entry.filePath, excerpt });
    used += excerpt.length;
  }

  let packageName: string | null = null;
  let testScript: string | null = null;
  const packageFile = state.trackedFiles.find((filePath) => filePath === "package.json");
  if (packageFile && !isExcludedRepositoryPath(packageFile)) {
    const raw = await readFile(path.join(state.root, packageFile), "utf8").catch(() => "");
    if (raw && !containsSecretMaterial(raw)) {
      try {
        const parsed = JSON.parse(raw) as { name?: string; scripts?: { test?: string } };
        packageName = parsed.name ?? null;
        testScript = parsed.scripts?.test ?? null;
      } catch {
        packageName = null;
        testScript = null;
      }
    }
  }

  return {
    branch: state.branch,
    commit: state.commit,
    capturedAt: new Date().toISOString(),
    workingTree: state.workingTree,
    changedFiles: state.changedFiles.filter((filePath) => !isExcludedRepositoryPath(filePath)).slice(0, 20),
    recentCommits: state.recentCommits,
    migrations: state.trackedFiles.filter((filePath) => filePath.startsWith("supabase/migrations/") && filePath.endsWith(".sql")),
    packageName,
    testScript,
    files,
  };
}
