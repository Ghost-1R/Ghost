import type { GhostClient } from "@/lib/auth/session";
import { parseGithubRepositoryUrl, readGithubRepository, type GithubRepositorySnapshot } from "@/lib/repository/github";
import { fromError, type QueryResult } from "@/lib/result";

export type ProjectRepositoryRecord = {
  id: string;
  projectId: string;
  provider: "github";
  ownerLogin: string;
  repoName: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string | null;
  isPrimary: boolean;
  associatedAt: string;
  associatedBy: string | null;
};

export type RepositoryObservationRecord = {
  id: string;
  projectId: string;
  repositoryId: string;
  observedAt: string;
  branch: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  openPullRequests: number | null;
  summary: string;
};

function mapRepository(row: {
  id: string;
  project_id: string;
  provider: string;
  owner_login: string;
  repo_name: string;
  full_name: string;
  html_url: string;
  default_branch: string | null;
  is_primary: boolean;
  associated_at: string;
  associated_by: string | null;
}): ProjectRepositoryRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: "github",
    ownerLogin: row.owner_login,
    repoName: row.repo_name,
    fullName: row.full_name,
    htmlUrl: row.html_url,
    defaultBranch: row.default_branch,
    isPrimary: row.is_primary,
    associatedAt: row.associated_at,
    associatedBy: row.associated_by,
  };
}

export async function loadPrimaryRepository(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<ProjectRepositoryRecord | null>> {
  const result = await supabase
    .from("project_repositories")
    .select("id, project_id, provider, owner_login, repo_name, full_name, html_url, default_branch, is_primary, associated_at, associated_by")
    .eq("project_id", projectId)
    .eq("is_primary", true)
    .maybeSingle();
  if (result.error) return fromError(result.error);
  return { status: "ok", data: result.data ? mapRepository(result.data) : null };
}

export async function associateGithubRepository(
  supabase: GhostClient,
  input: { projectId: string; repository: string; associatedBy: string | null },
): Promise<QueryResult<ProjectRepositoryRecord>> {
  const identity = parseGithubRepositoryUrl(input.repository);
  if (!identity) {
    return { status: "error", message: "Associate a repository with an explicit owner/name or GitHub URL. Ghost will not guess from similar names." };
  }
  const existing = await loadPrimaryRepository(supabase, input.projectId);
  if (existing.status === "error") return existing;
  if (existing.data) {
    return { status: "error", message: "This project already has a primary repository. Remove it before associating another." };
  }

  const inserted = await supabase
    .from("project_repositories")
    .insert({
      project_id: input.projectId,
      provider: "github",
      owner_login: identity.owner,
      repo_name: identity.name,
      full_name: identity.fullName,
      html_url: identity.htmlUrl,
      is_primary: true,
      associated_by: input.associatedBy,
    })
    .select("id, project_id, provider, owner_login, repo_name, full_name, html_url, default_branch, is_primary, associated_at, associated_by")
    .single();
  if (inserted.error) return fromError(inserted.error);

  await supabase
    .from("projects")
    .update({
      repository_url: identity.htmlUrl,
      repository_provider: "github",
    })
    .eq("id", input.projectId);

  return { status: "ok", data: mapRepository(inserted.data) };
}

export async function observePrimaryRepository(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<{ observation: RepositoryObservationRecord; snapshot: GithubRepositorySnapshot }>> {
  const repository = await loadPrimaryRepository(supabase, projectId);
  if (repository.status === "error") return repository;
  if (!repository.data) {
    return { status: "error", message: "No repository is associated with this project." };
  }

  const snapshot = await readGithubRepository({
    owner: repository.data.ownerLogin,
    name: repository.data.repoName,
    fullName: repository.data.fullName,
    htmlUrl: repository.data.htmlUrl,
  });

  const summary = snapshot.available
    ? [
        `default branch ${snapshot.defaultBranch ?? "unknown"}`,
        snapshot.latestCommit ? `latest commit ${snapshot.latestCommit.sha.slice(0, 7)} ${snapshot.latestCommit.message}` : "no commits observed",
        `${snapshot.openPullRequests.length} open pull requests`,
      ].join("; ")
    : snapshot.reason;

  const inserted = await supabase
    .from("repository_observations")
    .insert({
      project_id: projectId,
      repository_id: repository.data.id,
      branch: snapshot.defaultBranch,
      commit_sha: snapshot.latestCommit?.sha ?? null,
      commit_message: snapshot.latestCommit?.message ?? null,
      open_pull_requests: snapshot.available ? snapshot.openPullRequests.length : null,
      summary,
    })
    .select("id, project_id, repository_id, observed_at, branch, commit_sha, commit_message, open_pull_requests, summary")
    .single();
  if (inserted.error) return fromError(inserted.error);

  if (snapshot.available && snapshot.latestCommit) {
    await supabase
      .from("projects")
      .update({
        repository_branch: snapshot.defaultBranch,
        repository_commit: snapshot.latestCommit.sha,
      })
      .eq("id", projectId);
    await supabase
      .from("project_repositories")
      .update({ default_branch: snapshot.defaultBranch })
      .eq("id", repository.data.id);
  }

  return {
    status: "ok",
    data: {
      snapshot,
      observation: {
        id: inserted.data.id,
        projectId: inserted.data.project_id,
        repositoryId: inserted.data.repository_id,
        observedAt: inserted.data.observed_at,
        branch: inserted.data.branch,
        commitSha: inserted.data.commit_sha,
        commitMessage: inserted.data.commit_message,
        openPullRequests: inserted.data.open_pull_requests,
        summary: inserted.data.summary,
      },
    },
  };
}

export async function loadLatestRepositoryObservation(
  supabase: GhostClient,
  projectId: string,
): Promise<QueryResult<RepositoryObservationRecord | null>> {
  const result = await supabase
    .from("repository_observations")
    .select("id, project_id, repository_id, observed_at, branch, commit_sha, commit_message, open_pull_requests, summary")
    .eq("project_id", projectId)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    if (/repository_observations|does not exist/i.test(result.error.message)) {
      return { status: "ok", data: null };
    }
    return fromError(result.error);
  }
  if (!result.data) return { status: "ok", data: null };
  return {
    status: "ok",
    data: {
      id: result.data.id,
      projectId: result.data.project_id,
      repositoryId: result.data.repository_id,
      observedAt: result.data.observed_at,
      branch: result.data.branch,
      commitSha: result.data.commit_sha,
      commitMessage: result.data.commit_message,
      openPullRequests: result.data.open_pull_requests,
      summary: result.data.summary,
    },
  };
}
