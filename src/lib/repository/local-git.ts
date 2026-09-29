import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitCommit = {
  sha: string;
  subject: string;
};

export type GitState = {
  root: string;
  branch: string;
  commit: string;
  workingTree: "clean" | "dirty";
  changedFiles: string[];
  recentCommits: GitCommit[];
  trackedFiles: string[];
};

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1_000_000,
  });
  return stdout.replace(/\r\n/g, "\n");
}

export async function readGitState(cwd: string): Promise<GitState> {
  const [root, branch, commit, status, log, tracked] = await Promise.all([
    git(cwd, ["rev-parse", "--show-toplevel"]),
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["rev-parse", "HEAD"]),
    git(cwd, ["status", "--porcelain", "--untracked-files=all"]),
    git(cwd, ["log", "-5", "--pretty=format:%h%x09%s"]),
    git(cwd, ["ls-files"]),
  ]);

  const changedFiles = status
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);

  const recentCommits = log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ...rest] = line.split("\t");
      return { sha: sha ?? "", subject: rest.join("\t") };
    })
    .filter((entry) => entry.sha);

  return {
    root: root.trim(),
    branch: branch.trim(),
    commit: commit.trim(),
    workingTree: changedFiles.length === 0 ? "clean" : "dirty",
    changedFiles,
    recentCommits,
    trackedFiles: tracked.split("\n").map((file) => file.trim()).filter(Boolean),
  };
}
