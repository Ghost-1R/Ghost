import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collectProjectItems } from "../ghost-context/assemble";

test("project context keeps lifecycle and open decisions without inventing progress", () => {
  const items = collectProjectItems({
    question: "What's next? What decisions are waiting? What's the latest commit?",
    project: {
      id: "p1",
      name: "GHOST",
      description: "Second mind",
      status: "BUILDING",
      currentMilestone: "Production verification",
      lifecycleStage: "BUILD",
    },
    knowledge: [],
    blockers: [],
    nextActions: [
      {
        id: "a1",
        title: "Run presentation gate",
        description: "Founder-approved",
        status: "OPEN",
        position: 0,
        provenance: "FOUNDER_APPROVED_ACTION",
      },
      {
        id: "a2",
        title: "Maybe redesign later",
        description: "Only a suggestion",
        status: "OPEN",
        position: 1,
        provenance: "RECOMMENDATION",
      },
    ],
    verification: [],
    founderRules: [],
    decisions: [{ id: "d1", title: "Payment provider", question: "Square or Stripe?", status: "OPEN", recommendation: "Square" }],
    repositoryObservation: {
      id: "o1",
      branch: "ghost-experience",
      commitSha: "abc1234",
      commitMessage: "V4 foundation",
      openPullRequests: 0,
      summary: "latest commit abc1234 V4 foundation",
    },
  });

  assert.ok(items.some((item) => item.type === "lifecycle" && item.status === "BUILD"));
  assert.ok(items.some((item) => item.type === "decision" && item.title === "Payment provider"));
  assert.ok(items.some((item) => item.id === "a1" && item.keep));
  assert.ok(items.some((item) => item.id === "a2" && !item.keep));
  const observation = items.find((item) => item.type === "repository_observation");
  assert.ok(observation);
  assert.match(observation?.content ?? "", /does not mean feature complete/);
  assert.ok(!items.some((item) => /%|deadline|velocity/i.test(item.content)));
});

test("migration and github client stay read-only and secret-safe", () => {
  const migration = readFileSync(new URL("../../../supabase/migrations/20260930040000_operating_system_foundation.sql", import.meta.url), "utf8");
  assert.match(migration, /lifecycle_transitions/);
  assert.match(migration, /project_decisions/);
  assert.match(migration, /project_repositories/);
  assert.match(migration, /append-only/);
  assert.ok(!/GITHUB_TOKEN|ghp_|ghs_|password\s*=/i.test(migration));

  const github = readFileSync(new URL("../repository/github.ts", import.meta.url), "utf8");
  assert.match(github, /api\.github\.com/);
  assert.ok(!/html\.github|cheerio|puppeteer/.test(github));
  assert.match(github, /REDACTED_GITHUB_TOKEN/);
});
