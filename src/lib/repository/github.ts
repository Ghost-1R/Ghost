export const REPOSITORY_WRITE_RISK = {
  read: "SAFE",
  createBranch: "CAUTION",
  commit: "CAUTION",
  push: "HIGH",
  merge: "HIGH",
  forcePush: "CRITICAL",
  deleteBranchOrRepo: "CRITICAL",
} as const;

export type GithubIdentity = {
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
};

export type GithubCommit = {
  sha: string;
  message: string;
  branch: string | null;
  url: string | null;
};

export type GithubPullRequest = {
  number: number;
  title: string;
  state: string;
  url: string;
};

export type GithubRepositorySnapshot = {
  available: boolean;
  reason: string;
  identity: GithubIdentity | null;
  defaultBranch: string | null;
  latestCommit: GithubCommit | null;
  recentCommits: GithubCommit[];
  openPullRequests: GithubPullRequest[];
};

export type GithubTokenSource = {
  readToken(): string | null;
};

const TOKEN_NAMES = ["GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PAT"] as const;

export function envGithubTokenSource(env: Record<string, string | undefined> = process.env): GithubTokenSource {
  return {
    readToken() {
      for (const name of TOKEN_NAMES) {
        const value = env[name]?.trim();
        if (value) return value;
      }
      return null;
    },
  };
}

export function parseGithubRepositoryUrl(value: string): GithubIdentity | null {
  const trimmed = value.trim();
  const short = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (short) {
    return {
      owner: short[1],
      name: short[2],
      fullName: `${short[1]}/${short[2]}`,
      htmlUrl: `https://github.com/${short[1]}/${short[2]}`,
    };
  }
  const url = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  if (!url) return null;
  return {
    owner: url[1],
    name: url[2],
    fullName: `${url[1]}/${url[2]}`,
    htmlUrl: `https://github.com/${url[1]}/${url[2]}`,
  };
}

export function redactGithubSecrets(value: string, token: string | null): string {
  if (!token) return value;
  return value.split(token).join("[REDACTED_GITHUB_TOKEN]");
}

type FetchLike = typeof fetch;

export async function readGithubRepository(
  identity: GithubIdentity,
  options: {
    tokenSource?: GithubTokenSource;
    fetchImpl?: FetchLike;
    commitLimit?: number;
  } = {},
): Promise<GithubRepositorySnapshot> {
  const tokenSource = options.tokenSource ?? envGithubTokenSource();
  const token = tokenSource.readToken();
  const empty: GithubRepositorySnapshot = {
    available: false,
    reason: "GitHub authentication is not configured. Remote state was not inspected.",
    identity,
    defaultBranch: null,
    latestCommit: null,
    recentCommits: [],
    openPullRequests: [],
  };
  if (!token) return empty;

  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ghost-read-only",
  };

  const repoResponse = await fetchImpl(`https://api.github.com/repos/${identity.owner}/${identity.name}`, { headers });
  if (repoResponse.status === 401 || repoResponse.status === 403) {
    return { ...empty, reason: "GitHub refused the read-only request. Check token scope or rate limits." };
  }
  if (repoResponse.status === 404) {
    return { ...empty, reason: "That GitHub repository is not visible to the configured token." };
  }
  if (!repoResponse.ok) {
    return { ...empty, reason: `GitHub repository read failed with status ${repoResponse.status}.` };
  }

  const repo = (await repoResponse.json()) as { default_branch?: string; html_url?: string; full_name?: string };
  const defaultBranch = repo.default_branch ?? null;
  const commitLimit = Math.min(Math.max(options.commitLimit ?? 5, 1), 20);
  const commitsResponse = await fetchImpl(
    `https://api.github.com/repos/${identity.owner}/${identity.name}/commits?sha=${encodeURIComponent(defaultBranch ?? "HEAD")}&per_page=${commitLimit}`,
    { headers },
  );
  const pullsResponse = await fetchImpl(
    `https://api.github.com/repos/${identity.owner}/${identity.name}/pulls?state=open&per_page=10`,
    { headers },
  );

  const commits = commitsResponse.ok
    ? (((await commitsResponse.json()) as Array<{ sha: string; html_url?: string; commit?: { message?: string } }>) ?? [])
    : [];
  const pulls = pullsResponse.ok
    ? (((await pullsResponse.json()) as Array<{ number: number; title: string; state: string; html_url: string }>) ?? [])
    : [];

  const recentCommits: GithubCommit[] = commits.map((commit) => ({
    sha: commit.sha,
    message: (commit.commit?.message ?? "").split("\n")[0]?.slice(0, 200) ?? "",
    branch: defaultBranch,
    url: commit.html_url ?? null,
  }));

  return {
    available: true,
    reason: "Read-only GitHub snapshot. Commits are evidence, not deployment or completion.",
    identity: {
      ...identity,
      fullName: repo.full_name ?? identity.fullName,
      htmlUrl: repo.html_url ?? identity.htmlUrl,
    },
    defaultBranch,
    latestCommit: recentCommits[0] ?? null,
    recentCommits,
    openPullRequests: pulls.map((pull) => ({
      number: pull.number,
      title: pull.title,
      state: pull.state,
      url: pull.html_url,
    })),
  };
}

/** Compatibility shim used by the Inspector: never mutates, never scrapes HTML. */
export async function inspectGithubRepository(owner = "Ghost-1R", name = "Ghost") {
  const snapshot = await readGithubRepository({
    owner,
    name,
    fullName: `${owner}/${name}`,
    htmlUrl: `https://github.com/${owner}/${name}`,
  });
  return {
    available: snapshot.available,
    owner,
    name,
    reason: snapshot.reason,
    defaultBranch: snapshot.defaultBranch,
    latestCommit: snapshot.latestCommit?.sha ?? null,
    empty: snapshot.available ? snapshot.recentCommits.length === 0 : null,
  };
}
