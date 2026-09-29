export const REPOSITORY_WRITE_RISK = {
  read: "SAFE",
  createBranch: "CAUTION",
  commit: "CAUTION",
  push: "HIGH",
  merge: "HIGH",
  forcePush: "CRITICAL",
  deleteBranchOrRepo: "CRITICAL",
} as const;

export type RemoteInspection = {
  available: boolean;
  owner: string;
  name: string;
  reason: string;
  defaultBranch: string | null;
  latestCommit: string | null;
  empty: boolean | null;
};

export async function inspectGithubRepository(
  owner = "Ghost-1R",
  name = "Ghost",
): Promise<RemoteInspection> {
  const unavailable: RemoteInspection = {
    available: false,
    owner,
    name,
    reason: "GitHub authentication is not available in this environment. Remote state was not inspected.",
    defaultBranch: null,
    latestCommit: null,
    empty: null,
  };

  const tokenNames = ["GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PAT"] as const;
  const hasToken = tokenNames.some((tokenName) => Boolean(process.env[tokenName]));
  if (!hasToken) {
    return unavailable;
  }

  return {
    ...unavailable,
    reason: "A GitHub token name is present, but this build does not call the GitHub API without an explicit read-only client. Remote state was not mutated.",
  };
}
