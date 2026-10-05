import assert from "node:assert/strict";
import test from "node:test";
import {
  envGithubTokenSource,
  parseGithubRepositoryUrl,
  readGithubRepository,
  redactGithubSecrets,
} from "./github";

test("repository association requires an explicit GitHub identity, never a similar name guess", () => {
  assert.deepEqual(parseGithubRepositoryUrl("Ghost-1R/Ghost"), {
    owner: "Ghost-1R",
    name: "Ghost",
    fullName: "Ghost-1R/Ghost",
    htmlUrl: "https://github.com/Ghost-1R/Ghost",
  });
  assert.equal(parseGithubRepositoryUrl("https://github.com/Ghost-1R/Ghost.git")?.fullName, "Ghost-1R/Ghost");
  assert.equal(parseGithubRepositoryUrl("Ghost"), null);
  assert.equal(parseGithubRepositoryUrl("gitlab.com/Ghost-1R/Ghost"), null);
});

test("tokens stay out of snapshots and redaction strips accidental leaks", async () => {
  const token = "ghs_test_token_value_123456";
  const calls: string[] = [];
  const snapshot = await readGithubRepository(
    {
      owner: "Ghost-1R",
      name: "Ghost",
      fullName: "Ghost-1R/Ghost",
      htmlUrl: "https://github.com/Ghost-1R/Ghost",
    },
    {
      tokenSource: { readToken: () => token },
      fetchImpl: async (input) => {
        calls.push(String(input));
        if (String(input).endsWith("/Ghost")) {
          return new Response(JSON.stringify({ default_branch: "ghost-experience", full_name: "Ghost-1R/Ghost", html_url: "https://github.com/Ghost-1R/Ghost" }), { status: 200 });
        }
        if (String(input).includes("/commits")) {
          return new Response(JSON.stringify([{ sha: "abc1234deadbeef", html_url: "https://github.com/x", commit: { message: "Ship V4\n\nbody" } }]), { status: 200 });
        }
        if (String(input).includes("/pulls")) {
          return new Response(JSON.stringify([{ number: 7, title: "Open PR", state: "open", html_url: "https://github.com/x/pull/7" }]), { status: 200 });
        }
        return new Response("missing", { status: 500 });
      },
    },
  );
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.latestCommit?.sha, "abc1234deadbeef");
  assert.equal(snapshot.latestCommit?.message, "Ship V4");
  assert.equal(snapshot.openPullRequests.length, 1);
  assert.ok(!JSON.stringify(snapshot).includes(token));
  assert.ok(calls.every((url) => url.startsWith("https://api.github.com/")));
  assert.equal(redactGithubSecrets(`Authorization: Bearer ${token}`, token), "Authorization: Bearer [REDACTED_GITHUB_TOKEN]");
});

test("missing tokens, 404, and rate-limit style failures stay read-only and explicit", async () => {
  assert.equal(envGithubTokenSource({}).readToken(), null);
  const missing = await readGithubRepository(
    { owner: "a", name: "b", fullName: "a/b", htmlUrl: "https://github.com/a/b" },
    { tokenSource: { readToken: () => null } },
  );
  assert.equal(missing.available, false);
  assert.match(missing.reason, /not configured/);

  const denied = await readGithubRepository(
    { owner: "a", name: "b", fullName: "a/b", htmlUrl: "https://github.com/a/b" },
    {
      tokenSource: { readToken: () => "token" },
      fetchImpl: async () => new Response("", { status: 403 }),
    },
  );
  assert.equal(denied.available, false);
  assert.match(denied.reason, /refused|rate/);

  const missingRepo = await readGithubRepository(
    { owner: "a", name: "b", fullName: "a/b", htmlUrl: "https://github.com/a/b" },
    {
      tokenSource: { readToken: () => "token" },
      fetchImpl: async () => new Response("", { status: 404 }),
    },
  );
  assert.match(missingRepo.reason, /not visible/);
});
